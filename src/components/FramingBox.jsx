// Framing a clip on the Edit monitor, like Premiere's Program monitor:
// with the Move tool (V), click the picture to select the clip under the
// playhead — a box with handles appears around it. Drag inside to move it
// (Position), drag a corner / edge to zoom it (Scale, uniform, about its
// centre). Scrolling over the picture zooms the clip at the mouse
// (Ctrl+scroll stays the view zoom). Snapping to the frame's centre and
// edges: always with Snap on, or while holding Ctrl (Shift = never).
// Clicking elsewhere on the monitor deselects. The bar at the bottom shows
// Scale and Position in Premiere's units — drag a number to change it, or
// click it to type. Each change is one undo step; the clip plays back and
// exports framed.
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { onTick } from '../lib/hooks.js'
import * as EM from '../lib/editModel.js'

const HANDLES = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
]
const SNAP_PX = 8
const WHEEL_COMMIT_MS = 450 // a burst of scroll = one undo step

// The frame's on-screen rect, relative to the stage (view zoom included).
function frameRect(stage, frame) {
  const s = stage.getBoundingClientRect()
  const f = frame.getBoundingClientRect()
  return { left: f.left - s.left, top: f.top - s.top, width: f.width, height: f.height, sx: s.left, sy: s.top, sw: stage.clientWidth, sh: stage.clientHeight }
}
const snapWanted = (ev) => !ev.shiftKey && (ev.ctrlKey || ev.metaKey || useStore.getState().settings.editSnap !== false)

