// The Voiceover timeline: the section's clips back to back on one lane,
// each with its waveform, mistake markers as red ticks, and — while you
// record — the new take growing at the spot it'll land. Works like Edit's:
// scroll pans, Ctrl/Alt+scroll (or a pinch) zooms at the mouse, middle-drag
// pans, drag the ruler to move the playhead.
//
// On the lane (Move tool):
//   click a clip        → the playhead goes there and the clip is selected
//                         (Ctrl+click adds / removes)
//   drag on a clip      → select a stretch of the timeline (a range); Delete
//                         cuts it out and closes the gap — or, with "cut out
//                         selections instantly" on, as soon as you let go
//   drag a clip's edge  → trim it (the rest ripples)
//   click empty space   → deselect          drag in empty space → a box
//                         that selects the clips it touches
// Cut tool: click a clip to cut it there.
// Drawn on one canvas; the playhead is moved outside React.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { useVo } from '../state/voStore.js'
import * as VM from '../lib/voModel.js'
import { CLIP_LABEL_HEX } from '../lib/editModel.js'
import { voPlayer } from '../lib/voPlayer.js'
import { voRec } from '../lib/voRecorder.js'
import { ensurePeaks, peaksOf, onPeaks } from '../lib/voPeaks.js'
import { fmtTime } from '../lib/time.js'
import { bus, onTick } from '../lib/hooks.js'
import { makeWheelAxis, onFrame, isPinch } from '../lib/wheel.js'
import ZoomBar from './ZoomBar.jsx'
import { trimTip } from '../lib/trimUi.js'

const RULER_H = 28
const LANE_TOP = RULER_H + 10
const MAX_PPS = 600
const EDGE_PX = 8
const SNAP_PX = 8
const DRAG_PX = 4
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

