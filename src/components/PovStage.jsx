// Other people's POVs of the same session, in Review, next to your footage.
// Your recording stays in charge — its tracks, timeline and notes; each POV
// is a picture that follows along (lib/povPlayer.js), lined up by its
// offset (the POV sync window, PovSync.jsx).
//   picture-in-picture   yours big, theirs small in a corner (drag one to
//                        another corner, drag its inner corner to resize)
//   side by side         theirs in a column on the right
//   grid                 everyone the same size
// Click a small one to watch it big — you hear them then, not you; click
// "You" to go back.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { player, mediaUrl } from '../lib/player.js'
import { registerPov, listenTo, stopListening, setListenMix, setBigPov } from '../lib/povPlayer.js'
import { usePlayerTime } from '../lib/hooks.js'
import { fmtTime } from '../lib/time.js'
import { POV_COLORS } from './Timeline.jsx'

export const povColor = (i, p) => (p && p.color) || POV_COLORS[i % POV_COLORS.length]
// your own footage's label and colour (Settings → the POV menu)
export const YOU_DEFAULT = { name: 'You', color: '#e5e7eb' }
export function useYou() {
  const y = useStore((s) => s.settings.povYou)
  return { ...YOU_DEFAULT, ...(y || {}) }
}

const NO_POVS = []
const GAP = 8
const EDGE = 12

export function usePovs() {
  return useStore((s) => (s.currentKey && s.reviews[s.currentKey] && s.reviews[s.currentKey].povs) || NO_POVS)
}

// Where each view goes, in stage pixels: {main: rect, [povKey]: rect}.
export function useCamLayout(stageRef, povs) {
  const focus = useStore((s) => s.povFocus)
  const layout = useStore((s) => s.settings.povLayout) || 'pip'
  const pip = useStore((s) => s.settings.povPip) || { corner: 'br', size: 0.26 }
  const sideW = useStore((s) => s.settings.povSideW) || 0.3
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const W = size.w
  const H = size.h
  const big = focus && povs.some((p) => p.key === focus) ? focus : 'main'
  const ids = ['main', ...povs.map((p) => p.key)]
  const small = ids.filter((id) => id !== big)
  const rects = {}
  if (!povs.length || !W) {
    rects.main = { x: 0, y: 0, w: W, h: H }
    return { rects, big, layout }
  }
  if (layout === 'grid') {
    const order = [big, ...small]
    const cols = Math.ceil(Math.sqrt(order.length))
    const rows = Math.ceil(order.length / cols)
    const cw = (W - GAP * (cols - 1)) / cols
    const ch = (H - GAP * (rows - 1)) / rows
    order.forEach((id, i) => {
      rects[id] = { x: (i % cols) * (cw + GAP), y: Math.floor(i / cols) * (ch + GAP), w: cw, h: ch }
    })
  } else if (layout === 'side') {
    const colW = Math.max(140, Math.min(W * 0.7, W * sideW))
    const each = Math.min((H - GAP * (small.length - 1)) / small.length, (colW * 9) / 16)
    const top = (H - (each * small.length + GAP * (small.length - 1))) / 2
    rects[big] = { x: 0, y: 0, w: W - colW - GAP, h: H }
    small.forEach((id, i) => { rects[id] = { x: W - colW, y: top + i * (each + GAP), w: colW, h: each } })
    rects.divider = { x: W - colW - GAP, y: 0, w: GAP, h: H }
  } else {
    rects[big] = { x: 0, y: 0, w: W, h: H }
    let w = Math.max(120, Math.min(W * 0.6, W * (pip.size || 0.26)))
    let h = (w * 9) / 16
    const fit = (H - 2 * EDGE - GAP * (small.length - 1)) / small.length
    if (h > fit) { h = Math.max(50, fit); w = (h * 16) / 9 }
    const right = (pip.corner || 'br')[1] === 'r'
    const bottom = (pip.corner || 'br')[0] === 'b'
    small.forEach((id, i) => {
      rects[id] = {
        x: right ? W - EDGE - w : EDGE,
        y: bottom ? H - EDGE - h - i * (h + GAP) : EDGE + i * (h + GAP),
        w,
        h
      }
    })
  }
  return { rects, big, layout, W, H, pip }
}