export default function FramingBox({ stageRef, frameRef, seqW, seqH }) {
  const tool = useStore((s) => s.editTool)
  const sel = useStore((s) => s.editSel)
  const [geo, setGeo] = useState(null) // { fr, item, playing }
  const [live, setLive] = useState(null) // motion while dragging / scrolling
  const [guides, setGuides] = useState({ v: [], h: [] })
  const drag = useRef(null)
  const wheel = useRef(null) // { id, m, timer }
  const [, bump] = useState(0)
  useEffect(() => seqPlayer.on('motion', () => bump((n) => n + 1)), [])

  // Follow the clip on screen, the frame's place (view zoom/pan) and play state.
  useEffect(() => onTick(60, () => {
    const stage = stageRef.current
    const frame = frameRef.current
    if (!stage || !frame) return
    const fr = frameRect(stage, frame)
    const item = seqPlayer.currentItem()
    const playing = seqPlayer.playing
    setGeo((g) =>
      g && g.item === item && g.playing === playing && g.fr.left === fr.left && g.fr.top === fr.top && g.fr.width === fr.width && g.fr.height === fr.height && g.fr.sw === fr.sw && g.fr.sh === fr.sh ? g : { fr, item, playing }
    )
  }), [stageRef, frameRef])

  const item = geo && geo.item
  const shown = tool === 'select' && geo && !geo.playing && item && sel.length === 1 && sel[0] === item.id
  const m = live || EM.motionOf(item)

  const preview = (next) => {
    seqPlayer.previewMotion(next)
    setLive(next)
  }
  const commit = (id, next) => {
    useStore.getState().setClipMotion([id], () => next)
    setLive(null)
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    // Is this point (screen) on the clip's picture?
    const hit = (it, fr, x, y) => {
      const m0 = EM.motionOf(it)
      const k = m0.scale / 100
      const cx = fr.left + fr.width * (0.5 + m0.x)
      const cy = fr.top + fr.height * (0.5 + m0.y)
      const px = x - fr.sx
      const py = y - fr.sy
      // Only where the picture shows: inside both the clip and the frame.
      const inClip = Math.abs(px - cx) <= (fr.width * k) / 2 && Math.abs(py - cy) <= (fr.height * k) / 2
      const inFrame = px >= fr.left && px <= fr.left + fr.width && py >= fr.top && py <= fr.top + fr.height
      return { inside: inClip && inFrame, cx, cy, m0 }
    }

    // Clicks: on a handle = zoom; on the picture = select + move; anywhere
    // else on the monitor = deselect. Capture phase, so the view-zoom pan
    // (a listener on the same stage) can tell it's ours.
    const down = (e) => {
      if (e.button !== 0 || useStore.getState().editTool !== 'select') return
      if (e.target.closest('button, input, .fb-panel, .zoom-badge')) return
      const it = seqPlayer.currentItem()
      const frame = frameRef.current
      if (!it || !frame) return
      const fr = frameRect(stage, frame)
      const handle = e.target.closest('.fb-handle')
      const h = hit(it, fr, e.clientX, e.clientY)
      const st = useStore.getState()
      if (!handle && !h.inside) {
        if (st.editSel.length) st.setEditSel([])
        return
      }
      e._framing = true
      e.preventDefault()
      if (st.editSel.length !== 1 || st.editSel[0] !== it.id) st.setEditSel([it.id])
      seqPlayer.pause()
      drag.current = {
        id: it.id,
        kind: handle ? 'scale' : 'move',
        hx: handle ? Number(handle.dataset.hx) : 0,
        hy: handle ? Number(handle.dataset.hy) : 0,
        x0: e.clientX,
        y0: e.clientY,
        cx: h.cx + fr.sx, // clip centre, screen coords
        cy: h.cy + fr.sy,
        fr,
        m0: h.m0,
        m: h.m0,
        moved: false
      }
      const move = (ev) => {
        const d = drag.current
        if (!d) return
        const dx = ev.clientX - d.x0
        const dy = ev.clientY - d.y0
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        d.moved = true
        const snap = snapWanted(ev)
        const gv = []
        const gh = []
        let next
        if (d.kind === 'move') {
          let x = d.m0.x + dx / d.fr.width
          let y = d.m0.y + dy / d.fr.height
          if (snap) {
            const k2 = d.m0.scale / 200 // half the clip, in frame widths
            const tx = SNAP_PX / d.fr.width
            const ty = SNAP_PX / d.fr.height
            // centre on centre, edges on edges
            for (const [target, line] of [[0, 0.5], [-0.5 + k2, 0], [0.5 - k2, 1]]) if (Math.abs(x - target) < tx) { x = target; gv.push(line); break }
            for (const [target, line] of [[0, 0.5], [-0.5 + k2, 0], [0.5 - k2, 1]]) if (Math.abs(y - target) < ty) { y = target; gh.push(line); break }
          }
          next = { ...d.m0, x, y }
        } else {
          // Uniform scale about the clip's centre: how much farther from the
          // centre the pointer is now, along the handle's direction.
          let r
          if (d.hx && d.hy) r = Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) / Math.max(1, Math.hypot(d.x0 - d.cx, d.y0 - d.cy))
          else if (d.hx) r = Math.abs(ev.clientX - d.cx) / Math.max(1, Math.abs(d.x0 - d.cx))
          else r = Math.abs(ev.clientY - d.cy) / Math.max(1, Math.abs(d.y0 - d.cy))
          let scale = Math.max(5, Math.min(1000, d.m0.scale * r))
          if (snap && Math.abs(scale - 100) < 3) scale = 100
          next = { ...d.m0, scale }
        }
        d.m = next
        preview(next)
        setGuides({ v: gv, h: gh })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        const d = drag.current
        drag.current = null
        setGuides({ v: [], h: [] })
        if (d && d.moved) commit(d.id, d.m)
        else {
          seqPlayer.previewMotion(null)
          setLive(null)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

    // Scroll over the picture: zoom the clip, keeping the spot under the
    // mouse where it is. (Ctrl+scroll / pinch is the view zoom.)
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return
      const it = seqPlayer.currentItem()
      const frame = frameRef.current
      if (!it || !frame || seqPlayer.playing) return
      const fr = frameRect(stage, frame)
      const w0 = wheel.current
      const cur = w0 && w0.id === it.id ? w0.m : EM.motionOf(it)
      const px = e.clientX - fr.sx
      const py = e.clientY - fr.sy
      if (px < fr.left || px > fr.left + fr.width || py < fr.top || py > fr.top + fr.height) return
      e.preventDefault()
      e.stopPropagation()
      const st = useStore.getState()
      if (st.editSel.length !== 1 || st.editSel[0] !== it.id) st.setEditSel([it.id])
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      const factor = Math.abs(dy) >= 50 ? (dy < 0 ? 1.06 : 1 / 1.06) : Math.exp(-dy * 0.002)
      const scale = Math.max(5, Math.min(1000, cur.scale * factor))
      // the mouse, as an offset from the frame centre in frame fractions
      const u = (px - fr.left) / fr.width - 0.5
      const v = (py - fr.top) / fr.height - 0.5
      const r = scale / cur.scale
      const next = { scale, x: u - (u - cur.x) * r, y: v - (v - cur.y) * r }
      clearTimeout(w0 && w0.timer)
      const timer = setTimeout(() => {
        const w = wheel.current
        wheel.current = null
        if (w) commit(w.id, w.m)
      }, WHEEL_COMMIT_MS)
      wheel.current = { id: it.id, m: next, timer }
      preview(next)
    }

    stage.addEventListener('pointerdown', down, true)
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('pointerdown', down, true)
      stage.removeEventListener('wheel', onWheel)
    }
  }, [stageRef, frameRef])

  if (!shown) return null
  const fr = geo.fr
  const k = m.scale / 100
  const box = {
    left: fr.left + fr.width * (0.5 + m.x) - (fr.width * k) / 2,
    top: fr.top + fr.height * (0.5 + m.y) - (fr.height * k) / 2,
    width: fr.width * k,
    height: fr.height * k
  }
  // A zoomed-in clip's box is bigger than the monitor: keep its handles
  // where you can grab them, pinned just inside the visible area.
  const pin = (v, size) => Math.max(7, Math.min(size - 7, v))
  return (
    <>
      {guides.v.map((g) => <div key={'v' + g} className="fb-guide v" style={{ left: fr.left + fr.width * g, top: fr.top, height: fr.height }} />)}
      {guides.h.map((g) => <div key={'h' + g} className="fb-guide h" style={{ top: fr.top + fr.height * g, left: fr.left, width: fr.width }} />)}
      <div className="fb-box" style={box} />
      {HANDLES.map(([hx, hy]) => (
        <div key={hx + ',' + hy} className="fb-handle" data-hx={hx} data-hy={hy} style={{ left: pin(box.left + ((hx + 1) / 2) * box.width, fr.sw), top: pin(box.top + ((hy + 1) / 2) * box.height, fr.sh), cursor: hx && hy ? (hx === hy ? 'nwse-resize' : 'nesw-resize') : hx ? 'ew-resize' : 'ns-resize' }} />
      ))}
      <div className="fb-center" style={{ left: pin(box.left + box.width / 2, fr.sw), top: pin(box.top + box.height / 2, fr.sh) }} />
      <FramingBar m={m} seqW={seqW} seqH={seqH} onPreview={preview} onCommit={(next) => commit(item.id, next)} />
    </>
  )
}

