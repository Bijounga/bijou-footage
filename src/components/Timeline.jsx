import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { useStore, TRACK_COLORS, DEFAULT_LANE_H, useTrackColors, useTrackNames } from '../state/store.js'
import { player } from '../lib/player.js'
import { bus } from '../lib/hooks.js'
import { fmtTime } from '../lib/time.js'
import { LABEL, noteHex } from '../lib/beats.js'
import { setWave, speechSegments } from '../lib/speech.js'
import { peakBetween, speechRuns } from '../lib/wavePeaks.js'

const RULER_H = 40 // tall on purpose: the ruler is the main click-and-drag scrub area
const MARKER_BAND = 20 // top of the ruler where the note/marker shields sit (clicks there pick a note)
const MIN_SPAN = 4 // seconds visible at max zoom

export function parseWaveform(u8) {
  if (!u8 || u8.length < 16) return null
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const n = dv.getUint32(4, true)
  const pps = dv.getUint32(8, true)
  const len = dv.getUint32(12, true)
  const tracks = []
  for (let i = 0; i < n; i++) tracks.push(u8.subarray(16 + i * len, 16 + (i + 1) * len))
  return { n, pps, len, tracks }
}

// Picks a "nice" tick step so labels are ~90px apart at any zoom level.
function tickStep(spp) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
  const want = spp * 90
  return steps.find((s) => s >= want) || 7200
}

// Premiere-style marker: a small shield (square top, pointed bottom).
function drawShield(ctx, x, top, w, h, color, selected) {
  const l = x - w / 2
  ctx.beginPath()
  ctx.moveTo(l, top)
  ctx.lineTo(l + w, top)
  ctx.lineTo(l + w, top + h * 0.62)
  ctx.lineTo(x, top + h)
  ctx.lineTo(l, top + h * 0.62)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = selected ? 1.5 : 1
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.55)'
  ctx.stroke()
}