export const rectStyle = (r) => (r ? { left: r.x, top: r.y, width: r.w, height: r.h } : { display: 'none' })

// Small views in picture-in-picture: drag one to another corner of the
// picture; drag its inner corner to make them all bigger or smaller.
// A press that doesn't move is a click (watch that one big).
export function pipPress(e, { stageRef, onClick, layout, small }) {
  if (e.button !== 0) return
  if (layout !== 'pip' || !small) return onClick && onClick()
  e.stopPropagation()
  const stage = stageRef.current.getBoundingClientRect()
  const x0 = e.clientX
  const y0 = e.clientY
  let moved = false
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return
    moved = true
    document.body.classList.add('grabbing')
  }
  const up = (ev) => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('grabbing')
    if (!moved) return onClick && onClick()
    const v = ev.clientY - stage.top > stage.height / 2 ? 'b' : 't'
    const h = ev.clientX - stage.left > stage.width / 2 ? 'r' : 'l'
    const st = useStore.getState()
    st.updateSettings({ povPip: { ...(st.settings.povPip || {}), corner: v + h } })
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

export function PipResize({ stageRef }) {
  const pip = useStore((s) => s.settings.povPip) || { corner: 'br', size: 0.26 }
  const corner = pip.corner || 'br'
  function down(e) {
    e.preventDefault()
    e.stopPropagation()
    const W = stageRef.current.clientWidth
    const x0 = e.clientX
    const s0 = pip.size || 0.26
    const dir = corner[1] === 'r' ? -1 : 1 // dragging toward the middle makes it bigger
    const move = (ev) => {
      const s = Math.max(0.12, Math.min(0.6, s0 + (dir * (ev.clientX - x0)) / W))
      useStore.getState().updateSettings({ povPip: { ...pip, size: Math.round(s * 1000) / 1000 } })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className={'pov-resize c-' + corner} onMouseDown={down} onClick={(e) => e.stopPropagation()} title="Drag to resize" />
}

// One POV: its video (silent unless big), its name, and a note when it has
// no picture at this moment.
export function PovCam({ pov, index, rect, big, layout, stageRef }) {
  const ref = useRef(null)
  const clip = useStore((s) => s.clips.find((c) => c.key === pov.key) || null)
  const masterVol = useStore((s) => s.settings.masterVol ?? 1)
  const [inRange, setInRange] = useState(true)
  const borders = useStore((s) => s.settings.povBorders !== false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !clip) return
    return registerPov(pov.key, el, { off: pov.off || 0, dur: clip.probe && clip.probe.duration, onRange: setInRange })
  }, [pov.key, pov.off, clip && clip.path])
  // big: the viewer window shows it too
  useEffect(() => {
    if (!big) return
    setBigPov(pov.key)
    return () => setBigPov(null)
  }, [big, pov.key])
  // big: you hear it — every one of its tracks, with its own mix
  const povSolo = useStore((s) => s.povSolo)
  useEffect(() => {
    if (!big || !clip) return
    let gone = false
    window.footage.audioFiles(clip).catch(() => ({})).then((files) => {
      if (gone) return
      const p = useStore.getState().reviews[useStore.getState().currentKey]?.povs?.find((x) => x.key === pov.key) || pov
      listenTo(pov.key, { files, video: ref.current, off: p.off || 0, dur: clip.probe && clip.probe.duration, mix: p.mix, solo: useStore.getState().povSolo, master: (useStore.getState().settings.masterVol ?? 1) * (p.vol ?? 1) })
    })
    return () => { gone = true; stopListening() }
  }, [big, clip && clip.path, pov.off])
  // their master (all their tracks together) × the app's master volume
  useEffect(() => { if (big) setListenMix(pov.mix, povSolo, masterVol * (pov.vol ?? 1)) }, [big, pov.mix, pov.vol, povSolo, masterVol])
  const small = !big
  return (
    <div
      className={'cam cam-pov' + (big ? ' big' : ' small') + (inRange ? '' : ' out') + (borders ? ' framed' : '')}
      style={{ ...rectStyle(rect), '--cc': povColor(index, pov) }}
      onMouseDown={(e) => pipPress(e, { stageRef, layout, small, onClick: () => (small ? useStore.getState().setPovFocus(pov.key) : player.toggle()) })}
      onDoubleClick={(e) => { if (small) e.stopPropagation() }}
      title={small ? 'Click to watch ' + pov.name + ' big (you hear them then)' + (layout === 'pip' ? ' · drag to another corner' : '') : undefined}
    >
      {clip ? <video ref={ref} className="pov-video" src={mediaUrl(clip.path)} muted preload="auto" onError={() => setFailed(true)} /> : null}
      <span className="cam-label"><i className="pov-dot" />{pov.name}{big ? <span className="dim"> · their sound</span> : null}</span>
      {(!clip || failed) && <div className="cam-note">Can’t find {pov.name}’s recording</div>}
      {clip && !failed && !inRange && <OutOfRange pov={pov} clip={clip} />}
      {small && layout === 'pip' && <PipResize stageRef={stageRef} />}
      {small && (
        <button className="cam-hide" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); useStore.getState().togglePovsHidden(true) }} title="Hide the POVs for a while (H brings them back)">
          Hide
        </button>
      )}
    </div>
  )
}

