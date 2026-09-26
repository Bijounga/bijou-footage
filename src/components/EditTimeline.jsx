import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { bus, onTick } from '../lib/hooks.js'
import { fmtTime } from '../lib/time.js'
import { noteHex, MARKER_COLORS } from '../lib/beats.js'
import * as EM from '../lib/editModel.js'
import { clipTitle } from './Library.jsx'
import { parseWaveform, TrackHead } from './Timeline.jsx'
import { peakBetween, speechRuns } from '../lib/wavePeaks.js'
import { makeWheelAxis, onFrame, isPinch } from '../lib/wheel.js'
import ZoomBar from './ZoomBar.jsx'
import { setWave, speechSegments } from '../lib/speech.js'

// Waveform peaks per recording (the same .bwf files Review draws), loaded
// once and shared by every clip cut from that recording.
const waves = new Map() // key -> {version, wave|null}
function useWaves(keys, byKey) {
  // Only this section's recordings' waveform versions — not every progress
  // tick of background prep (which would re-render the timeline 4×/s).
  const versions = useStore((s) => keys.map((k) => (s.waveforms[k] && s.waveforms[k].version) || 0).join(','))
  const wfState = useStore.getState().waveforms
  const [ver, bump] = useState(0)
  useEffect(() => {
    let dead = false
    for (const key of keys) {
      const clip = byKey.get(key)
      if (!clip) continue
      const version = (wfState[key] && wfState[key].version) || 0
      const have = waves.get(key)
      if (have && (have.version === version || have.loading)) continue
      waves.set(key, { version, wave: have ? have.wave : null, loading: true })
      window.footage.getWaveform(clip).then((u8) => {
        const wave = parseWaveform(u8)
        waves.set(key, { version, wave, loading: false })
        if (wave) setWave(key, wave) // speech spans (A) and Ctrl+→ in the cut use it
        if (!wave) window.footage.requestWaveform(clip, true) // not prepared yet: jump the queue
        if (!dead) bump((n) => n + 1)
      })
    }
    return () => { dead = true }
    // byKey: the app can open in Edit before the library scan has found the
    // recordings — try again once it has.
  }, [keys.join('|'), versions, byKey])
  return { waves, ver }
}

// One canvas per audio row, across the visible width: each clip's slice of
// its recording's waveform for that track, mirrored around the middle.
// It also draws the audio clips' boxes (a rough cut can have hundreds;
// one element each made panning crawl) — clicks find the clip by position.
function WaveRow({ track, items, view, width, height, color, byKey, waveMap, wavesVer, speech, sens, selSet, shift }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.max(1, Math.round(width * dpr))
    cv.height = Math.round(height * dpr)
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    drawAudioClips(ctx, track, items, view, width, height, color, byKey, selSet)
    const mid = height / 2
    const amp = height / 2 - 4
    // Everything goes into one value per pixel column first (loudest peak,
    // talking or not), then one path per fill — so a cut with hundreds of
    // clips draws no more than a cut with one.
    const W = Math.ceil(width)
    const cols = new Uint8Array(W)
    const talk = speech ? new Uint8Array(W) : null
    for (const it of items) {
      const x0 = Math.max(0, Math.floor((it.start - view.start) * view.pps))
      const x1 = Math.min(W, Math.ceil((it.start + it.dur - view.start) * view.pps))
      if (x1 <= x0) continue
      const w = waveMap.get(it.key)
      const data = w && w.wave && w.wave.tracks[track]
      if (!data) continue
      const wpps = w.wave.pps
      const clip = byKey.get(it.key)
      if (clip && clip.probe && clip.probe.audio[track] && clip.probe.audio[track].likelySilent) continue
      // A: where someone's talking on this track, as a tint + a bar.
      if (talk) {
        const toX = (t) => (it.start + t - it.in - view.start) * view.pps
        const tA = it.in + (x0 / view.pps + view.start - it.start)
        const tB = it.in + (x1 / view.pps + view.start - it.start)
        for (const [ra, rb] of speechRuns(speechSegments(it.key, track, sens), Math.max(it.in, tA), Math.min(it.out, tB), toX)) {
          for (let x = Math.max(0, ra); x < Math.min(W, rb); x++) talk[x] = 1
        }
      }
      // this clip's part of each column (clips < 1px share a column)
      const lo = Math.max(it.in, 0)
      for (let x = x0; x < x1; x++) {
        const t0 = Math.max(lo, it.in + (view.start + x / view.pps - it.start))
        const t1 = Math.min(it.out, it.in + (view.start + (x + 1) / view.pps - it.start))
        const i0 = Math.floor(t0 * wpps)
        const peak = peakBetween(data, i0, Math.max(i0 + 1, Math.ceil(t1 * wpps)))
        if (peak > cols[x]) cols[x] = peak
      }
    }
    ctx.fillStyle = color
    if (talk) {
      const tint = new Path2D()
      const bar = new Path2D()
      for (let x = 0; x < W; x++) {
        if (!talk[x]) continue
        let e = x
        while (e < W && talk[e]) e++
        tint.rect(x, 0, e - x, height)
        bar.rect(x, height - 3, e - x, 2)
        x = e
      }
      ctx.globalAlpha = 0.12
      ctx.fill(tint)
      ctx.globalAlpha = 0.9
      ctx.fill(bar)
      ctx.globalAlpha = 1
    }
    // The same shape as a 1px bar per column, as one outline per loud
    // stretch — far fewer shapes for the GPU than thousands of bars.
    const wave = new Path2D()
    const hs = new Float32Array(W)
    for (let x = 0; x < W; x++) hs[x] = (cols[x] / 255) * amp
    for (let x = 0; x < W; ) {
      if (hs[x] <= 0.4) { x++; continue }
      let e = x
      while (e < W && hs[e] > 0.4) e++
      wave.moveTo(x, mid - hs[x])
      for (let k = x; k < e; k++) {
        wave.lineTo(k, mid - hs[k])
        wave.lineTo(k + 1, mid - hs[k])
      }
      for (let k = e - 1; k >= x; k--) {
        wave.lineTo(k + 1, mid + hs[k])
        wave.lineTo(k, mid + hs[k])
      }
      wave.closePath()
      x = e
    }
    ctx.fill(wave)
    // Redraw only when something drawn changed (it's the expensive part).
  }, [items, view, width, height, color, wavesVer, speech, sens, selSet])
  return <canvas ref={ref} className="et-wave" style={{ width, height, transform: `translateX(${shift}px)` }} />
}

