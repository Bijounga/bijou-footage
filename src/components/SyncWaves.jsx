// The sync window's waveforms: your tracks and theirs, stacked on one
// timeline in YOUR time, theirs shifted by the offset — so you can see the
// same laugh, shot or "let's go" in both and slide theirs until the bumps
// line up.
//   Ctrl+scroll       zoom (at the mouse)        scroll   move along
//   drag their rows   slide theirs against yours (changes the offset)
//   click your rows / the ruler   put the playhead there
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtTime } from '../lib/time.js'

const ROW = 26
const RULER = 18
const LABEL = 96
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600]

export default function SyncWaves({ A, B, off, setOff, t, onSeek, mainNames, mainColors, povName, onCommit }) {
  const wrapRef = useRef(null)
  const cvRef = useRef(null)
  const [w, setW] = useState(600)
  const [view, setView] = useState({ start: Math.max(0, t - 15), pps: 20 }) // pixels per second
  const viewRef = useRef(view)
  viewRef.current = view
  const [drag, setDrag] = useState(null) // live offset while dragging theirs
  const o = drag != null ? drag : off
  const rowsA = A ? A.tracks.map((tr, i) => ({ tr, i })).filter((x) => has(x.tr)) : []
  const rowsB = B ? B.tracks.map((tr, i) => ({ tr, i })).filter((x) => has(x.tr)) : []
  const H = RULER + (rowsA.length + rowsB.length) * ROW + 6

  useLayoutEffect(() => {
    const el = wrapRef.current
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // the playhead runs off the edge (playing / seeking): follow it
  useEffect(() => {
    const v = viewRef.current
    const span = (w - LABEL) / v.pps
    if (t < v.start || t > v.start + span) setView({ ...v, start: Math.max(0, t - span * 0.3) })
  }, [t, w])

  useEffect(() => {
    const el = wrapRef.current
    const onWheel = (e) => {
      e.preventDefault()
      const v = viewRef.current
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left - LABEL
      if (e.ctrlKey || e.altKey) {
        const at = v.start + x / v.pps
        const pps = Math.max(0.05, Math.min(800, v.pps * (e.deltaY < 0 ? 1.3 : 1 / 1.3)))
        setView({ start: Math.max(0, at - x / pps), pps })
      } else {
        const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / v.pps
        setView({ ...v, start: Math.max(0, v.start + d) })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- drawing ----
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(H * dpr)
    cv.style.width = w + 'px'
    cv.style.height = H + 'px'
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, H)
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink-dim').trim() || '#999'
    const line = css.getPropertyValue('--line-soft').trim() || '#333'
    const cyan = css.getPropertyValue('--cyan').trim() || '#4fd1c5'
    const v = view
    const x0 = LABEL
    const tw = w - LABEL
    const tAt = (x) => v.start + (x - x0) / v.pps
    // ruler
    const step = STEPS.find((s) => s * v.pps >= 70) || 3600
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    for (let s = Math.floor(v.start / step) * step; s < v.start + tw / v.pps; s += step) {
      const x = x0 + (s - v.start) * v.pps
      if (x < x0) continue
      ctx.fillStyle = line
      ctx.fillRect(Math.round(x), RULER - 6, 1, 6)
      ctx.fillStyle = ink
      ctx.fillText(step < 1 ? fmtTime(s, true) : fmtTime(s), x + 3, 3)
    }
    // a row of peaks; `shift` = their time − your time
    const drawRow = (tr, pps, y, color, shift) => {
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      ctx.fillRect(x0, y + 1, tw, ROW - 2)
      ctx.fillStyle = color
      const mid = y + ROW / 2
      const half = ROW / 2 - 2
      ctx.beginPath()
      for (let px = 0; px < tw; px++) {
        const a = tAt(x0 + px) + shift
        const b = a + 1 / v.pps
        const i0 = Math.floor(a * pps)
        const i1 = Math.max(i0 + 1, Math.floor(b * pps))
        if (i1 <= 0 || i0 >= tr.length) continue
        let m = 0
        for (let i = Math.max(0, i0); i < Math.min(i1, tr.length); i++) if (tr[i] > m) m = tr[i]
        if (m < 4) continue
        const h = Math.max(0.5, (m / 255) * half)
        ctx.rect(x0 + px, mid - h, 1, h * 2)
      }
      ctx.fill()
    }
    let y = RULER
    ctx.textBaseline = 'middle'
    ctx.font = '600 10.5px Inter, sans-serif'
    for (const r of rowsA) {
      drawRow(r.tr, A.pps, y, mainColors[r.i] || cyan, 0)
      ctx.fillStyle = ink
      ctx.fillText(clip(mainNames[r.i] || 'Track ' + (r.i + 1), 12), 6, y + ROW / 2)
      y += ROW
    }
    // a divider between yours and theirs
    ctx.fillStyle = line
    ctx.fillRect(0, y + 1, w, 1)
    y += 3
    for (const r of rowsB) {
      drawRow(r.tr, B.pps, y, drag != null ? '#f5c542' : 'rgba(245, 197, 66, 0.85)', o)
      ctx.fillStyle = ink
      ctx.fillText(clip(povName, 8) + ' ' + (r.i + 1), 6, y + ROW / 2)
      y += ROW
    }
    // playhead
    const px = x0 + (t - v.start) * v.pps
    if (px >= x0 && px <= w) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(Math.round(px), 0, 1, H)
    }
  }, [A, B, view, w, H, t, o, drag, mainNames.join(), povName])

  function down(e) {
    if (e.button !== 0) return
    const r = wrapRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (x < LABEL) return
    const v = viewRef.current
    const theirs = y > RULER + rowsA.length * ROW + 2
    if (!theirs) {
      // yours / the ruler: the playhead goes here (drag to scrub)
      const seek = (ev) => onSeek(Math.max(0, v.start + (ev.clientX - r.left - LABEL) / v.pps))
      seek(e)
      const up = () => { window.removeEventListener('mousemove', seek); window.removeEventListener('mouseup', up) }
      window.addEventListener('mousemove', seek)
      window.addEventListener('mouseup', up)
      return
    }
    // theirs: slide it — dragging right shows their sound later against yours
    e.preventDefault()
    const x0 = e.clientX
    const o0 = off
    document.body.classList.add('grabbing')
    let last = o0
    const move = (ev) => {
      last = Math.round((o0 - (ev.clientX - x0) / v.pps) * 1000) / 1000
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('grabbing')
      setDrag(null)
      if (last !== o0) { setOff(last); onCommit && onCommit(last) }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const zoom = (f) => {
    const v = viewRef.current
    const pps = Math.max(0.05, Math.min(800, v.pps * f))
    const span = (w - LABEL) / pps
    setView({ start: Math.max(0, t - span / 2), pps })
  }
  return (
    <div className="sw">
      <div className="sw-bar">
        <span className="dim small">Your tracks and theirs — drag theirs (yellow) until the bumps line up · Ctrl+scroll zooms</span>
        <span className="vo-tx-spacer" />
        <button className="mini-btn" onClick={() => zoom(1 / 2)} title="Zoom out">−</button>
        <button className="mini-btn" onClick={() => zoom(2)} title="Zoom in (around the playhead)">+</button>
        <button className="mini-btn" onClick={() => setView({ start: Math.max(0, t - 4), pps: Math.max(60, (w - LABEL) / 8) })} title="Zoom right in at the playhead (8 seconds)">Close up</button>
      </div>
      <div className="sw-canvas" ref={wrapRef} onMouseDown={down} style={{ height: H }}>
        {A && B ? <canvas ref={cvRef} /> : <div className="dim small sw-wait">Getting the waveforms ready…</div>}
      </div>
    </div>
  )
}

function has(tr) {
  for (let i = 0; i < tr.length; i += 25) if (tr[i] > 30) return true
  return false
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