function OutOfRange({ pov, clip }) {
  const t = usePlayerTime(500)
  const at = t + (pov.off || 0)
  const dur = (clip.probe && clip.probe.duration) || 0
  const text = at < 0 ? `${pov.name} starts recording in ${fmtTime(-at)}` : `${pov.name} stopped recording ${fmtTime(Math.max(0, at - dur))} ago`
  return <div className="cam-note">{text}</div>
}

// Your own view's label when it isn't the big one.
export function MainCamLabel() {
  const you = useYou()
  return <span className="cam-label"><i className="pov-dot" />{you.name}</span>
}

// A colour swatch that opens the colour picker.
function ColorDot({ value, onChange, title }) {
  return (
    <label className="pov-color" style={{ '--cc': value }} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

// Side by side: drag the line between yours and theirs to make their column
// wider or narrower.
export function SideDivider({ rect, stageRef }) {
  if (!rect) return null
  function down(e) {
    e.preventDefault()
    e.stopPropagation()
    const r = stageRef.current.getBoundingClientRect()
    document.body.classList.add('resizing-ew')
    const move = (ev) => {
      const w = Math.max(0.12, Math.min(0.7, (r.right - ev.clientX) / r.width))
      useStore.getState().updateSettings({ povSideW: Math.round(w * 1000) / 1000 })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="pov-divider" style={rectStyle(rect)} onMouseDown={down} onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().updateSettings({ povSideW: null }) }} title="Drag to resize · double-click to reset" />
}

// The header's POV button: add one, and for each: watch it big, sync, rename,
// remove; plus the layout.
export function PovMenu() {
  const povs = usePovs()
  const focus = useStore((s) => s.povFocus)
  const layout = useStore((s) => s.settings.povLayout) || 'pip'
  const you = useYou()
  const borders = useStore((s) => s.settings.povBorders !== false)
  const hidden = useStore((s) => !!s.settings.povsHidden)
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const st = () => useStore.getState()
  if (!povs.length) {
    return (
      <button className="btn small ghost" onClick={() => st().addPov()} title="Add someone else's recording of this session (their POV) — it plays alongside yours, lined up by sound">
        ＋ POV
      </button>
    )
  }
  return (
    <div className="pov-menu-wrap" ref={ref}>
      <button className={'btn small' + (open ? ' on' : '') + (hidden ? ' pov-hidden' : '')} onClick={() => setOpen((o) => !o)} title={"Other people's POVs of this session" + (hidden ? ' — hidden for now (H shows them)' : '')}>
        {povs.length === 1 ? '1 POV' : povs.length + ' POVs'}{hidden ? ' · hidden' : ''} ▾
      </button>
      {open && (
        <div className="pov-menu">
          <button className="btn small block pov-hide-btn" onClick={() => { st().togglePovsHidden(); setOpen(false) }} title="Hide / show them for a while (H)">
            {hidden ? 'Show the POVs' : 'Hide the POVs for now'} <span className="dim">H</span>
          </button>
          <div className="pov-menu-seg seg">
            {[['pip', 'Corner'], ['side', 'Side by side'], ['grid', 'Grid']].map(([id, label]) => (
              <button key={id} className={layout === id ? 'on' : ''} onClick={() => st().updateSettings({ povLayout: id })}>{label}</button>
            ))}
          </div>
          <div className={'pov-row' + (!focus ? ' on' : '')}>
            <ColorDot value={you.color} onChange={(c) => st().updateSettings({ povYou: { ...you, color: c } })} title="Colour for your own footage" />
            {renaming === 'you' ? (
              <input className="pov-rename" autoFocus defaultValue={you.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }} onBlur={(e) => { const v = e.target.value.trim(); st().updateSettings({ povYou: { ...you, name: v || 'You' } }); setRenaming(null) }} />
            ) : (
              <button className="pov-name" onClick={() => st().setPovFocus(null)} onDoubleClick={() => setRenaming('you')} title="Watch yours big (your tracks) · double-click to rename your label">
                {you.name} <span className="dim small">your tracks</span>
              </button>
            )}
          </div>
          {povs.map((p, i) => (
            <div key={p.key} className={'pov-row' + (focus === p.key ? ' on' : '')}>
              {renaming === p.key ? (
                <input
                  className="pov-rename"
                  autoFocus
                  defaultValue={p.name}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur()
                  }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) st().updatePov(p.key, { name: v }); setRenaming(null) }}
                />
              ) : (
                <>
                <ColorDot value={povColor(i, p)} onChange={(c) => st().updatePov(p.key, { color: c })} title={'Colour for ' + p.name + ' (its border, label and timeline)'} />
                <button className="pov-name" onClick={() => st().setPovFocus(p.key)} onDoubleClick={() => setRenaming(p.key)} title="Watch big (you hear them) · double-click to rename">
                  {p.name}
                  <span className="dim small"> {offsetText(p.off || 0)}</span>
                </button>
                </>
              )}
              <button className="link-btn" onClick={() => { setOpen(false); st().openPovSync(p.key) }} title="Line it up with yours — by sound, or by picking the same moment in both">Sync…</button>
              <button className="link-btn danger" onClick={() => st().removePov(p.key)} title="Take this POV off (the file stays where it is)">Remove</button>
            </div>
          ))}
          <label className="check pov-borders" title="A coloured border around each view, so you can tell whose is whose at a glance">
            <input type="checkbox" checked={borders} onChange={(e) => st().updateSettings({ povBorders: e.target.checked })} /> Coloured borders
          </label>
          <button className="link-btn pov-add" onClick={() => { setOpen(false); st().addPov() }}>＋ Add another POV</button>
        </div>
      )}
    </div>
  )
}

// "+2:05 after you" / "1:12 before you" — when they started recording.
export function offsetText(off) {
  if (Math.abs(off) < 0.05) return 'started with you'
  return off > 0 ? 'started ' + fmtTime(off, true) + ' before you' : 'started ' + fmtTime(-off, true) + ' after you'
}