const hasAudio = (byKey, it, track) => !!((byKey.get(it.key) || {}).probe?.audio || [])[track]

// Boxes as .et-aclip used to look: a light tint of the track colour, a
// border, white when selected, dashed + faint when the track is silent.
function drawAudioClips(ctx, track, items, view, width, height, color, byKey, selSet) {
  // Clips under THIN px share pixel columns when zoomed far out; they're
  // merged into runs first — a path of hundreds of overlapping boxes is
  // very slow for the GPU to fill, the same area as a few runs is not.
  const THIN = 3
  const W = Math.ceil(width)
  const col = new Uint8Array(W) // thin clips: 1 silent, 2 clip, 3 selected (highest wins)
  const body = new Path2D()
  const selBody = new Path2D()
  const empty = new Path2D()
  const line = new Path2D()
  const selLine = new Path2D()
  const seams = new Path2D() // narrow clips: a 1px divider instead of an outline
  let any = false
  for (const it of items) {
    const xa = (it.start - view.start) * view.pps
    const xb = xa + it.dur * view.pps
    if (xb < -2 || xa > width + 2) continue
    const a = ((byKey.get(it.key) || {}).probe?.audio || [])[track]
    if (!a) continue
    any = true
    const w = xb - xa
    const sel = selSet.has(it.id)
    if (w < THIN) {
      const k = a.likelySilent ? 1 : sel ? 3 : 2
      for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.ceil(xb)); x++) if (k > col[x]) col[x] = k
      continue
    }
    if (a.likelySilent) {
      empty.rect(xa + 0.5, 4.5, w - 1, height - 9)
      continue
    }
    // Outlines (strokes) are the slow part to draw: only clips wide enough
    // to show one get it.
    if (w >= 24) {
      ;(sel ? selBody : body).roundRect(xa, 4, w, height - 8, 4)
      ;(sel ? selLine : line).roundRect(xa + 0.5, 4.5, w - 1, height - 9, 4)
    } else {
      ;(sel ? selBody : body).rect(xa, 4, w, height - 8)
      seams.rect(Math.round(xa), 4, 1, height - 8)
    }
  }
  if (!any) return
  const faint = new Path2D()
  for (let x = 0; x < W; x++) {
    const k = col[x]
    if (!k) continue
    let e = x
    while (e < W && col[e] === k) e++
    ;(k === 3 ? selBody : k === 2 ? body : faint).rect(x, 4, e - x, height - 8)
    x = e - 1
  }
  ctx.fillStyle = color
  ctx.globalAlpha = 0.1
  ctx.fill(body)
  ctx.globalAlpha = 0.04
  ctx.fill(faint)
  ctx.globalAlpha = 0.22
  ctx.fill(selBody)
  ctx.globalAlpha = 0.55
  ctx.fill(seams)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.55
  ctx.stroke(line)
  ctx.globalAlpha = 0.45 * 0.55
  ctx.setLineDash([3, 3])
  ctx.stroke(empty)
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#fff'
  ctx.stroke(selLine)
}