// Scale and Position, in Premiere's units (%, sequence pixels). Each
// number is "hot text" like Premiere's: drag it left/right to change it,
// or click it to type.
function FramingBar({ m, seqW, seqH, onPreview, onCommit }) {
  const toPx = (v, size) => size / 2 + v * size
  const fields = [
    { key: 'scale', label: 'Scale', unit: '%', value: m.scale, step: 0.5, fix: 1, set: (v) => ({ ...m, scale: Math.max(5, Math.min(1000, v)) }) },
    { key: 'x', label: 'Position', value: toPx(m.x, seqW), step: 1, fix: 1, set: (v) => ({ ...m, x: (v - seqW / 2) / seqW }) },
    { key: 'y', label: null, value: toPx(m.y, seqH), step: 1, fix: 1, set: (v) => ({ ...m, y: (v - seqH / 2) / seqH }) }
  ]
  return (
    <div className="fb-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {fields.map((f) => (
        <React.Fragment key={f.key}>
          {f.label && <span className="fb-label">{f.label}</span>}
          <HotNumber value={f.value} step={f.step} fix={f.fix} unit={f.unit} onPreview={(v) => onPreview(f.set(v))} onCommit={(v) => onCommit(f.set(v))} />
        </React.Fragment>
      ))}
      <button className="fb-reset" title="Reset to 100%, centred (Alt+0)" onClick={() => onCommit({ scale: 100, x: 0, y: 0 })}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.2A5 5 0 1 1 3 9.5" /><path d="M3 2.6v3.8h3.8" /></svg>
      </button>
    </div>
  )
}

function HotNumber({ value, step, fix, unit, onPreview, onCommit }) {
  const [editing, setEditing] = useState(false)
  const shown = Number(value.toFixed(fix))
  if (editing) {
    return (
      <input
        className="fb-hot-input"
        autoFocus
        defaultValue={shown}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value)
          setEditing(false)
          if (Number.isFinite(v) && v !== shown) onCommit(v)
        }}
      />
    )
  }
  const down = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const x0 = e.clientX
    let moved = false
    let v = value
    const move = (ev) => {
      const dx = ev.clientX - x0
      if (!moved && Math.abs(dx) < 3) return
      moved = true
      v = value + dx * step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)
      onPreview(v)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) onCommit(v)
      else setEditing(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <span className="fb-hot" onPointerDown={down} title="Drag to change (Shift: faster, Alt: finer) · click to type">
      {shown.toFixed(fix)}
      {unit && <i>{unit}</i>}
    </span>
  )
}