function rgba(hex, a) {
  const h = (hex || '#4fd1c5').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export default function VoTimeline({ section }) {
  const [trimLive, setTrimLive] = useState(null) // clips while an edge is dragged
  const clips = trimLive || (section ? section.clips : [])
  const { items, total } = useMemo(() => VM.layoutVo(clips), [clips])
  const sel = useVo((s) => s.sel)
  const range = useVo((s) => s.range)
  const txHits = useVo((s) => s.txHits)
  const txHidden = useStore((s) => s.settings.voTranscript === false)
  const notesHidden = useStore((s) => s.settings.voNotes === false)
  const rec = useVo((s) => s.rec)
  const project = useStore((s) => s.currentProject())
  const folder = project && project.folder
  const laneSet = useStore((s) => s.settings.voLaneH) // null = a share of the space
  const tool = useStore((s) => s.settings.voTool || 'select')
  const snapOn = useStore((s) => s.settings.voSnap !== false)
  const autoRipple = useStore((s) => !!s.settings.voAutoRipple)
  const [peaksVer, setPeaksVer] = useState(0)
  const takes = useMemo(() => [...new Set(items.map((it) => it.take))], [items])
  useEffect(() => { if (folder && takes.length) ensurePeaks(folder, takes) }, [folder, takes.join(',')])
  useEffect(() => onPeaks(() => setPeaksVer((v) => v + 1)), [])

  // ---- view: seconds at the left edge + pixels per second ----
  const bodyRef = useRef(null)
  const canvasRef = useRef(null)
  const headRef = useRef(null)
  const [width, setWidth] = useState(800)
  const [bodyH, setBodyH] = useState(300)
  const laneH = laneSet || Math.max(90, Math.min(420, Math.round((bodyH - LANE_TOP) * 0.62)))
  const [view, setViewState] = useState({ start: 0, pps: 20 })
  const viewRef = useRef(view)
  const widthRef = useRef(width)
  widthRef.current = width
  if (typeof window !== 'undefined') window.__voTl = { view: () => viewRef.current } // for tests (scripts/cdp.mjs)
  // While recording, the section is as long as it'll be with the new take.
  const liveTotal = () => voPlayer.total + (useVo.getState().rec && useVo.getState().rec.phase === 'recording' ? voRec.dur : 0)
  const setView = (v) => {
    viewRef.current = v
    setViewState(v)
  }
  useEffect(() => {
    const el = bodyRef.current
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setBodyH(el.clientHeight)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    setBodyH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const fitPps = () => Math.max(0.0005, (widthRef.current - 40) / Math.max(10, liveTotal()))
  const fit = () => setView({ start: 0, pps: Math.min(MAX_PPS, Math.max(fitPps(), 4)) })
  const fittedFor = useRef(null)
  useEffect(() => {
    const id = section ? section.id : null
    if (fittedFor.current !== id && width > 100) {
      fittedFor.current = id
      fit()
    }
  }, [section && section.id, width])
  const zoomAt = (factor, x) => {
    const v = viewRef.current
    const t = v.start + x / v.pps
    const lo = Math.min(fitPps(), MAX_PPS, 4)
    const pps = Math.max(lo, Math.min(MAX_PPS, v.pps * factor))
    const maxStart = Math.max(0, liveTotal() - (widthRef.current * 0.6) / pps)
    setView({ start: Math.max(0, Math.min(maxStart, t - x / pps)), pps })
  }
  const zoomGet = useCallback(() => {
    const lo = Math.min(fitPps(), 4)
    if (lo >= MAX_PPS) return 1
    return Math.max(0, Math.min(1, Math.log(viewRef.current.pps / lo) / Math.log(MAX_PPS / lo)))
  }, [])
  const zoomSet = useCallback((z) => {
    const v = viewRef.current
    const lo = Math.min(fitPps(), 4)
    const pps = lo * Math.pow(MAX_PPS / lo, z)
    const px = (voPlayer.getTime() - v.start) * v.pps
    zoomAt(pps / v.pps, px >= 0 && px <= widthRef.current ? px : widthRef.current / 2)
  }, [])

  // Zoom from the keyboard (voKeys.js): in / out around the playhead, or fit.
  useEffect(() => bus.on('voZoom', (dir) => (dir === 0 ? fit() : zoomAt(dir > 0 ? 1.6 : 1 / 1.6, (voPlayer.getTime() - viewRef.current.start) * viewRef.current.pps))), [])

  // Wheel: pan · Ctrl/Alt+wheel: zoom at the mouse · trackpad swipe / pinch.
  // Middle button: no autoscroll (the drag below pans instead).
  useEffect(() => {
    const el = bodyRef.current
    const panAmount = makeWheelAxis()
    const pan = onFrame((dPx) => {
      const v = viewRef.current
      const d = dPx / v.pps
      const maxStart = Math.max(0, liveTotal() - (el.clientWidth * 0.6) / v.pps)
      let start = Math.max(0, v.start + d)
      if (d > 0) start = Math.min(start, Math.max(maxStart, v.start))
      if (start !== v.start) setView({ ...v, start })
    })
    const pinch = onFrame((d, x) => zoomAt(Math.exp(-d * 0.01), x))
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (isPinch(e)) pinch(e.deltaY, e.clientX - rect.left)
      else if (e.altKey || e.ctrlKey) zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - rect.left)
      else pan(panAmount(e))
    }
    const noMiddle = (e) => { if (e.button === 1) e.preventDefault() }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', noMiddle)
    el.addEventListener('auxclick', noMiddle)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', noMiddle)
      el.removeEventListener('auxclick', noMiddle)
    }
  }, [])

  // ---- drawing ----
  const [box, setBox] = useState(null) // the selection box being dragged (body px)
  const gesture = useRef(false) // a mouse gesture is under way: don't scroll the view
  const [hoverEdge, setHoverEdge] = useState(null) // {id, side}: the edge the mouse is on (or is dragging)
  const clickSeek = useStore((s) => s.settings.voClickSeek !== false)
  const draw = () => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const W = widthRef.current
    const H = bodyH
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      cv.style.width = W + 'px'
      cv.style.height = H + 'px'
    }
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink-dim').trim() || '#999'
    const line = css.getPropertyValue('--line').trim() || '#333'
    const accent = css.getPropertyValue('--cyan').trim() || '#4fd1c5'
    const v = viewRef.current
    const tToX = (t) => (t - v.start) * v.pps
    const st = useVo.getState()
    const r = st.rec
    const recording = r && r.phase === 'recording'
    const live = recording ? voRec.dur : 0
    // where the take being recorded sits, and everything after it shifts
    const rep = r && r.replace
    const insAt = r ? (rep ? rep.a : r.idx >= items.length ? total : items[r.idx].start) : Infinity
    // a new clip pushes what's after it along; a redo swaps a stretch for the new length
    const shift = (t) => (rep ? (recording && t >= rep.b - 1e-6 ? t + live - (rep.b - rep.a) : t) : t >= insAt - 1e-6 ? t + live : t)
    const selSet = new Set(st.sel)

    // lane
    const y0 = LANE_TOP
    const mid = y0 + laneH / 2
    const half = laneH / 2 - 8
    const drawWave = (pk, pps, tIn, x0, x1, color) => {
      if (!pk || !pk.length) return
      ctx.fillStyle = color
      ctx.beginPath()
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
        const a = tIn + (x - x0) / v.pps
        const b = a + 1 / v.pps
        const i0 = Math.floor(a * pps)
        const i1 = Math.max(i0 + 1, Math.floor(b * pps))
        if (i0 >= pk.length) break
        let m = 0
        for (let i = Math.max(0, i0); i < Math.min(i1, pk.length); i++) if (pk[i] > m) m = pk[i]
        if (m < 3) continue
        // stored as sqrt(peak): that is already the shape the eye likes
        const hgt = Math.max(1, (m / 255) * half)
        ctx.rect(x, mid - hgt, 1, hgt * 2)
      }
      ctx.fill()
    }
    items.forEach((it, i) => {
      const s = shift(it.start)
      const x0 = tToX(s)
      const x1 = tToX(s + it.dur)
      if (x1 < 0 || x0 > W) return
      const on = selSet.has(it.id)
      const hex = it.clip.color ? CLIP_LABEL_HEX[it.clip.color] : null
      const base = hex || accent
      ctx.fillStyle = hex ? rgba(hex, on ? 0.34 : 0.2) : on ? 'rgba(120, 190, 255, 0.22)' : 'rgba(120, 190, 255, 0.09)'
      ctx.fillRect(x0, y0 + 2, Math.max(1, x1 - x0), laneH - 4)
      const tk = VM.takeOf(it.clip)
      const pk = peaksOf(it.take)
      drawWave(pk, tk.pps || 200, it.in, x0, x1, on ? '#e6f2ff' : base)
      ctx.strokeStyle = on ? '#ffffff' : hex ? rgba(hex, 0.85) : 'rgba(150, 200, 255, 0.45)'
      ctx.lineWidth = on ? 1.5 : 1
      ctx.strokeRect(x0 + 0.5, y0 + 2.5, Math.max(1, x1 - x0) - 1, laneH - 5)
      if (x1 - x0 > 46) {
        ctx.fillStyle = on ? '#fff' : ink
        ctx.font = '600 10px Inter, sans-serif'
        ctx.textBaseline = 'top'
        ctx.fillText('Clip ' + (i + 1) + (it.clip.gain ? '  ' + (it.clip.gain > 0 ? '+' : '') + it.clip.gain + ' dB' : ''), Math.max(x0, 0) + 5, y0 + 6)
      }
      // mistake markers inside this clip
      for (const m of tk.marks || []) {
        if (m < it.in || m > it.out) continue
        const x = tToX(s + m - it.in)
        ctx.fillStyle = '#ff5d6c'
        ctx.fillRect(x - 0.5, y0 + 2, 1.5, laneH - 4)
        ctx.beginPath()
        ctx.moveTo(x, y0 + 2)
        ctx.lineTo(x + 7, y0 + 6)
        ctx.lineTo(x, y0 + 10)
        ctx.fill()
      }
    })
    // the edge that would move / is moving: lit red, with a bracket on the
    // side of the clip it belongs to (Premiere's trim highlight)
    if (hoverEdge) {
      const it = items.find((q) => q.id === hoverEdge.id)
      if (it) {
        const left = hoverEdge.side === 'in'
        const x = tToX(shift(left ? it.start : it.start + it.dur))
        const dir = left ? 1 : -1
        ctx.fillStyle = 'rgba(255, 74, 88, 0.2)'
        ctx.fillRect(left ? x : x - 14, y0 + 2, 14, laneH - 4)
        ctx.strokeStyle = '#ff4a58'
        ctx.lineWidth = 3
        ctx.shadowColor = 'rgba(255, 74, 88, 0.8)'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(x + dir * 9, y0 + 2.5)
        ctx.lineTo(x, y0 + 2.5)
        ctx.lineTo(x, y0 + laneH - 2.5)
        ctx.lineTo(x + dir * 9, y0 + laneH - 2.5)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    }
    // a selected stretch (dragged on the waveform)
    if (st.range) {
      const a = tToX(shift(Math.min(st.range.a, st.range.b)))
      const b = tToX(shift(Math.max(st.range.a, st.range.b)))
      ctx.fillStyle = 'rgba(255, 196, 70, 0.22)'
      ctx.fillRect(a, y0, Math.max(1, b - a), laneH)
      ctx.fillStyle = 'rgba(255, 196, 70, 0.95)'
      ctx.fillRect(a - 0.5, y0, 1.5, laneH)
      ctx.fillRect(b - 0.5, y0, 1.5, laneH)
      const len = Math.abs(st.range.b - st.range.a)
      if (b - a > 40) {
        ctx.fillStyle = '#ffd98a'
        ctx.font = '600 10px "JetBrains Mono", monospace'
        ctx.textBaseline = 'top'
        ctx.fillText(len.toFixed(2) + ' s', a + 5, y0 + laneH - 16)
      }
    }
    // the stretch that's being redone: dimmed, until the new take lands over it
    if (rep) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(tToX(rep.a), y0 + 2, Math.max(1, tToX(rep.b) - tToX(rep.a)), laneH - 4)
    }
    // the take being recorded
    if (r) {
      const x0 = tToX(insAt)
      const x1 = tToX(insAt + live)
      ctx.fillStyle = 'rgba(255, 80, 90, 0.16)'
      ctx.fillRect(x0, y0 + 2, Math.max(2, x1 - x0), laneH - 4)
      if (recording) drawWave(voRec.livePeaks(), voRec.peaksPerSec, 0, x0, x1, '#ff7b86')
      ctx.strokeStyle = '#ff5d6c'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x0 + 0.5, y0 + 2.5, Math.max(2, x1 - x0) - 1, laneH - 5)
      for (const m of r.take.marks || []) {
        const x = tToX(insAt + m)
        ctx.fillStyle = '#ffd1d5'
        ctx.fillRect(x - 0.5, y0 + 2, 1.5, laneH - 4)
      }
    }

    // ruler
    ctx.fillStyle = css.getPropertyValue('--panel-2').trim() || '#1d1f26'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.fillStyle = line
    ctx.fillRect(0, RULER_H - 1, W, 1)
    // transcript search hits: gold ticks hanging from the ruler
    ctx.fillStyle = '#ffd23f'
    for (const h of st.txHits || []) {
      const x = tToX(shift(h))
      if (x >= -2 && x <= W + 2) ctx.fillRect(Math.round(x) - 1, 0, 3, 11)
    }
    const want = 90 / v.pps
    const step = STEPS.find((s) => s >= want) || STEPS[STEPS.length - 1]
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    for (let t = Math.floor(v.start / step) * step; t <= v.start + W / v.pps; t += step) {
      const x = Math.round(tToX(t)) + 0.5
      ctx.fillStyle = line
      ctx.fillRect(x, RULER_H - 10, 1, 10)
      ctx.fillStyle = ink
      ctx.fillText(fmtTime(t, step < 1), x + 3, 9)
      for (let k = 1; k < 5; k++) {
        ctx.fillStyle = line
        ctx.fillRect(Math.round(tToX(t + (k * step) / 5)) + 0.5, RULER_H - 4, 1, 4)
      }
    }
  }
  useEffect(draw)

  // ---- playhead + live redraw while recording + follow ----
  useEffect(() => {
    // on the app's one shared frame ticker (lib/hooks.js), not a loop of its own
    let lastX = null
    const tick = () => {
      const st = useVo.getState()
      const r = st.rec
      const v = viewRef.current
      let t = voPlayer.getTime()
      if (r) {
        const insAt = r.replace ? r.replace.a : r.idx >= voPlayer.items.length ? voPlayer.total : voPlayer.items[r.idx].start
        t = insAt + (r.phase === 'recording' ? voRec.dur : 0)
        if (r.phase === 'recording') draw()
      }
      // keep the playhead in view while it moves on its own
      if (!gesture.current && (voPlayer.playing || (r && r.phase === 'recording')) && (t - v.start) * v.pps > widthRef.current - 30) {
        setView({ ...v, start: t - (widthRef.current * 0.25) / v.pps })
      }
      const x = Math.round((t - viewRef.current.start) * viewRef.current.pps)
      if (x !== lastX && headRef.current) {
        lastX = x
        headRef.current.style.transform = `translateX(${x}px)`
        headRef.current.style.display = x < -8 || x > widthRef.current + 8 ? 'none' : ''
      }
    }
    return onTick(0, tick)
  }, [items, laneH, bodyH])

  // ---- mouse ----
  const local = (e) => {
    const r = bodyRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const tAt = (x) => viewRef.current.start + x / viewRef.current.pps
  const xAt = (t) => (t - viewRef.current.start) * viewRef.current.pps
  // Snap a time to the playhead, clip edges and marks (Snap on).
  const snap = (t, pts) => {
    if (!snapOn) return t
    const tol = SNAP_PX / viewRef.current.pps
    let best = t
    let d = tol
    for (const p of pts) {
      const dd = Math.abs(p - t)
      if (dd < d) {
        d = dd
        best = p
      }
    }
    return best
  }
  const snapPts = () => VM.snapPoints(clips).concat([voPlayer.getTime()])
  const zoneAt = (x, y) => {
    if (y < RULER_H) return { zone: 'ruler' }
    const t = tAt(x)
    if (y >= LANE_TOP && y <= LANE_TOP + laneH) {
      const it = items.find((q) => t >= q.start && t < q.start + q.dur)
      if (it) {
        let edge = null
        if (Math.abs(x - xAt(it.start)) <= EDGE_PX) edge = 'in'
        else if (Math.abs(x - xAt(it.start + it.dur)) <= EDGE_PX) edge = 'out'
        return { zone: 'clip', it, t, edge }
      }
    }
    return { zone: 'empty', t }
  }
  const drag = (move, up) => {
    const mv = (ev) => move(ev)
    gesture.current = true
    const end = (ev) => {
      gesture.current = false
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', end)
      up && up(ev)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', end)
  }
  const onMove = (e) => {
    if (e.buttons) return
    const { x, y } = local(e)
    const z = zoneAt(x, y)
    const el = bodyRef.current
    const onEdge = z.zone === 'clip' && z.edge && tool === 'select' && !useVo.getState().rec
    el.style.cursor = useVo.getState().rec ? 'default' : onEdge ? (z.edge === 'in' ? 'var(--cur-trim-in)' : 'var(--cur-trim-out)') : z.zone === 'clip' ? (tool === 'razor' ? 'crosshair' : 'text') : z.zone === 'ruler' ? 'col-resize' : 'default'
    setHoverEdge((h) => {
      const next = onEdge ? { id: z.it.id, side: z.edge } : null
      return (h && next && h.id === next.id && h.side === next.side) || (!h && !next) ? h : next
    })
  }
  const onLeave = () => { if (!gesture.current) setHoverEdge(null) }
  const onDown = (e) => {
    const st = useVo.getState()
    const { x, y } = local(e)
    // middle button: pan
    if (e.button === 1) {
      e.preventDefault()
      const x0 = e.clientX
      const s0 = viewRef.current.start
      drag((ev) => {
        const v = viewRef.current
        const maxStart = Math.max(0, liveTotal() - (widthRef.current * 0.6) / v.pps)
        setView({ ...v, start: Math.max(0, Math.min(Math.max(maxStart, s0), s0 - (ev.clientX - x0) / v.pps)) })
      })
      return
    }
    if (e.button !== 0 || st.rec) return
    const z = zoneAt(x, y)
    const ctrl = e.ctrlKey || e.metaKey
    if (z.zone === 'ruler') {
      // scrub: drag the playhead along the ruler
      voPlayer.seek(snap(tAt(x), snapPts()))
      drag((ev) => voPlayer.seek(snap(tAt(local(ev).x), snapPts())))
      return
    }
    if (z.zone === 'clip' && tool === 'razor') {
      const next = VM.splitAt(clips, snap(z.t, snapPts()))
      if (next) st.apply(next)
      return
    }
    if (z.zone === 'clip' && z.edge) {
      // trim: the clip's edge moves, the rest ripples
      const c = z.it.clip
      const x0 = e.clientX
      let live = null
      const tip = trimTip()
      st.setRange(null)
      voPlayer.pause()
      setHoverEdge({ id: c.id, side: z.edge })
      document.body.classList.add('trim-' + z.edge)
      drag(
        (ev) => {
          const dt = (ev.clientX - x0) / viewRef.current.pps
          live = VM.trimEdge(section.clips, c.id, z.edge, z.edge === 'in' ? c.in + dt : c.out + dt)
          setTrimLive(live)
          const n = live.find((q) => q.id === c.id)
          tip.set(ev.clientX, ev.clientY, z.edge === 'in' ? c.in - n.in : n.out - c.out)
        },
        () => {
          document.body.classList.remove('trim-' + z.edge)
          tip.remove()
          setTrimLive(null)
          setHoverEdge(null)
          if (live && (live.find((q) => q.id === c.id).in !== c.in || live.find((q) => q.id === c.id).out !== c.out)) st.apply(live)
        }
      )
      return
    }
    if (z.zone === 'clip') {
      // the playhead follows the click; dragging selects a stretch
      const pts = snapPts()
      const t0 = snap(z.t, pts)
      if (clickSeek) voPlayer.seek(t0)
      const x0 = e.clientX
      let dragged = false
      drag(
        (ev) => {
          if (!dragged && Math.abs(ev.clientX - x0) < DRAG_PX) return
          dragged = true
          const t1 = Math.max(0, Math.min(total, snap(tAt(local(ev).x), pts)))
          useVo.setState({ sel: [], range: { a: Math.min(t0, t1), b: Math.max(t0, t1) } })
        },
        () => {
          const s = useVo.getState()
          if (!dragged) {
            s.setRange(null)
            if (ctrl) s.setSel(s.sel.includes(z.it.id) ? s.sel.filter((id) => id !== z.it.id) : [...s.sel, z.it.id])
            else s.setSel([z.it.id])
          } else if (s.range && useStore.getState().settings.voAutoRipple) {
            s.cutRange(s.range.a, s.range.b)
          }
        }
      )
      return
    }
    // empty space: click deselects, drag draws a box that selects what it touches
    const start = { x, y }
    const keep = ctrl ? st.sel : []
    let dragged = false
    st.setRange(null)
    drag(
      (ev) => {
        const p = local(ev)
        if (!dragged && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < DRAG_PX) return
        dragged = true
        const b = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) }
        setBox(b)
        const inLane = b.y1 >= LANE_TOP && b.y0 <= LANE_TOP + laneH
        const hit = inLane ? items.filter((it) => xAt(it.start + it.dur) >= b.x0 && xAt(it.start) <= b.x1).map((it) => it.id) : []
        useVo.getState().setSel([...new Set([...keep, ...hit])])
      },
      () => {
        setBox(null)
        if (!dragged && !ctrl) useVo.getState().setSel([])
      }
    )
  }
  // drag the lane's bottom edge: waveform height
  const onResize = (e) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = laneH
    drag((ev) => useStore.getState().updateSettings({ voLaneH: Math.max(60, Math.min(500, h0 + ev.clientY - y0)) }))
  }

  return (
    <div className="vo-tl">
      <div className="vo-tl-body" ref={bodyRef} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={onLeave}>
        <canvas ref={canvasRef} data-peaks={peaksVer} />
        <div className="vo-head" ref={headRef} />
        {box && <div className="vo-marquee" style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }} />}
        <div className="vo-lane-resize" style={{ top: LANE_TOP + laneH - 3 }} onPointerDown={(e) => { e.stopPropagation(); onResize(e) }} onDoubleClick={() => useStore.getState().updateSettings({ voLaneH: null })} title="Drag to make the waveform taller or shorter · double-click to reset" />
        {!items.length && !rec && <div className="vo-empty dim">Press <kbd>R</kbd> (or the red button) to record. Each recording lands at the playhead.</div>}
        {(txHidden || notesHidden) && (
          <div className="vo-pills" onPointerDown={(e) => e.stopPropagation()}>
            {notesHidden && <button className="vo-tx-show" onClick={() => useStore.getState().updateSettings({ voNotes: true })} title="Show the notes (N)">Show notes</button>}
            {txHidden && (
              <button className="vo-tx-show" onClick={() => useStore.getState().updateSettings({ voTranscript: true })} title="Show the transcript (T)">
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 7h9M2 10.5h12M2 14h7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
                Show transcript
              </button>
            )}
          </div>
        )}
        <div className="vo-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <ZoomBar get={zoomGet} set={zoomSet} onFit={fit} onStep={(dir) => zoomAt(dir > 0 ? 1.6 : 1 / 1.6, (voPlayer.getTime() - viewRef.current.start) * viewRef.current.pps)} fitTitle="Fit the whole section" />
        </div>
      </div>
    </div>
  )
}