// V1 clips too thin to be worth an element (zoomed far out on a long cut):
// painted here instead, merged per pixel column; wider ones are real
// elements on top.
const DOM_MIN_PX = 14 // = where a clip gets its trim handles
function ThinClips({ items, view, width, height, selSet, byKey, shift }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.max(1, Math.round(width * dpr))
    cv.height = Math.round(height * dpr)
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const W = Math.ceil(width)
    const palette = ['']
    const index = new Map()
    const col = new Uint8Array(W) // palette index per column
    const selCol = new Uint8Array(W)
    const seams = new Path2D()
    for (const it of items) {
      const w = it.dur * view.pps
      if (w >= DOM_MIN_PX) continue
      const xa = (it.start - view.start) * view.pps
      if (xa + w < -2 || xa > width + 2) continue
      const c = !byKey.get(it.key) ? '#e2665b' : it.color ? EM.CLIP_LABEL_HEX[it.color] || '#5b7bd6' : '#5b7bd6'
      let k = index.get(c)
      if (k == null) {
        k = palette.push(c) - 1
        index.set(c, k)
      }
      const sel = selSet.has(it.id)
      for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.max(Math.floor(xa) + 1, Math.ceil(xa + w))); x++) {
        col[x] = k
        if (sel) selCol[x] = 1
      }
      if (w >= 3 && xa >= 0) seams.rect(Math.round(xa), 5, 1, height - 10)
    }
    const runs = (arr, draw) => {
      for (let x = 0; x < W; x++) {
        const k = arr[x]
        if (!k) continue
        let e = x
        while (e < W && arr[e] === k) e++
        draw(k, x, e - x)
        x = e - 1
      }
    }
    const fills = palette.map(() => new Path2D())
    runs(col, (k, x, n) => fills[k].rect(x, 5, n, height - 10))
    ctx.globalAlpha = 0.55
    for (let k = 1; k < palette.length; k++) {
      ctx.fillStyle = palette[k]
      ctx.fill(fills[k])
    }
    const sels = new Path2D()
    runs(selCol, (k, x, n) => sels.rect(x, 5, n, height - 10))
    ctx.globalAlpha = 0.7
    ctx.fillStyle = '#dfe6ff'
    ctx.fill(sels)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#0f1014'
    ctx.fill(seams)
    ctx.globalAlpha = 1
  }, [items, view, width, height, selSet, byKey])
  return <canvas ref={ref} className="et-wave" style={{ width, height, transform: `translateX(${shift}px)` }} />
}

// One clip on V1. Memoized: re-renders only when this clip, its selection,
// the zoom or the tool changes — not while panning.
const VClip = React.memo(function VClip({ it, x, pps, sel, c, notes, tool, beatColors, h }) {
  const w = it.dur * pps
  return (
    <div
      className={'et-clip' + (sel ? ' sel' : '') + (c ? '' : ' missing') + (it.color ? ' colored' : '')}
      style={{ left: x, width: Math.max(2, w), '--lc': it.color ? EM.CLIP_LABEL_HEX[it.color] : undefined }}
      onMouseDown={(e) => h.current.clipDown(e, it)}
      onContextMenu={(e) => h.current.clipContext(e, it)}
      onDoubleClick={(e) => h.current.matchFrame(e, it)}
      title={(c ? clipTitle(c) + ' · ' + c.name : 'Missing recording') + `\n${fmtTime(it.in)}–${fmtTime(it.out)} of the recording · ${fmtTime(it.dur, true)} long`}
    >
      {w > 14 && tool === 'select' && (
        <>
          <i className="et-edge l" onMouseDown={(e) => h.current.edgeDown(e, it, 'in')} title="Drag to trim the start (the rest slides along)" />
          <i className="et-edge r" onMouseDown={(e) => h.current.edgeDown(e, it, 'out')} title="Drag to trim the end (the rest slides along)" />
        </>
      )}
      {w > 40 && (
        <span className="et-clip-label">
          {c ? clipTitle(c) : 'Missing'} <span className="dim">{fmtTime(it.in)}</span>
        </span>
      )}
      {notes.map((n) => (
        <i key={n.id} className={'et-mark' + (n.type === 'MARKER' ? ' m' : '')} style={{ left: (n.t - it.in) * pps, '--c': noteHex(n, beatColors) }} title={n.text || n.type} />
      ))}
    </div>
  )
})

const HEAD_W = 214
const RULER_H = 30
const MAX_PPS = 400 // closest zoom: pixels per second
const V_H = 58
const A_H = 44
const SNAP_PX = 8
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

