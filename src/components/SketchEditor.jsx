// Sketch notes: draw a quick idea over the paused frame (or a blank page)
// and it's saved as a note at that moment — a PNG in <userData>/sketches,
// shown as a thumbnail in the notes, and exported to Premiere as a still on
// V2 (turned off) at that spot.
//
// Opened with P (Review and Edit) or the pencil button; store.sketch holds
// what's being drawn: {key, t} for a new one, or {key, noteId, file} to
// keep working on a saved one. It opens in its own window, maximized on a
// chosen display (a drawing tablet — the main process picks the display
// with the most pixels by default); the picker in its toolbar moves it.
// A pen's pressure sets the line width.
//   B pen · H highlighter · E eraser · A arrow · R box · O circle · T text
//   Ctrl+Z undo · Enter save · Esc cancel
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../state/store.js'
import { player, mediaUrl } from '../lib/player.js'
import { seqPlayer } from '../lib/seqPlayer.js'

const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#111111']
const TOOLS = [
  { id: 'pen', key: 'b', label: 'Pen', icon: '✎' },
  { id: 'hl', key: 'h', label: 'Highlighter', icon: '▮' },
  { id: 'eraser', key: 'e', label: 'Eraser', icon: '⌫' },
  { id: 'arrow', key: 'a', label: 'Arrow', icon: '↗' },
  { id: 'rect', key: 'r', label: 'Box', icon: '▭' },
  { id: 'ellipse', key: 'o', label: 'Circle', icon: '◯' },
  { id: 'text', key: 't', label: 'Text', icon: 'T' },
]
const MAX_W = 2560 // sharp on a 4K drawing tablet

// The frame the player is showing right now (Review: main video or ghost;
// Edit: the active deck).
function currentFrame() {
  const edit = useStore.getState().settings.workspace === 'edit'
  const el = edit ? seqPlayer.active && seqPlayer.active.video : player.ghostShown && player.ghost && player.ghost.readyState >= 2 ? player.ghost : player.video
  return el && el.readyState >= 2 && el.videoWidth ? el : null
}

// The sketch window: same page (window.open), its own React root, the
// app's styles and theme copied in.
let sketchWin = null
let sketchRoot = null
async function openSketchWindow() {
  if (sketchWin && !sketchWin.closed) {
    sketchWin.focus()
    return
  }
  await window.footage.setSketchDisplay(useStore.getState().settings.sketchDisplay || null)
  const w = window.open('about:blank', 'bijou-sketch')
  if (!w) return
  sketchWin = w
  const doc = w.document
  doc.title = 'Bijou Footage — Sketch'
  const css = [...document.styleSheets].map((ss) => { try { return [...ss.cssRules].map((r) => r.cssText).join('\n') } catch { return '' } }).join('\n')
  const style = doc.createElement('style')
  style.textContent = css
  doc.head.appendChild(style)
  doc.documentElement.style.cssText = document.documentElement.style.cssText // theme colors
  doc.documentElement.dataset.themeKind = document.documentElement.dataset.themeKind || ''
  doc.body.className = document.body.className
  doc.body.style.margin = '0'
  const mount = doc.createElement('div')
  doc.body.appendChild(mount)
  sketchRoot = createRoot(mount)
  sketchRoot.render(<SketchHost />)
  w.addEventListener('beforeunload', () => {
    try { sketchRoot && sketchRoot.unmount() } catch { /* going */ }
    sketchRoot = null
    if (sketchWin === w) sketchWin = null
    if (useStore.getState().sketch) useStore.getState().closeSketch()
  })
}
function closeSketchWindow() {
  if (sketchWin && !sketchWin.closed) sketchWin.close()
}

function SketchHost() {
  const job = useStore((s) => s.sketch)
  return job ? <Editor key={job.noteId || 'new' + job.t} job={job} /> : null
}

// In the main window: opens / closes the sketch window as store.sketch changes.
export default function SketchEditor() {
  const job = useStore((s) => s.sketch)
  useEffect(() => {
    if (job) openSketchWindow()
    else closeSketchWindow()
  }, [job])
  return null
}

// Which display the sketch window is on — switch it here.
function DisplayPicker() {
  const [list, setList] = useState([])
  const refresh = () => window.footage.listDisplays().then(setList)
  useEffect(() => { refresh() }, [])
  const cur = list.find((d) => d.current)
  if (list.length < 2) return null
  return (
    <select
      className="sketch-display"
      value={cur ? cur.id : ''}
      title="Which screen to draw on"
      onChange={async (e) => {
        useStore.getState().updateSettings({ sketchDisplay: e.target.value })
        await window.footage.setSketchDisplay(e.target.value)
        setTimeout(refresh, 400)
      }}
    >
      {list.map((d, i) => (
        <option key={d.id} value={d.id}>{`Screen ${i + 1} · ${d.px}${d.app ? ' (app)' : ''}`}</option>
      ))}
    </select>
  )
}