// Vertical volume fader, 0–200%. Drag, wheel (±5%), double-click = 100%.
function Fader({ value, onChange, height }) {
  const ref = useRef(null)
  const trackH = Math.max(20, height - 14)
  const pos = Math.max(0, Math.min(1, value / 2))
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onChange(Math.max(0, Math.min(2, Math.round((value + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [value, onChange])
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const r = ref.current.getBoundingClientRect()
    const set = (ev) => {
      const f = 1 - (ev.clientY - r.top - 5) / (r.height - 10)
      const v = Math.max(0, Math.min(2, f * 2))
      // gentle detent at 100%
      onChange(Math.abs(v - 1) < 0.04 ? 1 : Math.round(v * 100) / 100)
    }
    set(e)
    const up = () => {
      window.removeEventListener('mousemove', set)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', set)
    window.addEventListener('mouseup', up)
  }
  return (
    <div
      className="fader"
      ref={ref}
      style={{ height: trackH }}
      onMouseDown={down}
      onDoubleClick={() => onChange(1)}
      title={`Volume ${Math.round(value * 100)}% — drag or scroll, double-click for 100%`}
    >
      <div className="fader-track" />
      <div className="fader-unity" style={{ bottom: `calc(${50}% - 1px)` }} />
      <div className="fader-fill" style={{ height: pos * 100 + '%' }} />
      <div className="fader-knob" style={{ bottom: `calc(${pos * 100}% - 6px)` }} />
    </div>
  )
}

// The thumbnail + time shown while hovering the timeline. Its own component
// with its own state, so moving the mouse re-renders just this — not the
// whole timeline and every track header.
function HoverPreview({ subs, wrapRef, canvasRef }) {
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const fn = (hv) => setHover(hv)
    subs.current.add(fn)
    return () => subs.current.delete(fn)
  }, [subs])
  return (
    <div
      className="hover-preview"
      style={{
        display: hover ? 'block' : 'none',
        left: hover ? Math.max(4, Math.min((wrapRef.current ? wrapRef.current.clientWidth : 0) - 204, hover.left - 100)) : 0,
        top: hover ? hover.top - 128 : 0
      }}
    >
      <canvas ref={canvasRef} width="192" height="108" />
      <div className="hp-time">
        {hover ? fmtTime(hover.t) : ''}
        {hover && hover.note && <span className="hp-note"> · {hover.note.text || LABEL[hover.note.type]}</span>}
      </div>
    </div>
  )
}

// Also used by the Edit timeline (showReset=false; its own row heights via
// onResize/onResetHeight; renames there change the default name).
export function TrackHead({ i, name, color, mixer, soloed, anySolo, empty, meterRef, height, speechOn, skipOn, showReset = true, onResize, onResetHeight, onRename }) {
  const toggleSpeechShow = useStore((s) => s.toggleSpeechShow)
  const toggleSpeechSkip = useStore((s) => s.toggleSpeechSkip)
  const setTrackVol = useStore((s) => s.setTrackVol)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const renameTrackHere = useStore((s) => s.renameTrackHere)
  const currentKey = useStore((s) => s.currentKey)
  const defaultName = useStore((s) => s.settings.trackNames[i])
  const setLaneHeight = useStore((s) => s.setLaneHeight)
  const setTrackColor = useStore((s) => s.setTrackColor)
  const [editing, setEditing] = useState(false)
  const audible = anySolo ? soloed : !mixer.mute
  const onVol = useCallback((v) => setTrackVol(i, v), [i, setTrackVol])

  function resizeDown(e) {
    e.preventDefault()
    e.stopPropagation()
    const y0 = e.clientY
    const h0 = height
    const move = (ev) => (onResize ? onResize(h0 + ev.clientY - y0) : setLaneHeight(i, h0 + ev.clientY - y0))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className={'track-head' + (audible ? '' : ' silent')} style={{ height, '--c': color }}>
      <div className="th-main">
        <div className="th-top">
          <label className="th-color" title="Track color — click to change · right-click to reset" onContextMenu={(e) => { e.preventDefault(); setTrackColor(i, null) }}>
            <input type="color" value={color} onChange={(e) => setTrackColor(i, e.target.value)} />
          </label>
          {editing ? (
            <input
              className="th-name-input"
              autoFocus
              defaultValue={name}
              placeholder={defaultName}
              title="Name for this recording only · clear it to go back to the default"
              onBlur={(e) => { onRename ? onRename(e.target.value.trim()) : renameTrackHere(currentKey, i, e.target.value.trim()); setEditing(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
            />
          ) : (
            <span className="th-name" onDoubleClick={() => setEditing(true)} title={`Track ${i + 1} — double-click to rename it for this recording${name !== defaultName ? ` (default: ${defaultName})` : ''}`}>
              {name}
              <button className="th-rename" onClick={() => setEditing(true)} title="Rename for this recording">✎</button>
            </span>
          )}
          {empty && <span className="th-empty" title="This track looks silent in this recording (auto-muted). Click M to play it anyway.">empty</span>}
          <span className="th-volnum">{Math.round(mixer.vol * 100)}%</span>
        </div>
        <div className="th-buttons">
          <button className={'th-btn' + (mixer.mute ? ' on-m' : '')} onClick={() => toggleMute(i)} title={`Mute (${i + 1})`}>M</button>
          <button className={'th-btn' + (soloed ? ' on-s' : '')} onClick={(e) => toggleSolo(i, !e.ctrlKey)} title={`Solo (Shift+${i + 1}) · Ctrl+click to solo several`}>S</button>
          <button className={'th-btn' + (speechOn ? ' on-a' : '')} onClick={() => toggleSpeechShow(i)} title="A — show where someone's talking on this track">A</button>
          {showReset && <button className="th-btn" onClick={() => setTrackVol(i, 1)} title="Reset volume to 100%">⟳</button>}
          <button className={'th-btn' + (skipOn ? ' on-a' : '')} onClick={() => toggleSpeechSkip(i)} title="⇥ — include this track in Skip to next speech (Ctrl+→ / Ctrl+←)">⇥</button>
          <div className="th-meter"><div ref={meterRef} /></div>
        </div>
      </div>
      <Fader value={mixer.vol} onChange={onVol} height={height} />
      <div className="th-resize" onMouseDown={resizeDown} onDoubleClick={() => (onResetHeight ? onResetHeight() : setLaneHeight(i, DEFAULT_LANE_H))} title="Drag to resize this track · double-click to reset" />
    </div>
  )
}

export default function Timeline() {
  const clip = useStore((s) => s.clips.find((c) => c.key === s.currentKey) || null)
  const review = useStore((s) => (s.currentKey ? s.reviews[s.currentKey] : null))
  const wfState = useStore((s) => (s.currentKey ? s.waveforms[s.currentKey] : null))
  const trackNames = useTrackNames(useStore((s) => s.currentKey))
  const mixerSettings = useStore((s) => s.settings.mixer)
  const autoMuteEmpty = useStore((s) => s.settings.autoMuteEmpty)
  const laneHeightsSetting = useStore((s) => s.settings.laneHeights)
  const height = useStore((s) => s.settings.timelineHeight)
  const solo = useStore((s) => s.solo)
  const trackColors = useTrackColors()
  const beatColors = useStore((s) => s.beatColors)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const inPoint = useStore((s) => s.inPoint)
  const selectNote = useStore((s) => s.selectNote)
  const snapOn = useStore((s) => s.settings.snap !== false)
  const themeId = useStore((s) => s.settings.theme)
  const speechShow = useStore((s) => s.settings.speechShow) || []
  const speechSkip = useStore((s) => s.settings.speechSkip) || []
  const speechSens = useStore((s) => s.settings.speechSensitivity ?? 0.5)
  const searchHits = useStore((s) => s.searchHits)

  const effMixer = mixerSettings.map((m, i) => {
    const a = clip && clip.probe && clip.probe.audio[i]
    return { ...m, mute: m.mute || (autoMuteEmpty && a && a.likelySilent && !m.forceOn) }
  })

  const nTracks = clip && clip.probe ? Math.max(1, clip.probe.audio.length) : 0
  const duration = (clip && clip.probe && clip.probe.duration) || 0
  const laneH = Array.from({ length: nTracks }, (_, i) => laneHeightsSetting[i] || DEFAULT_LANE_H)
  const lanesTotal = laneH.reduce((a, b) => a + b, 0)

  const wrapRef = useRef(null)
  const bodyRef = useRef(null)
  const mainRef = useRef(null)
  const overlayRef = useRef(null)
  const meterRefs = useRef([])
  const hoverRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const hoverSubs = useRef(new Set()) // HoverPreview listens here (see below)
  const setHover = (hv) => hoverSubs.current.forEach((fn) => fn(hv))
  const [scrollY, setScrollYState] = useState(0)

  const view = useRef({ start: 0, end: 1 })
  const scrollRef = useRef(0)
  const waveRef = useRef(null)
  const dirty = useRef(true)
  const frameNow = useRef(null) // draws one frame immediately (see the rAF loop)
  const follow = useRef(true)
  const drag = useRef(null)
  const size = useRef({ w: 0, h: 0 })
  const latest = useRef({})
  latest.current = { clip, review, effMixer, solo, beatColors, selectedNoteId, inPoint, nTracks, duration, wfState, laneH, lanesTotal, trackColors, snapOn, speechShow, speechSens, searchHits }
  if (import.meta.env.DEV) window.__tl = { view, scrollRef } // for scripts/cdp.mjs checks

  // Reset the view whenever a different clip opens.
  useEffect(() => {
    view.current = { start: 0, end: Math.max(1, duration) }
    follow.current = true
    dirty.current = true
  }, [clip && clip.key, duration])

  // Load waveform peaks when they're ready.
  useEffect(() => {
    waveRef.current = null
    dirty.current = true
    if (!clip) return
    let cancelled = false
    window.footage.getWaveform(clip).then((u8) => {
      if (cancelled) return
      waveRef.current = parseWaveform(u8)
      setWave(clip.key, waveRef.current) // speech detection works off the same peaks
      dirty.current = true
    })
    return () => { cancelled = true }
  }, [clip && clip.key, wfState && wfState.version, wfState && wfState.status])

  // Lane sizes: redraw in the same frame the track headers move, so the
  // waveforms never lag a frame behind them while you drag.
  useLayoutEffect(() => {
    dirty.current = true
    if (frameNow.current) frameNow.current()
  }, [laneH.join()])

  useEffect(() => {
    dirty.current = true
  }, [review, effMixer.map((m) => m.mute + ':' + m.vol).join(), solo.join(), beatColors, selectedNoteId, inPoint, nTracks, laneH.join(), trackColors.join(), themeId, speechShow.join(), speechSens, searchHits, wfState && wfState.status, wfState && Math.round((wfState.progress || 0) * 100)])

  // ---- geometry ----
  const xToT = (x) => {
    const v = view.current
    return v.start + (x / Math.max(1, size.current.w)) * (v.end - v.start)
  }
  const tToX = (t) => {
    const v = view.current
    return ((t - v.start) / (v.end - v.start)) * size.current.w
  }
  const clampView = (start, end) => {
    const d = latest.current.duration || 1
    const span = Math.max(Math.min(MIN_SPAN, d), Math.min(d, end - start))
    start = Math.max(0, Math.min(d - span, start))
    view.current = { start, end: start + span }
    dirty.current = true
  }
  const zoomAt = (factor, anchorT) => {
    const v = view.current
    const a = anchorT != null ? anchorT : player.getTime()
    const span = (v.end - v.start) * factor
    const rel = (a - v.start) / (v.end - v.start)
    clampView(a - rel * span, a - rel * span + span)
  }
  // Snapping (the magnet next to the speed): a time within SNAP_PX on screen
  // of a note/marker (or the playhead, when moving a note) lands exactly on
  // it. `pxPerSec` is the timeline's zoom, so the 8px feel holds at any zoom level.
  const SNAP_PX = 8
  const snapT = (t, pxPerSec, { excludeId, toPlayhead } = {}) => {
    const { review, snapOn } = latest.current
    if (!snapOn || !review) return t
    let best = t
    let bestD = SNAP_PX / pxPerSec
    const consider = (ct) => {
      const d = Math.abs(ct - t)
      if (d < bestD) { bestD = d; best = ct }
    }
    for (const n of review.notes) {
      if (n.id === excludeId) continue
      consider(n.t)
      if (n.end != null) consider(n.end)
    }
    if (toPlayhead) consider(player.getTime())
    return best
  }
  const mainPps = () => size.current.w / (view.current.end - view.current.start)
  const maxScroll = () => Math.max(0, latest.current.lanesTotal - (size.current.h - RULER_H))
  const setScroll = (y) => {
    const v = Math.max(0, Math.min(maxScroll(), y))
    if (v === scrollRef.current) return
    scrollRef.current = v
    setScrollYState(v)
    dirty.current = true
  }
  // Keep scroll valid when lanes shrink or the timeline grows.
  useEffect(() => { setScroll(scrollRef.current) }, [lanesTotal, height])

  useEffect(() => {
    const offs = [
      bus.on('zoom', (f) => { zoomAt(f); follow.current = true }),
      bus.on('fit', () => { clampView(0, latest.current.duration); follow.current = true })
    ]
    return () => offs.forEach((o) => o())
  }, [])

  // ---- sizing: canvases fill the body; lanes scroll inside it ----
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const ro = new ResizeObserver(() => {
      const w = body.clientWidth
      const h = body.clientHeight
      const dpr = window.devicePixelRatio || 1
      size.current = { w, h }
      for (const [c, ch] of [[mainRef.current, h], [overlayRef.current, h]]) {
        if (!c) continue
        const cw = Math.round(w * dpr)
        const chh = Math.round(ch * dpr)
        if (c.width === cw && c.height === chh) continue
        c.width = cw // (clears the canvas)
        c.height = chh
        c.style.width = w + 'px'
        c.style.height = ch + 'px'
      }
      setScroll(scrollRef.current)
      dirty.current = true
      // Redraw right now, before this frame is painted: resizing a canvas
      // clears it, and waiting for the next animation frame showed a blank
      // (flickering) timeline while dragging its size.
      if (frameNow.current) frameNow.current()
    })
    ro.observe(body)
    return () => ro.disconnect()
  }, [!!clip])

  // ---- drawing ----
  const drawMain = useCallback(() => {
    const c = mainRef.current
    if (!c) return
    const { review, effMixer, solo, beatColors, selectedNoteId, inPoint, nTracks, duration, clip, wfState, laneH, trackColors, speechShow, speechSens, searchHits } = latest.current
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!clip || !duration) return
    const v = view.current
    const spp = (v.end - v.start) / w
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink-dim').trim() || '#999'
    const line = css.getPropertyValue('--line').trim() || '#333'
    const sy = scrollRef.current

    // lanes (scrolling), clipped below the ruler
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, RULER_H, w, h - RULER_H)
    ctx.clip()
    const wave = waveRef.current
    const soloSet = new Set(solo)
    let y0 = RULER_H - sy
    for (let i = 0; i < nTracks; i++) {
      const lh = laneH[i]
      if (y0 > h) break
      if (y0 + lh >= RULER_H) {
        const mid = y0 + lh / 2
        const audible = soloSet.size ? soloSet.has(i) : !effMixer[i].mute
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.03)'
        ctx.fillRect(0, y0, w, lh)
        ctx.fillStyle = line
        ctx.fillRect(0, y0 + lh - 1, w, 1)
        const data = wave && wave.tracks[i]
        if (!data) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(0, mid, w, 1)
          if (i === 0) {
            ctx.fillStyle = ink
            ctx.font = '11px Inter, sans-serif'
            ctx.textBaseline = 'middle'
            const st = wfState && wfState.status
            const msg = st === 'error' ? 'Waveform failed: ' + (wfState.error || '') : st === 'running' ? `Building waveforms… ${Math.round((wfState.progress || 0) * 100)}%` : st === 'queued' ? 'Waveforms queued…' : 'Preparing waveforms…'
            ctx.fillText(msg, 10, mid)
            ctx.textBaseline = 'top'
          }
        } else {
          ctx.fillStyle = audible ? trackColors[i] || TRACK_COLORS[i] : 'rgba(150,150,160,0.35)'
          ctx.globalAlpha = audible ? 0.9 : 1
          const half = lh / 2 - 4
          const pps = wave.pps
          // Pyramid lookups (lib/wavePeaks.js) + one path, one fill.
          ctx.beginPath()
          for (let x = 0; x < w; x++) {
            const t0 = v.start + x * spp
            const i0 = Math.floor(t0 * pps)
            let i1 = Math.floor((t0 + spp) * pps)
            if (i1 <= i0) i1 = i0 + 1
            if (i0 >= wave.len) break
            if (i1 <= 0) continue
            const peak = peakBetween(data, i0, Math.min(i1, wave.len))
            if (peak < 3) continue
            const bh = Math.max(1, (peak / 255) * half)
            ctx.rect(x, mid - bh, 1, bh * 2)
          }
          ctx.fill()
          ctx.globalAlpha = 1
          // Speech markers (A): where someone's talking on this track.
          if (speechShow[i]) {
            const col = trackColors[i] || TRACK_COLORS[i]
            // only what's on screen; spans that touch at this zoom merged
            const runs = speechRuns(speechSegments(clip.key, i, speechSens), v.start, v.end, tToX)
            ctx.fillStyle = col
            ctx.globalAlpha = 0.1
            ctx.beginPath()
            for (const [a, b] of runs) ctx.rect(Math.max(0, a), y0, Math.max(2, b - Math.max(0, a)), lh - 1)
            ctx.fill()
            ctx.globalAlpha = 0.9
            ctx.beginPath()
            for (const [a, b] of runs) {
              ctx.rect(Math.max(0, a), y0 + lh - 4, Math.max(2, b - Math.max(0, a)), 3)
              ctx.rect(Math.max(0, a), y0 + 1, 2, 6) // start tick
            }
            ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }
      // Transcript search hits on this track.
      if (searchHits.length && y0 + lh >= RULER_H) {
        ctx.fillStyle = '#ffd84a'
        for (const hit of searchHits) {
          if (hit.track !== i || hit.t < v.start || hit.t > v.end) continue
          const x = Math.round(tToX(hit.t))
          ctx.fillRect(x - 1, y0 + 1, 2, lh - 3)
          ctx.beginPath()
          ctx.moveTo(x - 5, y0 + 1)
          ctx.lineTo(x + 5, y0 + 1)
          ctx.lineTo(x, y0 + 7)
          ctx.fill()
        }
      }
      y0 += lh
    }
    const lanesBottom = Math.min(h, y0)

    // note lines / range shading through the lanes
    if (review) {
      for (const n of review.notes) {
        const end = n.end != null ? n.end : n.t
        if (end < v.start || n.t > v.end) continue
        const x = Math.round(tToX(n.t)) + 0.5
        const col = noteHex(n, beatColors)
        const sel = n.id === selectedNoteId
        const isMarker = n.type === 'MARKER'
        if (n.end != null) {
          ctx.fillStyle = col
          ctx.globalAlpha = sel ? 0.22 : 0.12
          ctx.fillRect(x, RULER_H, Math.max(2, tToX(n.end) - x), lanesBottom - RULER_H)
          ctx.globalAlpha = 1
        }
        ctx.strokeStyle = col
        ctx.globalAlpha = sel ? 1 : isMarker ? 0.85 : 0.4
        ctx.lineWidth = sel ? 2 : isMarker ? 1.5 : 1
        if (n.type === 'BREAK') ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(x, RULER_H)
        ctx.lineTo(x, lanesBottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
    }
    if (inPoint && inPoint.key === clip.key) {
      const x = Math.round(tToX(inPoint.t)) + 0.5
      ctx.strokeStyle = '#ffffff'
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(x, RULER_H)
      ctx.lineTo(x, lanesBottom)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#fff'
      ctx.font = '600 10px Inter'
      ctx.fillText('IN', x + 3, RULER_H + 3)
    }
    ctx.restore()

    // ruler (fixed on top)
    ctx.fillStyle = css.getPropertyValue('--panel-2').trim()
    ctx.fillRect(0, 0, w, RULER_H)
    ctx.fillStyle = line
    ctx.fillRect(0, RULER_H - 1, w, 1)
    const step = tickStep(spp)
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    const first = Math.floor(v.start / step) * step
    for (let t = first; t <= v.end; t += step) {
      const x = Math.round(tToX(t)) + 0.5
      ctx.fillStyle = line
      ctx.fillRect(x, RULER_H - 12, 1, 12)
      ctx.fillStyle = ink
      ctx.fillText(fmtTime(t), x + 3, RULER_H - 12)
      const minor = step / 5
      for (let k = 1; k < 5; k++) {
        ctx.fillStyle = line
        ctx.fillRect(Math.round(tToX(t + k * minor)) + 0.5, RULER_H - 4, 1, 4)
      }
    }
    // Notes on the ruler: small shields in the beat's color; your markers
    // bigger, in their own color. No text (hover one to read it) — so they
    // can't be grabbed by accident while scrubbing.
    if (review) {
      const draw = (n) => {
        const end = n.end != null ? n.end : n.t
        if (end < v.start - 1 || n.t > v.end + 1) return
        const x = Math.round(tToX(n.t)) + 0.5
        const col = noteHex(n, beatColors)
        const sel = n.id === selectedNoteId
        if (n.end != null) {
          ctx.fillStyle = col
          ctx.globalAlpha = 0.5
          ctx.fillRect(x, 2, Math.max(2, tToX(n.end) - x), 3)
          ctx.globalAlpha = 1
        }
        if (n.type === 'MARKER') {
          ctx.fillStyle = col
          ctx.fillRect(x - 0.75, 14, 1.5, RULER_H - 14)
          drawShield(ctx, x, 1, 12, 15, col, sel)
        } else if (n.type === 'BREAK') {
          ctx.fillStyle = col
          ctx.fillRect(x - 0.5, 3, 1, RULER_H - 6)
        } else {
          drawShield(ctx, x, 3, 8, 11, col, sel)
          if (n.star) {
            ctx.fillStyle = '#f5c542'
            ctx.fillRect(x - 1.5, 15, 3, 3)
          }
        }
      }
      // beats first, markers on top, the selected one last
      review.notes.filter((n) => n.type !== 'MARKER' && n.id !== selectedNoteId).forEach(draw)
      review.notes.filter((n) => n.type === 'MARKER' && n.id !== selectedNoteId).forEach(draw)
      const selN = review.notes.find((n) => n.id === selectedNoteId)
      if (selN) draw(selN)
    }
  }, [])

  // rAF loop. Each frame does only what changed: the waveform canvas when
  // dirty, the playhead overlay when the playhead / hover / view / size
  // moved by at least half a pixel, and the level meters while audio plays.
  // Paused and untouched, a frame costs almost nothing.
  useEffect(() => {
    let raf = 0
    let lastOverlay = ''
    let metersZero = false
    const meterVals = []
    const frame = (force) => {
      const { duration, nTracks } = latest.current
      const t = player.getTime()
      if (follow.current && player.playing && !drag.current && duration) {
        const v = view.current
        const span = v.end - v.start
        if (span < duration - 0.5 && (t > v.end - span * 0.02 || t < v.start)) clampView(t - span * 0.1, t + span * 0.9)
      }
      if (dirty.current) {
        dirty.current = false
        drawMain()
      }
      const oc = overlayRef.current
      const hv0 = hoverRef.current
      const v0 = view.current
      const overlayKey = duration
        ? Math.round(tToX(t) * 2) + '|' + (hv0 && hv0.area === 'main' ? Math.round(hv0.x) : '') + '|' + v0.start + '|' + v0.end + '|' + size.current.w + 'x' + size.current.h
        : 'none'
      if (oc && (force === true || overlayKey !== lastOverlay)) {
        lastOverlay = overlayKey
        const ctx = oc.getContext('2d')
        const dpr = window.devicePixelRatio || 1
        const { w, h } = size.current
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        if (duration) {
          const x = tToX(t)
          if (x >= -1 && x <= w + 1) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(Math.round(x) - 0.5, 0, 1.5, h)
            ctx.beginPath()
            ctx.moveTo(x - 5, 0)
            ctx.lineTo(x + 5, 0)
            ctx.lineTo(x, 7)
            ctx.fill()
          }
          const hv = hoverRef.current
          if (hv && hv.area === 'main') {
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            ctx.fillRect(Math.round(hv.x), 0, 1, h)
          }
        }
      }
      // Meters: read the analysers only while playing; write only changes.
      const playing = player.playing && !player.skim
      if (playing || !metersZero) {
        const lv = playing ? player.levels() : null
        for (let i = 0; i < nTracks; i++) {
          const el = meterRefs.current[i]
          if (!el) continue
          const peak = lv ? lv[i] : 0
          const db = peak > 0 ? 20 * Math.log10(peak) : -60
          const scale = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 100) / 100
          if (meterVals[i] !== scale) {
            meterVals[i] = scale
            el.style.transform = `scaleX(${scale})`
            el.classList.toggle('hot', peak > 0.97)
          }
        }
        metersZero = !playing
      }
    }
    frameNow.current = () => frame(true)
    const loop = () => {
      frame()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      frameNow.current = null
    }
  }, [drawMain])

  // ---- hover thumbnail from the player's ghost decoder ----
  useEffect(
    () =>
      player.on('ghostFrame', () => {
        const cv = previewCanvasRef.current
        const g = player.ghost
        if (hoverRef.current && cv && g && g.videoWidth) cv.getContext('2d').drawImage(g, 0, 0, cv.width, cv.height)
      }),
    []
  )

  // ---- wheel, Premiere-style. Native listener: React's onWheel is passive
  // and can't stop Ctrl+wheel page zoom.
  //   wheel         → pan left/right
  //   Alt + wheel   → zoom at the cursor
  //   Ctrl + wheel  → scroll the tracks up/down
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!latest.current.duration) return
      e.preventDefault()
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (e.ctrlKey) {
        setScroll(scrollRef.current + d)
        return
      }
      const body = bodyRef.current.getBoundingClientRect()
      const x = e.clientX - body.left
      if (e.altKey) {
        const inBody = x >= 0 && x <= body.width
        const anchor = inBody ? xToT(x) : null
        zoomAt(Math.exp(d * 0.0018), anchor)
        return
      }
      const v = view.current
      const dt = (d / size.current.w) * (v.end - v.start)
      clampView(v.start + dt, v.end + dt)
      follow.current = false
      clearTimeout(el._followTimer)
      el._followTimer = setTimeout(() => { follow.current = true }, 2500)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [!!clip])

  // ---- pointer interactions ----
  function localXY(e, el) {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function noteAt(x, y) {
    const { review } = latest.current
    if (!review || y > MARKER_BAND) return null
    let best = null
    let bestD = Infinity
    for (const n of review.notes) {
      const d = Math.abs(tToX(n.t) - x)
      const reach = n.type === 'MARKER' ? 8 : 6
      if (d <= reach && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  function onMainDown(e) {
    if (!latest.current.duration || e.button !== 0) return
    const { x, y } = localXY(e, mainRef.current)
    const n = noteAt(x, y)
    follow.current = false
    if (n && e.altKey) {
      selectNote(n.id)
      player.seek(n.t)
      drag.current = { kind: 'note', id: n.id, startX: x, orig: n.t, origEnd: n.end, moved: false }
    } else if (n) {
      // Clicking a marker lands exactly on it; dragging from there scrubs —
      // it never moves the marker (that's Alt+drag).
      selectNote(n.id)
      drag.current = { kind: 'scrub' }
      player.scrubStart(n.t)
    } else {
      drag.current = { kind: 'scrub' }
      player.scrubStart(snapT(xToT(x), mainPps()))
    }
    const move = (ev) => {
      const p = localXY(ev, mainRef.current)
      const d = drag.current
      if (!d) return
      if (d.kind === 'scrub') player.scrubTo(snapT(xToT(p.x), mainPps()))
      else if (d.kind === 'note' && (d.moved || Math.abs(p.x - d.startX) > 4)) {
        if (!d.moved) useStore.getState().snapshot(useStore.getState().currentKey)
        d.moved = true
        const dt = xToT(p.x) - xToT(d.startX)
        const nt = snapT(Math.max(0, Math.min(latest.current.duration, d.orig + dt)), mainPps(), { excludeId: d.id, toPlayhead: true })
        useStore.getState().updateNote(d.id, { t: Math.round(nt * 100) / 100, ...(d.origEnd != null ? { end: Math.round((d.origEnd + (nt - d.orig)) * 100) / 100 } : {}) })
        player.seek(nt)
      }
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (drag.current && drag.current.kind === 'scrub') player.scrubEnd()
      drag.current = null
      setTimeout(() => { follow.current = true }, 1500)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function onMainDouble(e) {
    const { x, y } = localXY(e, mainRef.current)
    const n = noteAt(x, y)
    if (n && n.type !== 'BREAK') useStore.getState().editNoteFromTimeline(n.id)
  }

  function onHover(e, area) {
    if (!latest.current.duration) return
    const el = mainRef.current
    const { x, y } = localXY(e, el)
    const t = xToT(x)
    const r = el.getBoundingClientRect()
    const wrapR = wrapRef.current.getBoundingClientRect()
    const note = area === 'main' ? noteAt(x, y) : null
    if (area === 'main' && overlayRef.current) overlayRef.current.style.cursor = note ? (e.altKey ? 'ew-resize' : 'pointer') : y <= RULER_H ? 'col-resize' : 'text'
    const hv = { x, t, area, left: r.left - wrapR.left + x, top: r.top - wrapR.top, note }
    hoverRef.current = hv
    setHover(hv)
    if (!drag.current) player.hoverPreview(Math.max(0, Math.min(latest.current.duration - 0.1, t)))
  }
  function onLeave() {
    hoverRef.current = null
    setHover(null)
  }

  if (!clip) return <div className="timeline empty" />

  const soloSet = new Set(solo)
  return (
    <div className="timeline" ref={wrapRef} style={{ height }}>
      <div className="tl-row tl-main-row">
        <div className="tl-heads">
          <div className="tl-head tl-ruler-head" style={{ height: RULER_H }}>
            <button className="mini-btn" onClick={() => bus.emit('fit')} title="Fit whole recording">Fit</button>
            <button className="mini-btn" onClick={() => bus.emit('zoom', 1.6)} title="Zoom out · Alt+wheel">−</button>
            <button className="mini-btn" onClick={() => bus.emit('zoom', 1 / 1.6)} title="Zoom in · Alt+wheel">+</button>
            <span className="dim small tl-hint" title="Wheel: pan · Alt+wheel: zoom · Ctrl+wheel: scroll tracks">⇆ ⌥ ⌃</span>
          </div>
          <div className="tl-heads-scroll">
            <div style={{ transform: `translateY(${-scrollY}px)` }}>
              {Array.from({ length: nTracks }, (_, i) => (
                <TrackHead
                  key={i}
                  i={i}
                  name={trackNames[i]}
                  color={trackColors[i] || TRACK_COLORS[i]}
                  mixer={effMixer[i]}
                  soloed={soloSet.has(i)}
                  anySolo={soloSet.size > 0}
                  empty={!!(clip.probe && clip.probe.audio[i] && clip.probe.audio[i].likelySilent)}
                  meterRef={(el) => (meterRefs.current[i] = el)}
                  height={laneH[i]}
                  speechOn={!!speechShow[i]}
                  skipOn={!!speechSkip[i]}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="tl-body tl-main-body" ref={bodyRef}>
          <canvas ref={mainRef} className="tl-main" />
          <canvas
            ref={overlayRef}
            className="tl-overlay"
            onMouseDown={onMainDown}
            onDoubleClick={onMainDouble}
            onContextMenu={(e) => {
              const { x, y } = localXY(e, mainRef.current)
              const n = noteAt(x, y)
              if (!n || n.type !== 'MARKER') return
              e.preventDefault()
              selectNote(n.id)
              useStore.getState().openColorMenu({ x: e.clientX, y: e.clientY, noteId: n.id, clipKey: latest.current.clip.key })
            }}
            onMouseMove={(e) => onHover(e, 'main')}
            onMouseLeave={onLeave}
          />
        </div>
      </div>
      <HoverPreview subs={hoverSubs} wrapRef={wrapRef} canvasRef={previewCanvasRef} />
    </div>
  )
}