// The edit timeline: V1 with the cuts, one audio row per OBS track under
// it (linked — they move with the picture), a ruler to scrub on. DOM, not
// canvas: a section has tens to a few hundred clips, and real elements make
// select / drag / cut simple. Only the playhead moves every frame (by
// transform, outside React).
export default function EditTimeline({ section }) {
  // While an edge is being dragged, the timeline shows the trimmed cut live.
  const [trimLive, setTrimLive] = useState(null) // clips being previewed
  const clips = trimLive || (section ? section.clips : [])
  const items = useMemo(() => EM.layout(clips).items, [clips])
  const total = items.length ? items[items.length - 1].start + items[items.length - 1].dur : 0
  const allClips = useStore((s) => s.clips)
  const reviews = useStore((s) => s.reviews)
  const beatColors = useStore((s) => s.beatColors)
  const trackNames = useStore((s) => s.settings.trackNames)
  const colors = useTrackColors()
  const mixer = useStore((s) => s.settings.mixer)
  const solo = useStore((s) => s.solo)
  const laneH = useStore((s) => s.settings.editLaneHeights) || [44, 44, 44, 44, 44, 44]
  const speechShow = useStore((s) => s.settings.speechShow) || []
  const speechSkip = useStore((s) => s.settings.speechSkip) || []
  const sens = useStore((s) => s.settings.speechSensitivity ?? 0.5)
  const meterRefs = useRef([])
  const sel = useStore((s) => s.editSel)
  const selSet = useMemo(() => new Set(sel), [sel])
  const tool = useStore((s) => s.editTool)
  const snapOn = useStore((s) => s.settings.editSnap !== false)
  const byKey = useMemo(() => new Map(allClips.map((c) => [c.key, c])), [allClips])
  const nTracks = Math.max(1, ...items.map((it) => ((byKey.get(it.key) || {}).probe?.audio || []).length))
  const waveKeys = useMemo(() => [...new Set(items.map((it) => it.key))], [items])
  const { waves: waveMap, ver: wavesVer } = useWaves(waveKeys, byKey)

  // ---- view: seconds at the left edge + pixels per second ----
  const bodyRef = useRef(null)
  const [width, setWidth] = useState(800)
  const [view, setViewState] = useState({ start: 0, pps: 1 })
  const viewRef = useRef(view)
  const totalRef = useRef(total)
  totalRef.current = total
  // The ref updates immediately, so quick successive zoom / pan steps (key
  // repeats, fast wheel) each build on the last one, not on a stale render.
  const setView = (v) => {
    viewRef.current = v
    setViewState(v)
  }
  useEffect(() => {
    const el = bodyRef.current
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const fit = () => setView({ start: 0, pps: Math.max(0.0005, (width - 40) / Math.max(10, total)) })
  // Fit when a different section opens (and on first layout).
  const fittedFor = useRef(null)
  useEffect(() => {
    const id = section ? section.id : null
    if (fittedFor.current !== id && width > 100) {
      fittedFor.current = id
      fit()
    }
  }, [section && section.id, width])
  // Footage was ADDED (＋, drop, E from Review) and now runs past the right
  // edge: fit again. Only then — never on cuts, trims, extending an edge,
  // undo… which keep your zoom.
  const pendingFit = useRef(false)
  useEffect(() => bus.on('editAdded', () => { pendingFit.current = true }), [])
  useEffect(() => {
    if (!pendingFit.current) return
    pendingFit.current = false
    if ((total - view.start) * view.pps > width) fit()
  }, [total])

  const tToX = (t) => (t - view.start) * view.pps
  const xToT = (x) => view.start + x / view.pps
  // Zoom limits: out to where the whole section fits (no further — it would
  // just shrink into the corner), in to MAX_PPS.
  const fitPps = () => Math.max(0.0005, (widthRef.current - 40) / Math.max(10, totalRef.current))
  const zoomAt = (factor, x) => {
    const v = viewRef.current
    const t = v.start + x / v.pps
    const lo = Math.min(fitPps(), MAX_PPS)
    const pps = Math.max(lo, Math.min(MAX_PPS, v.pps * factor))
    const maxStart = Math.max(0, totalRef.current - (widthRef.current * 0.6) / pps)
    setView({ start: Math.max(0, Math.min(maxStart, t - x / pps)), pps })
  }
  // The zoom bar: 0 = fit … 1 = MAX_PPS, on a log scale; zooms around the
  // playhead when it's on screen, else the middle.
  const zoomGet = useCallback(() => {
    const lo = fitPps()
    if (lo >= MAX_PPS) return 1
    return Math.max(0, Math.min(1, Math.log(viewRef.current.pps / lo) / Math.log(MAX_PPS / lo)))
  }, [])
  const zoomSet = useCallback((z) => {
    const v = viewRef.current
    const lo = fitPps()
    const pps = lo * Math.pow(MAX_PPS / lo, z)
    const px = (seqPlayer.getTime() - v.start) * v.pps
    zoomAt(pps / v.pps, px >= 0 && px <= widthRef.current ? px : widthRef.current / 2)
  }, [])
  useEffect(() => bus.on('editZoom', (dir) => (dir === 0 ? fit() : zoomAt(dir > 0 ? 1.6 : 1 / 1.6, (seqPlayer.getTime() - viewRef.current.start) * viewRef.current.pps))), [width, total])

  // Wheel: pan · Alt+wheel: zoom at the cursor (same as Review).
  // Trackpad: a sideways swipe pans (lib/wheel.js keeps a swipe on one
  // axis), a pinch zooms smoothly; events are gathered into one update per
  // frame.
  useEffect(() => {
    const el = bodyRef.current
    const panAmount = makeWheelAxis()
    const pan = onFrame((dPx) => {
      const v = viewRef.current
      const d = dPx / v.pps
      // Not past the end: the cut's end stays at least 40% into the view.
      const maxStart = Math.max(0, totalRef.current - (el.clientWidth * 0.6) / v.pps)
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
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- playhead (outside React) + follow while playing ----
  const headRef = useRef(null)
  const razorRef = useRef(null)
  // Per frame, but only what changed: the playhead moves when it's shifted a
  // pixel; meters update at ~30 fps and only while playing. The width comes
  // from state (reading clientWidth here would force a layout every frame).
  const widthRef = useRef(width)
  widthRef.current = width
  useEffect(() => {
    let lastX = null
    let lastMeters = 0
    let metersZero = false
    return onTick(16, () => {
      const v = viewRef.current
      const t = seqPlayer.getTime()
      const x = Math.round((t - v.start) * v.pps)
      if (x !== lastX && headRef.current) {
        lastX = x
        headRef.current.style.transform = `translateX(${x}px)`
      }
      const now = performance.now()
      const playing = seqPlayer.playing
      if ((playing && now - lastMeters > 33) || (!playing && !metersZero)) {
        lastMeters = now
        metersZero = !playing
        const lv = playing ? seqPlayer.levels() : []
        meterRefs.current.forEach((el, i) => {
          if (!el) return
          const db = lv[i] > 0 ? 20 * Math.log10(lv[i]) : -60
          const sc = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 100) / 100
          if (el._sc !== sc) { el._sc = sc; el.style.transform = `scaleX(${sc})` }
        })
      }
      if (playing && !dragRef.current && (x > widthRef.current - 30 || x < 0)) setView({ ...v, start: Math.max(0, t - 30 / v.pps) })
    })
  }, [])

  // ---- snapping ----
  // toPlayhead: also snap to the playhead (the cut tool) — never while
  // scrubbing, where it would stick to itself.
  const snapT = (t, { exclude, toPlayhead = false } = {}) => {
    if (!snapOn) return t
    const cands = EM.cutPoints(clips)
    for (const m of (section && section.markers) || []) cands.push(m.t)
    for (const it of items) {
      const notes = (reviews[it.key] && reviews[it.key].notes) || []
      for (const n of notes) if (n.type !== 'BREAK' && n.t >= it.in && n.t < it.out) cands.push(it.start + n.t - it.in)
    }
    if (toPlayhead) cands.push(seqPlayer.getTime())
    let best = t
    let bestPx = SNAP_PX
    for (const c of cands) {
      if (exclude != null && Math.abs(c - exclude) < 1e-6) continue
      const d = Math.abs(c - t) * view.pps
      if (d < bestPx) {
        bestPx = d
        best = c
      }
    }
    return best
  }

  // ---- mouse ----
  const dragRef = useRef(null)
  const [dropAt, setDropAt] = useState(null) // insertion x while moving / dropping
  const localX = (e) => e.clientX - bodyRef.current.getBoundingClientRect().left
  // The clip under x (px) — for the clips drawn on canvases.
  const itemAtX = (x) => {
    const t = xToT(x)
    let lo = 0
    let hi = items.length - 1
    let k = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (items[m].start <= t) { k = m; lo = m + 1 } else hi = m - 1
    }
    const it = items[k]
    return it && t < it.start + it.dur ? it : null
  }
  // Mouse down on a row (not on a clip element): a painted clip there acts
  // like a clip; empty space starts the selection box.
  function rowDown(e, track) {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const it = itemAtX(localX(e))
    if (it && (track == null || hasAudio(byKey, it, track))) return clipDown(e, it)
    rowsDown(e)
  }
  function rowContext(e, track) {
    if (e.target !== e.currentTarget) return
    const it = itemAtX(localX(e))
    if (it && (track == null || hasAudio(byKey, it, track))) clipContext(e, it)
  }
  // A recording's notes, sorted once; each clip takes its slice.
  const notesByKey = useMemo(() => {
    const m = new Map()
    for (const k of waveKeys) {
      const r = reviews[k]
      if (r && r.notes) m.set(k, r.notes.filter((n) => n.type !== 'BREAK').sort((a, b) => a.t - b.t))
    }
    return m
  }, [reviews, waveKeys])
  const notesIn = (it) => {
    const ns = notesByKey.get(it.key)
    if (!ns) return []
    let lo = 0
    let hi = ns.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (ns[m].t < it.in) lo = m + 1
      else hi = m
    }
    const out = []
    for (let k = lo; k < ns.length && ns[k].t < it.out; k++) out.push(ns[k])
    return out
  }

  // Drag on empty timeline space: a box that selects every clip it touches
  // (Shift adds to the selection). A plain click just moves the playhead.
  const [box, setBox] = useState(null) // {x0, x1, y0, y1} in body px
  function rowsDown(e) {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const st = useStore.getState()
    const rect = bodyRef.current.getBoundingClientRect()
    const x0 = e.clientX - rect.left
    const y0 = e.clientY - rect.top
    const base = e.shiftKey || e.ctrlKey ? st.editSel : []
    let dragging = false
    const move = (ev) => {
      const x1 = ev.clientX - rect.left
      const y1 = ev.clientY - rect.top
      if (!dragging && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 5) return
      dragging = true
      setBox({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) })
      const t0 = xToT(Math.min(x0, x1))
      const t1 = xToT(Math.max(x0, x1))
      const hit = items.filter((it) => it.start < t1 && it.start + it.dur > t0).map((it) => it.id)
      st.setEditSel([...new Set([...base, ...hit])])
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setBox(null)
      if (!dragging) {
        st.setEditSel([])
        seqPlayer.seek(snapT(Math.max(0, Math.min(total, xToT(x0)))))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Timeline markers on the ruler: click = jump · Alt+drag = move ·
  // right-click = colour / delete · double-click = name it (Notes panel).
  const markers = (section && section.markers) || []
  const [mkMenu, setMkMenu] = useState(null) // {id, x, y}
  const [clipMenu, setClipMenu] = useState(null) // {ids, x, y}
  useEffect(() => {
    if (!clipMenu) return
    const close = (ev) => { if (!ev.target.closest('.et-clipmenu')) setClipMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [clipMenu])
  // Right-click a clip: colour it (all selected clips, if it's one of them).
  function clipContext(e, it) {
    e.preventDefault()
    const st = useStore.getState()
    const ids = st.editSel.includes(it.id) ? st.editSel : [it.id]
    if (!st.editSel.includes(it.id)) st.setEditSel(ids)
    setClipMenu({ ids, x: e.clientX, y: e.clientY })
  }
  const [mkDrag, setMkDrag] = useState(null) // {id, t}
  function markerDown(e, m) {
    if (e.button !== 0) return
    e.stopPropagation()
    if (!e.altKey) {
      seqPlayer.seek(m.t)
      return
    }
    e.preventDefault()
    const move = (ev) => setMkDrag({ id: m.id, t: snapT(Math.max(0, Math.min(total, xToT(localX(ev))))) })
    const up = (ev) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setMkDrag(null)
      const t = snapT(Math.max(0, Math.min(total, xToT(localX(ev)))))
      if (Math.abs(t - m.t) > 1e-3) useStore.getState().updateSeqMarker(m.id, { t })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  useEffect(() => {
    if (!mkMenu) return
    const close = (ev) => { if (!ev.target.closest('.et-mkmenu')) setMkMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [mkMenu])

  function scrubFrom(e) {
    const st = useStore.getState()
    st.setEditSel([])
    const at = (ev) => snapT(Math.max(0, Math.min(total, xToT(localX(ev)))))
    seqPlayer.pause()
    dragRef.current = { kind: 'scrub' }
    seqPlayer.scrubTo(at(e))
    const move = (ev) => seqPlayer.scrubTo(at(ev))
    const up = (ev) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragRef.current = null
      seqPlayer.scrubTo(at(ev))
      seqPlayer.scrubEnd()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Index to insert at for a pointer x (between clips, by their midpoints).
  function insertIndexAt(x, excludeIds = []) {
    const rest = items.filter((it) => !excludeIds.includes(it.id))
    let i = 0
    for (const it of rest) {
      if (xToT(x) > it.start + it.dur / 2) i++
    }
    return i
  }
  function insertX(idx, excludeIds = []) {
    const rest = items.filter((it) => !excludeIds.includes(it.id))
    // position in the CURRENT layout where the gap would open
    if (idx <= 0) return tToX(rest.length ? rest[0].start : 0)
    const prev = rest[idx - 1]
    return tToX(prev.start + prev.dur)
  }

  // Drag a clip's left / right edge to trim it (ripple — the rest of the
  // cut slides along). The preview shows the frame at the edge.
  function edgeDown(e, it, side) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const st = useStore.getState()
    const base = st.currentSection().clips
    const src = byKey.get(it.key)
    const maxOut = (src && src.probe && src.probe.duration) || Infinity
    const x0 = e.clientX
    const orig = side === 'in' ? it.in : it.out
    seqPlayer.pause()
    let next = null
    let edgeT = null
    const move = (ev) => {
      let v = orig + (ev.clientX - x0) / view.pps
      if (side === 'out') {
        // snap the right edge in timeline time (cuts / markers / playhead)
        const T = snapT(it.start + (v - it.in), { toPlayhead: true })
        v = it.in + (T - it.start)
      }
      next = EM.trimEdge(base, it.id, side, v, maxOut)
      if (!next) return
      setTrimLive(next)
      const c = next.find((x) => x.id === it.id)
      edgeT = side === 'in' ? it.start : it.start + (c.out - c.in)
      // show the frame at the edge (throttled; fast keyframe seeks)
      const now = performance.now()
      if (!edgeDown.last || now - edgeDown.last > 120) {
        edgeDown.last = now
        const shown = next
        const at = side === 'in' ? edgeT : Math.max(it.start, edgeT - 1 / 60)
        seqPlayer.setClips(shown).then(() => seqPlayer.seek(at, { fast: true }))
      }
      document.body.classList.add('resizing-ew')
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew')
      setTrimLive(null)
      if (next) st.applyEdit(next, { playhead: side === 'in' ? edgeT : Math.max(it.start, edgeT - 1 / 60) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function clipDown(e, it) {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useStore.getState()
    if (tool === 'razor') {
      const t = snapT(xToT(localX(e)), { toPlayhead: true })
      if (st.applyEdit(EM.split(clips, t))) bus.emit('osd', 'Cut')
      return
    }
    // select: click selects (Shift/Ctrl adds); drag moves.
    let ids = st.editSel
    if (e.shiftKey || e.ctrlKey) ids = ids.includes(it.id) ? ids.filter((x) => x !== it.id) : [...ids, it.id]
    else if (!ids.includes(it.id)) ids = [it.id]
    st.setEditSel(ids)
    const x0 = e.clientX
    let moving = false
    const move = (ev) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return
      moving = true
      dragRef.current = { kind: 'move' }
      const idx = insertIndexAt(localX(ev), ids)
      setDropAt(insertX(idx, ids))
      dragRef.current.idx = idx
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragRef.current
      dragRef.current = null
      setDropAt(null)
      if (moving && d) st.applyEdit(EM.move(clips, ids, d.idx))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function bodyMove(e) {
    if (tool !== 'razor' || !razorRef.current) return
    const t = snapT(xToT(localX(e)), { toPlayhead: true })
    razorRef.current.style.transform = `translateX(${Math.round(tToX(t))}px)`
    razorRef.current.style.display = 'block'
  }

  // Recordings dragged in from the bin.
  function onDragOver(e) {
    if (!e.dataTransfer.types.includes('text/x-bijou-clip')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropAt(insertX(insertIndexAt(localX(e))))
  }
  function onDrop(e) {
    const key = e.dataTransfer.getData('text/x-bijou-clip')
    setDropAt(null)
    if (!key) return
    e.preventDefault()
    const st = useStore.getState()
    const c = st.clips.find((x) => x.key === key)
    if (!c || !c.probe) return
    if (!st.currentSection()) st.createSection()
    const sec = st.currentSection()
    const idx = insertIndexAt(localX(e))
    bus.emit('editAdded')
    st.applyEdit(EM.add(sec.clips, key, 0, c.probe.duration, idx))
    st.showToast('Added ' + clipTitle(c) + ' to “' + sec.name + '”')
  }

  // ---- ruler ticks ----
  const ticks = useMemo(() => {
    const minPx = 90
    const step = STEPS.find((s) => s * view.pps >= minPx) || 7200
    const out = []
    const first = Math.floor(view.start / step) * step
    for (let t = first; t < view.start + width / view.pps && out.length < 400; t += step) out.push(t)
    return out
  }, [view, width])

  // The clip strip's anchor: moves in half-screen steps (see .et-vclips).
  const half = width / view.pps / 2 || 1
  const anchor = Math.floor(view.start / half) * half
  // The canvases work the same way: drawn from the anchor, 1.5 screens
  // wide, slid while panning — redrawn only when the anchor moves.
  const drawView = useMemo(() => ({ start: anchor, pps: view.pps }), [anchor, view.pps])
  const drawW = Math.ceil(width * 1.5) + 2
  const slide = (anchor - view.start) * view.pps
  const winT0 = anchor - 50 / view.pps
  const winT1 = anchor + 3 * half + 50 / view.pps
  // Stable per clip, so an unchanged clip doesn't re-render.
  const notesCache = useMemo(() => new Map(), [notesByKey, items])
  const notesFor = (it) => {
    let n = notesCache.get(it.id)
    if (!n) notesCache.set(it.id, (n = notesIn(it)))
    return n
  }
  // Handlers go through a ref so they don't count as a change either.
  const handlers = useRef(null)
  handlers.current = {
    clipDown,
    clipContext,
    edgeDown,
    matchFrame(e, it) {
      if (tool !== 'select') return
      // Match frame: this moment of the recording, in Review (notes, transcript…)
      const off = Math.max(0, Math.min(it.dur, xToT(localX(e)) - it.start))
      const st = useStore.getState()
      seqPlayer.pause()
      st.setWorkspace('review')
      st.openClip(it.key, it.in + off)
    },
  }

  return (
    <div className="et">
      <div className="et-heads">
        <div className="et-head-ruler" style={{ height: RULER_H }}>
          <ZoomBar get={zoomGet} set={zoomSet} onFit={fit} onStep={(dir) => bus.emit('editZoom', dir)} fitTitle="Fit the whole section (\)" />
        </div>
        <div className="et-head v" style={{ height: V_H }}>V1</div>
        {Array.from({ length: nTracks }, (_, i) => {
          const m = mixer[i] || { vol: 1, mute: false }
          // "empty" only if this track is silent in every recording in the cut
          const empty = items.length > 0 && items.every((it) => { const a = ((byKey.get(it.key) || {}).probe?.audio || [])[i]; return !a || a.likelySilent })
          return (
            <div key={i} className="et-head-wrap" style={{ height: laneH[i] || A_H }}>
              <TrackHead
                i={i}
                name={trackNames[i] || 'Track ' + (i + 1)}
                color={colors[i]}
                mixer={m}
                soloed={solo.includes(i)}
                anySolo={solo.length > 0}
                empty={empty}
                meterRef={(el) => (meterRefs.current[i] = el)}
                height={laneH[i] || A_H}
                speechOn={!!speechShow[i]}
                skipOn={!!speechSkip[i]}
                showReset={false}
                onResize={(h) => useStore.getState().setEditLaneHeight(i, h)}
                onResetHeight={() => useStore.getState().setEditLaneHeight(i, 44)}
                onRename={(name) => useStore.getState().renameTrack(i, name)}
              />
            </div>
          )
        })}
      </div>
      <div
        className={'et-body' + (tool === 'razor' ? ' razor' : '')}
        ref={bodyRef}
        onMouseMove={bodyMove}
        onMouseLeave={() => razorRef.current && (razorRef.current.style.display = 'none')}
        onDragOver={onDragOver}
        onDragLeave={() => setDropAt(null)}
        onDrop={onDrop}
      >
        <div className="et-ruler" style={{ height: RULER_H }} onMouseDown={(e) => e.button === 0 && scrubFrom(e)}>
          {ticks.map((t) => (
            <span key={t} className="et-tick" style={{ left: tToX(t) }}>{fmtTime(t)}</span>
          ))}
          {markers.map((m) => {
            const t = mkDrag && mkDrag.id === m.id ? mkDrag.t : m.t
            const c = (MARKER_COLORS[m.color] || MARKER_COLORS.yellow).hex
            return (
              <i
                key={m.id}
                className="et-seqmark"
                style={{ left: tToX(t), '--c': c }}
                title={(m.text || 'Marker') + ' · ' + fmtTime(m.t) + '\nClick: jump · Alt+drag: move · Right-click: colour / delete · Double-click: name it'}
                onMouseDown={(e) => markerDown(e, m)}
                onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().updateSettings({ editPanelTab: 'notes', editPanelHidden: false }) }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMkMenu({ id: m.id, x: e.clientX, y: e.clientY }) }}
              />
            )
          })}
        </div>
        <div className="et-rows" onMouseDown={rowsDown}>
          <div className="et-row v" style={{ height: V_H }} onMouseDown={(e) => rowDown(e, null)} onContextMenu={(e) => rowContext(e, null)}>
            <ThinClips items={items} view={drawView} width={drawW} shift={slide} height={V_H} selSet={selSet} byKey={byKey} />
            {/* Clips sit in a strip that slides as you pan: they're placed from
                an anchor that only moves every half screen, so panning moves
                one element instead of re-rendering every clip. */}
            <div className="et-vclips" style={{ transform: `translateX(${slide}px)` }}>
              {items.filter((it) => it.dur * view.pps >= DOM_MIN_PX && it.start + it.dur > winT0 && it.start < winT1).map((it) => (
                <VClip
                  key={it.id}
                  it={it}
                  x={(it.start - anchor) * view.pps}
                  pps={view.pps}
                  sel={selSet.has(it.id)}
                  c={byKey.get(it.key)}
                  notes={notesFor(it)}
                  tool={tool}
                  beatColors={beatColors}
                  h={handlers}
                />
              ))}
            </div>
          </div>
          {Array.from({ length: nTracks }, (_, i) => (
            <div key={i} className="et-row a" style={{ height: laneH[i] || A_H, '--c': colors[i] }} onMouseDown={(e) => rowDown(e, i)} onContextMenu={(e) => rowContext(e, i)}>
              <WaveRow track={i} items={items} view={drawView} width={drawW} shift={slide} height={laneH[i] || A_H} color={colors[i]} byKey={byKey} waveMap={waveMap} wavesVer={wavesVer} speech={!!speechShow[i]} sens={sens} selSet={selSet} />
            </div>
          ))}
          {!items.length && <div className="et-empty dim">Drop recordings here</div>}
        </div>
        {/* The empty space under the tracks: drag here for a selection box
            (the tracks themselves are usually covered by clips). */}
        <div className="et-fill" onMouseDown={rowsDown} title="Drag across to select clips" />
        {dropAt != null && <div className="et-drop" style={{ transform: `translateX(${Math.round(dropAt)}px)` }} />}
        {box && <div className="et-box" style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }} />}
        {markers.map((m) => (
          <i key={m.id} className="et-seqline" style={{ transform: `translateX(${Math.round(tToX(mkDrag && mkDrag.id === m.id ? mkDrag.t : m.t))}px)`, '--c': (MARKER_COLORS[m.color] || MARKER_COLORS.yellow).hex }} />
        ))}
        <div className="et-razor" ref={razorRef} />
        <div className="et-playhead" ref={headRef} />
      </div>
      {clipMenu && (
        <div className="et-clipmenu color-menu" style={{ left: Math.min(clipMenu.x, window.innerWidth - 200), top: Math.min(clipMenu.y, window.innerHeight - 170) }}>
          <div className="color-menu-title">{clipMenu.ids.length > 1 ? `Colour ${clipMenu.ids.length} clips` : 'Clip colour'} <span className="dim">· carries into Premiere</span></div>
          <div className="clip-label-grid">
            {EM.CLIP_LABELS.map(([name, hex]) => (
              <button key={name} className="mk-swatch" style={{ '--c': hex }} title={name} onClick={() => { const st = useStore.getState(); const sec = st.currentSection(); st.applyEdit(EM.colorClips(sec.clips, clipMenu.ids, name)); setClipMenu(null) }} />
            ))}
          </div>
          <button className="link-btn et-mk-del" onClick={() => { const st = useStore.getState(); const sec = st.currentSection(); st.applyEdit(EM.colorClips(sec.clips, clipMenu.ids, null)); setClipMenu(null) }}>No colour</button>
        </div>
      )}
      {mkMenu && (
        <div className="et-mkmenu color-menu" style={{ left: Math.min(mkMenu.x, window.innerWidth - 176), top: Math.min(mkMenu.y, window.innerHeight - 130) }}>
          <div className="color-menu-title">Marker</div>
          <div className="color-menu-grid">
            {Object.entries(MARKER_COLORS).map(([k, c]) => (
              <button key={k} className={'mk-swatch' + ((markers.find((m) => m.id === mkMenu.id) || {}).color === k ? ' on' : '')} style={{ '--c': c.hex }} title={c.label} onClick={() => { useStore.getState().updateSeqMarker(mkMenu.id, { color: k }); setMkMenu(null) }} />
            ))}
          </div>
          <button className="link-btn danger et-mk-del" onClick={() => { useStore.getState().deleteSeqMarker(mkMenu.id); setMkMenu(null) }}>Delete marker</button>
        </div>
      )}
    </div>
  )
}