function Editor({ job }) {
  const bgRef = useRef(null)
  const drawRef = useRef(null)
  const liveRef = useRef(null)
  const wrapRef = useRef(null)
  const [size, setSize] = useState(null) // {w, h}
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(6)
  const [blank, setBlank] = useState(false)
  const [frame, setFrame] = useState(null) // what to draw behind (video frame / saved sketch)
  const [text, setText] = useState(null) // {x, y, value} while typing a label
  const [saving, setSaving] = useState(false)
  const undo = useRef([])

  // Background: the saved sketch (continue it), else the paused frame.
  useEffect(() => {
    if (job.file) {
      const img = new Image()
      img.onload = () => { setFrame(img); setSize({ w: img.naturalWidth, h: img.naturalHeight }) }
      img.src = mediaUrl(job.file) + '?v=' + Date.now()
      return
    }
    const el = currentFrame()
    if (el) {
      const s = Math.min(1, MAX_W / el.videoWidth)
      const c = document.createElement('canvas')
      c.width = Math.round(el.videoWidth * s)
      c.height = Math.round(el.videoHeight * s)
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height)
      setFrame(c)
      setSize({ w: c.width, h: c.height })
    } else {
      setBlank(true)
      setSize({ w: 1280, h: 720 })
    }
  }, [])

  useLayoutEffect(() => {
    if (!size) return
    for (const r of [bgRef, drawRef, liveRef]) { r.current.width = size.w; r.current.height = size.h }
  }, [size])
  useLayoutEffect(() => {
    if (!size) return
    const ctx = bgRef.current.getContext('2d')
    ctx.fillStyle = blank ? '#f7f5f0' : '#000'
    ctx.fillRect(0, 0, size.w, size.h)
    if (!blank && frame) ctx.drawImage(frame, 0, 0, size.w, size.h)
  }, [size, blank, frame])

  const toCanvas = (e) => {
    const r = drawRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h }
  }
  const scale = () => size.w / drawRef.current.getBoundingClientRect().width
  const pushUndo = () => {
    const c = drawRef.current
    undo.current.push(c.getContext('2d').getImageData(0, 0, c.width, c.height))
    if (undo.current.length > 30) undo.current.shift()
  }
  const doUndo = () => {
    const last = undo.current.pop()
    if (last) drawRef.current.getContext('2d').putImageData(last, 0, 0)
  }
  const lineW = () => width * (size.w / 1280) * (tool === 'hl' ? 3.5 : tool === 'eraser' ? 3 : 1)

  function shape(ctx, kind, a, b) {
    ctx.beginPath()
    if (kind === 'rect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    else if (kind === 'ellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    else if (kind === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const head = Math.max(14, lineW() * 3.2)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
    }
    ctx.stroke()
  }
  const style = (ctx) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.lineWidth = lineW()
    ctx.globalAlpha = tool === 'hl' ? 0.35 : 1
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  }

  function down(e) {
    if (e.button !== 0 || !size) return
    e.preventDefault()
    const p = toCanvas(e)
    if (tool === 'text') {
      if (text && text.value) commitText()
      setText({ x: p.x, y: p.y, value: '' })
      return
    }
    pushUndo()
    const ctx = drawRef.current.getContext('2d')
    const live = liveRef.current.getContext('2d')
    let last = p
    if (tool === 'pen' || tool === 'eraser') {
      style(ctx)
      // A dot where it starts (so a tap leaves a mark) — for a pen, as thick
      // as its pressure says: the full-size dot made a blob at the start of
      // every light stroke. No pressure reported yet: no dot, the stroke
      // itself starts the line.
      const pen = e.pointerType === 'pen'
      if (!pen || e.pressure > 0) {
        if (pen) ctx.lineWidth = lineW() * (0.25 + e.pressure * 1.25)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + 0.01, p.y)
        ctx.stroke()
      }
    }
    // The highlighter draws the whole stroke live, then once onto the
    // sketch — see-through ink would otherwise darken where it overlaps.
    const pts = [p]
    const host = e.currentTarget.ownerDocument.defaultView
    const move = (ev) => {
      const q = toCanvas(ev)
      if (tool === 'pen' || tool === 'eraser') {
        // Every sample the pen sent (tablets report far more than one per
        // frame), and its pressure → the line width.
        const samples = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]
        for (const ce of samples.length ? samples : [ev]) {
          const c = toCanvas(ce)
          if (ce.pointerType === 'pen') ctx.lineWidth = lineW() * (0.25 + (ce.pressure || 0) * 1.25)
          ctx.beginPath()
          ctx.moveTo(last.x, last.y)
          ctx.lineTo(c.x, c.y)
          ctx.stroke()
          last = c
        }
        return
      }
      live.clearRect(0, 0, size.w, size.h)
      style(live)
      live.globalCompositeOperation = 'source-over'
      if (tool === 'hl') {
        pts.push(q)
        live.beginPath()
        live.moveTo(pts[0].x, pts[0].y)
        for (const pt of pts) live.lineTo(pt.x, pt.y)
        live.stroke()
      } else shape(live, tool, p, q)
      last = q
    }
    const up = () => {
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', up)
      live.clearRect(0, 0, size.w, size.h)
      if (tool === 'hl') {
        style(ctx)
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (const pt of pts) ctx.lineTo(pt.x, pt.y)
        ctx.stroke()
      } else if (tool !== 'pen' && tool !== 'eraser') {
        style(ctx)
        shape(ctx, tool, p, last)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', up)
  }

  const fontPx = () => Math.round((16 + width * 3) * (size.w / 1280))
  function commitText() {
    if (!text || !text.value.trim()) { setText(null); return }
    pushUndo()
    const ctx = drawRef.current.getContext('2d')
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.font = `700 ${fontPx()}px Inter, 'Segoe UI', sans-serif`
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(3, fontPx() / 6)
    ctx.strokeStyle = color === '#111111' ? '#ffffff' : '#000000' // outline, readable on any footage
    const lines = text.value.split('\n')
    lines.forEach((ln, i) => {
      ctx.strokeText(ln, text.x, text.y + i * fontPx() * 1.2)
      ctx.fillStyle = color
      ctx.fillText(ln, text.x, text.y + i * fontPx() * 1.2)
    })
    setText(null)
  }

  async function save() {
    if (saving) return
    if (text) commitText()
    setSaving(true)
    const out = document.createElement('canvas')
    out.width = size.w
    out.height = size.h
    const ctx = out.getContext('2d')
    ctx.drawImage(bgRef.current, 0, 0)
    ctx.drawImage(drawRef.current, 0, 0)
    const st = useStore.getState()
    const id = job.noteId || 'sk' + Date.now().toString(36)
    const file = await window.footage.saveSketch(id, out.toDataURL('image/png'))
    if (job.noteId) st.updateSketchNote(job.key, job.noteId, file)
    else st.addSketchNote(job.key, job.t, file, id)
    st.closeSketch()
  }
  const cancel = () => useStore.getState().closeSketch()

  // Keys: tools, undo, save, cancel (not while typing a text label).
  useEffect(() => {
    const onKey = (e) => {
      if (text) return
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); cancel() }
      else if (e.key === 'Enter') { e.preventDefault(); save() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo() }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
        if (t) { e.preventDefault(); setTool(t.id) }
      }
    }
    const host = wrapRef.current ? wrapRef.current.ownerDocument.defaultView : window
    host.addEventListener('keydown', onKey, true)
    return () => host.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="sketch-overlay" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div className="sketch-bar">
        <div className="sketch-group">
          {TOOLS.map((t) => (
            <button key={t.id} className={'sketch-tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>{t.icon}</button>
          ))}
        </div>
        <div className="sketch-group">
          {COLORS.map((c) => (
            <button key={c} className={'sketch-color' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} title={c} />
          ))}
        </div>
        <label className="sketch-size" title="Size">
          <input type="range" min="2" max="20" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <div className="sketch-group">
          <button className="sketch-tool" onClick={doUndo} title="Undo (Ctrl+Z)">↶</button>
          <button className="sketch-tool" onClick={() => { pushUndo(); drawRef.current.getContext('2d').clearRect(0, 0, size.w, size.h) }} title="Clear the drawing">✕</button>
        </div>
        {!job.file && (
          <button className={'btn small ghost' + (blank ? ' on' : '')} onClick={() => setBlank(!blank)} title="Draw on the frame, or on a blank page">
            {blank ? 'Blank page' : 'On the frame'}
          </button>
        )}
        <span className="grow" />
        <DisplayPicker />
        <button className="btn small ghost" onClick={cancel}>Cancel</button>
        <button className="btn small primary" onClick={save} disabled={saving || !size}>Save sketch ↵</button>
      </div>
      <div className="sketch-stage" ref={wrapRef}>
        {size && (
          <div className="sketch-canvases" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            <canvas ref={bgRef} />
            <canvas ref={drawRef} />
            <canvas ref={liveRef} className={'sketch-live tool-' + tool} onPointerDown={down} />
            {text && (
              <textarea
                autoFocus
                className="sketch-text"
                value={text.value}
                style={{
                  left: `${(text.x / size.w) * 100}%`,
                  top: `${(text.y / size.h) * 100}%`,
                  color,
                  fontSize: fontPx() / scale() + 'px',
                }}
                onChange={(e) => setText({ ...text, value: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() }
                  if (e.key === 'Escape') { e.preventDefault(); setText(null) }
                }}
                onBlur={commitText}
                placeholder="Type…"
              />
            )}
          </div>
        )}
      </div>
      <div className="sketch-hint dim small">B pen · H highlighter · E eraser · A arrow · R box · O circle · T text · Ctrl+Z undo · Enter save · Esc cancel</div>
    </div>
  )
}
