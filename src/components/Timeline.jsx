import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { useStore, TRACK_COLORS, DEFAULT_LANE_H, useTrackColors, useTrackNames } from '../state/store.js'
import { player } from '../lib/player.js'
import { bus, onTick, usePlayerTime } from '../lib/hooks.js'
import { fmtTime } from '../lib/time.js'
import { offsetAt, coverage, gapAt } from '../lib/povSync.js'
import { pushAlign, undoAlign, redoAlign, splitAt, mergeAt, cutAt, stretchAt, setStretchOffset, onAlignHistory, alignHistoryInfo } from '../lib/povAlign.js'
import { LABEL, noteHex } from '../lib/beats.js'
import { setWave, speechSegments } from '../lib/speech.js'
import { peakBetween, speechRuns } from '../lib/wavePeaks.js'
import { makeWheelAxis, onFrame, isPinch } from '../lib/wheel.js'
import { playheadColor, clipBlocks, blockFill, blockMuted, blockEmpty, BLOCK_WAVE } from '../lib/themes.js'
import ZoomBar from './ZoomBar.jsx'

// the bars showing where each POV has footage (and its dot in the POV menu)
export const POV_COLORS = ['#4fd1c5', '#f5c542', '#a78bfa', '#fb923c', '#60a5fa', '#f472b6']
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
export function Fader({ value, onChange, height }) {
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
// Their track names live with the POV (e.g. "Alex mic").
function renamePovTrack(pov, i, name) {
  const st = useStore.getState()
  const p = ((st.reviews[st.currentKey] && st.reviews[st.currentKey].povs) || []).find((x) => x.key === pov)
  if (!p) return
  const names = (p.trackNames || []).slice()
  names[i] = name || undefined
  st.updatePov(pov, { trackNames: names })
}

// pov: the key of someone's POV whose tracks these are (Review, with their
// view big) — the buttons and fader mix theirs; no speech / rename buttons.
export function TrackHead({ i, name, color, mixer, soloed, anySolo, empty, meterRef, height, speechOn, skipOn, showReset = true, onResize, onResetHeight, onRename, pov = null }) {
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
  const onVol = useCallback((v) => (pov ? useStore.getState().setPovTrack(pov, i, { vol: v }) : setTrackVol(i, v)), [i, setTrackVol, pov])

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
              onBlur={(e) => { onRename ? onRename(e.target.value.trim()) : pov ? renamePovTrack(pov, i, e.target.value.trim()) : renameTrackHere(currentKey, i, e.target.value.trim()); setEditing(false) }}
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
          <button className={'th-btn' + (mixer.mute ? ' on-m' : '')} onClick={() => (pov ? useStore.getState().setPovTrack(pov, i, { mute: !mixer.mute }) : toggleMute(i))} title={pov ? 'Mute this track of theirs' : `Mute (${i + 1})`}>M</button>
          <button className={'th-btn' + (soloed ? ' on-s' : '')} onClick={(e) => (pov ? useStore.getState().togglePovSolo(i, !e.ctrlKey) : toggleSolo(i, !e.ctrlKey))} title={`Solo (Shift+${i + 1}) · Ctrl+click to solo several`}>S</button>
          {!pov && <button className={'th-btn' + (speechOn ? ' on-a' : '')} onClick={() => toggleSpeechShow(i)} title="Show talking (A): tint the stretches where someone's talking on this track">A</button>}
          {showReset && <button className="th-btn" onClick={() => onVol(1)} title="Reset volume to 100%">⟳</button>}
          {!pov && <button className={'th-btn' + (skipOn ? ' on-a' : '')} onClick={() => toggleSpeechSkip(i)} title="Follow this track's talking (⇥): Ctrl+→ / Ctrl+← jump to where someone on it starts talking, and Skip silence keeps the bits where they talk">⇥</button>}
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
  // With someone's POV big, the lanes are THEIR tracks (in your time — shifted
  // by their offset), and the track heads mix them; notes / markers stay yours.
  const povEntry = useStore((s) => (s.povFocus && s.currentKey && s.reviews[s.currentKey] ? (s.reviews[s.currentKey].povs || []).find((p) => p.key === s.povFocus) || null : null))
  const povClip = useStore((s) => (povEntry ? s.clips.find((c) => c.key === povEntry.key) || null : null))
  const povSolo = useStore((s) => s.povSolo)
  const wclip = povClip || clip
  const shift = povClip ? povEntry.off || 0 : 0
  const povAlign = povClip && ((povEntry.pts && povEntry.pts.length) || povEntry.gap) ? povEntry : null // an alignment that changes along the way, or footage cut out (povSync.js)
  const wfState = useStore((s) => (wclip ? s.waveforms[wclip.key] : null))
  const ownNames = useTrackNames(useStore((s) => s.currentKey))
  const trackNames = povClip ? ((povClip.probe && povClip.probe.audio) || []).map((a, i) => ((povEntry.trackNames || [])[i] || (a && a.title) || 'Track ' + (i + 1))) : ownNames
  const mixerSettings = useStore((s) => s.settings.mixer)
  const autoMuteEmpty = useStore((s) => s.settings.autoMuteEmpty)
  const laneHeightsSetting = useStore((s) => s.settings.laneHeights)
  const height = useStore((s) => s.settings.timelineHeight)
  const ownSolo = useStore((s) => s.solo)
  const solo = povClip ? povSolo : ownSolo
  const ownColors = useTrackColors()
  // their lanes in that POV's colour (the same as its bar on the ruler)
  const povIndex = povClip && review ? (review.povs || []).findIndex((p) => p.key === povEntry.key) : -1
  const trackColors = povClip ? Array.from({ length: Math.max(1, ((povClip.probe && povClip.probe.audio) || []).length) }, () => povEntry.color || POV_COLORS[Math.max(0, povIndex) % POV_COLORS.length]) : ownColors
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

  const effMixer = povClip
    ? ((povClip.probe && povClip.probe.audio) || []).map((a, i) => ({ vol: 1, mute: !!(a && a.likelySilent), ...((povEntry.mix || [])[i] || {}) }))
    : mixerSettings.map((m, i) => {
        const a = clip && clip.probe && clip.probe.audio[i]
        return { ...m, mute: m.mute || (autoMuteEmpty && a && a.likelySilent && !m.forceOn) }
      })

  const nTracks = wclip && wclip.probe ? Math.max(1, wclip.probe.audio.length) : 0
  const duration = (clip && clip.probe && clip.probe.duration) || 0
  // With a POV big, the timeline reaches over THEIR whole recording (not just the part that is yours):
  // in your time that runs from −offset to (their length − offset). Your own recording sits inside it.
  let dMin = 0
  let dMax = duration
  if (povEntry && povClip && povClip.probe && povClip.probe.duration) {
    for (const o of [povEntry.off || 0, ...(povEntry.pts || []).map((p) => p.off)]) {
      dMin = Math.min(dMin, -o)
      dMax = Math.max(dMax, povClip.probe.duration - o)
    }
  }
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
  // for the POV bar's buttons, which depend on which stretch the playhead is in: re-render as it moves
  usePlayerTime(250)
  const [, bumpSeek] = useState(0)
  useEffect(() => { const offs = [player.on('seek', () => bumpSeek((n) => n + 1)), player.on('seeked', () => bumpSeek((n) => n + 1))]; return () => offs.forEach((o) => o && o()) }, [])
  const playhead = player.getTime()
  // re-render when the alignment history changes (for the Undo / Redo buttons)
  const [aligned, setAligned] = useState(alignHistoryInfo())
  useEffect(() => onAlignHistory(() => setAligned(alignHistoryInfo())), [])
  const frameNow = useRef(null) // draws one frame immediately (see the rAF loop)
  const follow = useRef(true)
  const drag = useRef(null)
  const size = useRef({ w: 0, h: 0 })
  const latest = useRef({})
  latest.current = { clip, review, effMixer, solo, beatColors, selectedNoteId, inPoint, nTracks, duration, wfState, laneH, lanesTotal, trackColors, snapOn, speechShow: povClip ? [] : speechShow, speechSens, searchHits: povClip ? [] : searchHits, shift, povAlign, povEntry, wclip, dMin, dMax }
  if (import.meta.env.DEV) window.__tl = { view, scrollRef } // for scripts/cdp.mjs checks

  // Reset the view whenever a different clip opens.
  useEffect(() => {
    view.current = { start: 0, end: Math.max(1, duration) }
    follow.current = true
    dirty.current = true
  }, [clip && clip.key, duration])

  // A POV going big (or coming back): keep the zoom you are at — the view just may reach further (or
  // less far) now. "Fit" shows all of their recording, with where yours begins and ends.
  useEffect(() => {
    const v = view.current
    clampView(v.start, v.end)
    follow.current = true
    dirty.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [povEntry && povEntry.key])

  // Load waveform peaks when they're ready.
  useEffect(() => {
    waveRef.current = null
    dirty.current = true
    if (!wclip) return
    let cancelled = false
    window.footage.getWaveform(wclip).then((u8) => {
      if (cancelled) return
      waveRef.current = parseWaveform(u8)
      if (wclip === clip) setWave(clip.key, waveRef.current) // speech detection works off the same peaks
      else if (!u8) window.footage.requestWaveform(wclip, true)
      dirty.current = true
    })
    return () => { cancelled = true }
  }, [wclip && wclip.key, wfState && wfState.version, wfState && wfState.status])

  // Lane sizes: redraw in the same frame the track headers move, so the
  // waveforms never lag a frame behind them while you drag.
  useLayoutEffect(() => {
    dirty.current = true
    if (frameNow.current) frameNow.current()
  }, [laneH.join()])

  useEffect(() => {
    dirty.current = true
  }, [review, shift, povAlign, povEntry && povEntry.key, dMin, dMax, effMixer.map((m) => m.mute + ':' + m.vol).join(), solo.join(), beatColors, selectedNoteId, inPoint, nTracks, laneH.join(), trackColors.join(), themeId, speechShow.join(), speechSens, searchHits, wfState && wfState.status, wfState && Math.round((wfState.progress || 0) * 100)])

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
    const lo = latest.current.dMin || 0
    const hi = latest.current.dMax || latest.current.duration || 1
    const d = Math.max(1, hi - lo)
    const span = Math.max(Math.min(MIN_SPAN, d), Math.min(d, end - start))
    start = Math.max(lo, Math.min(hi - span, start))
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
  // The zoom bar: 0 = whole recording … 1 = MIN_SPAN on screen, log scale.
  const zoomGet = useCallback(() => {
    const d = (latest.current.dMax || latest.current.duration || 0) - (latest.current.dMin || 0)
    if (d <= MIN_SPAN) return 0
    const span = view.current.end - view.current.start
    return Math.max(0, Math.min(1, Math.log(d / span) / Math.log(d / MIN_SPAN)))
  }, [])
  const zoomSet = useCallback((z) => {
    const d = (latest.current.dMax || latest.current.duration || 0) - (latest.current.dMin || 0)
    if (d <= MIN_SPAN) return
    const v = view.current
    const span = d / Math.pow(d / MIN_SPAN, z)
    const t = player.getTime()
    zoomAt(span / (v.end - v.start), t >= v.start && t <= v.end ? t : (v.start + v.end) / 2)
    follow.current = true
  }, [])
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
      bus.on('fit', () => { clampView(latest.current.dMin || 0, latest.current.dMax || latest.current.duration); follow.current = true })
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
    const { review, effMixer, solo, beatColors, selectedNoteId, inPoint, nTracks, duration, clip, wfState, laneH, trackColors, speechShow, speechSens, searchHits, shift, povAlign, povEntry, wclip } = latest.current // (read from latest: this draw function is made once, so anything else would be from the first render)
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
          const blocksOn = clipBlocks()
          if (blocksOn) {
            // the recording as one solid clip on this track (Premiere theme)
            const spans = povAlign ? coverage(povAlign, duration, (wclip.probe && wclip.probe.duration) || duration) : [{ a: -shift, b: duration - shift }]
            for (const sp of spans) {
            const xa = Math.max(-2, tToX(sp.a))
            const xb = Math.min(w + 2, tToX(sp.b))
            if (xb > xa) {
              // an empty (silent) track or a muted one: a dim grey clip
              const silent = wclip.probe && wclip.probe.audio[i] && wclip.probe.audio[i].likelySilent // THAT recording's track (a POV's, when one is big)
              ctx.fillStyle = silent ? blockEmpty() : audible ? blockFill(trackColors[i] || TRACK_COLORS[i]) : blockMuted()
              ctx.fillRect(xa, y0 + 1, xb - xa, lh - 3)
              ctx.fillStyle = 'rgba(255,255,255,0.22)'
              ctx.fillRect(xa, y0 + 1, xb - xa, 1)
            }
            }
          }
          ctx.fillStyle = blocksOn ? BLOCK_WAVE : audible ? trackColors[i] || TRACK_COLORS[i] : 'rgba(150,150,160,0.35)'
          ctx.globalAlpha = blocksOn ? 1 : audible ? 0.9 : 1
          const half = lh / 2 - 4
          const pps = wave.pps
          // Pyramid lookups (lib/wavePeaks.js) + one path, one fill.
          ctx.beginPath()
          for (let x = 0; x < w; x++) {
            if (povAlign && gapAt(povAlign, v.start + x * spp)) continue // cut out here
            const t0 = v.start + x * spp + (povAlign ? offsetAt(povAlign, v.start + x * spp) : shift)
            const i0 = Math.floor(t0 * pps)
            let i1 = Math.floor((t0 + spp) * pps)
            if (i1 <= i0) i1 = i0 + 1
            if (i0 >= wave.len) break
            if (i1 <= 0) continue
            const peak = peakBetween(data, Math.max(0, i0), Math.min(i1, wave.len))
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
    // POV big: where YOUR recording begins and ends on their timeline (and where they weren't there to see)
    if (povEntry) {
      const xs = tToX(0)
      const xe = tToX(duration)
      ctx.fillStyle = 'rgba(0,0,0,0.38)'
      if (xs > 0) ctx.fillRect(0, RULER_H, Math.min(w, xs), lanesBottom - RULER_H)
      if (xe < w) ctx.fillRect(Math.max(0, xe), RULER_H, w - Math.max(0, xe), lanesBottom - RULER_H)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(Math.max(0, xs), RULER_H - 3, Math.max(1, Math.min(w, xe) - Math.max(0, xs)), 3)
      ctx.font = '600 10px Inter'
      const mark = (t, text, right) => {
        const x = Math.round(tToX(t)) + 0.5
        if (x < -1 || x > w + 1) return
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x, RULER_H)
        ctx.lineTo(x, lanesBottom)
        ctx.stroke()
        ctx.lineWidth = 1
        const tw = ctx.measureText(text).width
        const lx = right ? x - tw - 8 : x + 4
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(lx - 3, RULER_H + 14, tw + 6, 14)
        ctx.fillStyle = '#fff'
        ctx.textBaseline = 'top'
        ctx.fillText(text, lx, RULER_H + 16)
      }
      // stretches you cut out of theirs
      {
        const pts = povEntry.pts || []
        const edges = [-1e9, ...pts.map((p) => p.at), 1e9]
        const gaps = [!!povEntry.gap, ...pts.map((p) => !!p.gap)]
        for (let i = 0; i < gaps.length; i++) {
          if (!gaps[i]) continue
          const a = Math.max(0, tToX(Math.max(edges[i], v.start)))
          const b = Math.min(w, tToX(Math.min(edges[i + 1], v.end)))
          if (b <= a) continue
          ctx.fillStyle = 'rgba(12,12,16,0.85)'
          ctx.fillRect(a, RULER_H, b - a, lanesBottom - RULER_H)
          ctx.strokeStyle = 'rgba(255,255,255,0.14)'
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let hx = a - (lanesBottom - RULER_H); hx < b; hx += 14) {
            ctx.moveTo(Math.max(a, hx), RULER_H + Math.max(0, a - hx))
            ctx.lineTo(Math.min(b, hx + (lanesBottom - RULER_H)), RULER_H + Math.min(lanesBottom - RULER_H, b - hx))
          }
          ctx.stroke()
          if (b - a > 70) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textBaseline = 'top'; ctx.fillText('Cut out', a + 8, RULER_H + 44) }
        }
      }
      mark(0, 'You start recording', false)
      mark(duration, 'You stop recording', true)
      // where their alignment to yours changes (a pause, a split)
      for (const p of povEntry.pts || []) {
        const x = Math.round(tToX(p.at)) + 0.5
        if (x < 0 || x > w) continue
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, RULER_H)
        ctx.lineTo(x, lanesBottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(x + 1, RULER_H + 30, 126, 14)
        ctx.fillStyle = '#fff'
        ctx.fillText('Their time jumps here', x + 4, RULER_H + 32)
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
    // with a POV big the ruler shows THEIR clock (ticks at round times of theirs)
    const rs = povEntry ? offsetAt(povEntry, (v.start + v.end) / 2) : 0
    const first = Math.floor((v.start + rs) / step) * step
    for (let tt = first; tt - rs <= v.end; tt += step) {
      const t = tt - rs
      const x = Math.round(tToX(t)) + 0.5
      ctx.fillStyle = line
      ctx.fillRect(x, RULER_H - 12, 1, 12)
      ctx.fillStyle = ink
      ctx.fillText(fmtTime(tt), x + 3, RULER_H - 12)
      const minor = step / 5
      for (let k = 1; k < 5; k++) {
        ctx.fillStyle = line
        ctx.fillRect(Math.round(tToX(t + k * minor)) + 0.5, RULER_H - 4, 1, 4)
      }
    }
    // Where each POV (someone else's recording of this session) has footage:
    // a thin bar per POV, under the note shields.
    if (review && review.povs && review.povs.length) {
      const all = useStore.getState().clips
      review.povs.forEach((p, i) => {
        const pc = all.find((c) => c.key === p.key)
        const pd = pc && pc.probe ? pc.probe.duration : 0
        if (!pd) return
        ctx.fillStyle = p.color || POV_COLORS[i % POV_COLORS.length]
        for (const seg of coverage(p, latest.current.duration || Infinity, pd)) {
          const a = Math.max(v.start, seg.a)
          const b = Math.min(v.end, seg.b)
          if (b > a) ctx.fillRect(tToX(a), 21 + i * 3, Math.max(1, tToX(b) - tToX(a)), 2)
        }
      })
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
    let lastOverlay = ''
    let metersZero = false
    const meterVals = []
    const frame = (force) => {
      const { duration, nTracks } = latest.current
      const t = player.getTime()
      if (follow.current && player.playing && !drag.current && duration) {
        const v = view.current
        const span = v.end - v.start
        if (span < (latest.current.dMax || duration) - (latest.current.dMin || 0) - 0.5 && (t > v.end - span * 0.02 || t < v.start)) clampView(t - span * 0.1, t + span * 0.9)
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
            ctx.fillStyle = playheadColor()
            ctx.fillRect(Math.round(x) - 0.5, 0, 1.5, h)
            ctx.beginPath()
            if (clipBlocks()) {
              ctx.moveTo(x - 6, 0)
              ctx.lineTo(x + 6, 0)
              ctx.lineTo(x + 6, 9)
              ctx.lineTo(x, 14)
              ctx.lineTo(x - 6, 9)
            } else {
              ctx.moveTo(x - 5, 0)
              ctx.lineTo(x + 5, 0)
              ctx.lineTo(x, 7)
            }
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
    // every frame, on the app's one shared ticker (lib/hooks.js)
    const off = onTick(0, () => frame())
    return () => {
      off()
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
    const panAmount = makeWheelAxis()
    // Trackpad pinch (Mac): zoom smoothly at the fingers, one step per frame.
    const pinch = onFrame((d, x) => {
      const body = bodyRef.current.getBoundingClientRect()
      const inBody = x >= 0 && x <= body.width
      zoomAt(Math.exp(d * 0.012), inBody ? xToT(x) : null)
    })
    const pan = onFrame((d) => {
      const v = view.current
      const dt = (d / size.current.w) * (v.end - v.start)
      clampView(v.start + dt, v.end + dt)
    })
    const onWheel = (e) => {
      if (!latest.current.duration) return
      e.preventDefault()
      if (isPinch(e)) {
        pinch(e.deltaY, e.clientX - bodyRef.current.getBoundingClientRect().left)
        return
      }
      const d = panAmount(e)
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
      pan(d)
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
    // A POV big: Shift+drag on its tracks slides them against yours (the stretch under the cursor)
    if (e.shiftKey && latest.current.povEntry && y > RULER_H) return slidePov(e, x)
    const n = noteAt(x, y)
    follow.current = false
    if (n && !e.altKey) {
      // Click a marker / note: the playhead lands exactly on it. Drag it: it
      // moves (snapping to the others and the playhead; Ctrl+Z puts it back).
      selectNote(n.id)
      player.seek(n.t)
      drag.current = { kind: 'note', id: n.id, startX: x, orig: n.t, origEnd: n.end, moved: false }
    } else if (n) {
      // Alt+drag from a marker scrubs instead of moving it.
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

  // Slide their footage: dragging right moves what you see of theirs right (their time under yours goes down).
  function slidePov(e, x) {
    e.preventDefault()
    const pe = latest.current.povEntry
    const t0 = xToT(x)
    const cur = () => (useStore.getState().reviews[useStore.getState().currentKey] || { povs: [] }).povs.find((p) => p.key === pe.key) || pe
    const k = stretchAt(cur(), t0)
    const o0 = k < 0 ? cur().off || 0 : cur().pts[k].off
    const x0 = e.clientX
    pushAlign(pe.key)
    follow.current = false
    drag.current = { kind: 'slide' }
    document.body.classList.add('grabbing')
    const move = (ev) => {
      const v = view.current
      const dt = ((ev.clientX - x0) / Math.max(1, size.current.w)) * (v.end - v.start)
      setStretchOffset(pe.key, t0, k, o0 - dt)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('grabbing')
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
    if (area === 'main' && overlayRef.current) overlayRef.current.style.cursor = note ? (e.altKey ? 'col-resize' : drag.current && drag.current.kind === 'note' ? 'grabbing' : 'grab') : y <= RULER_H ? 'col-resize' : 'text'
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
    <div className="timeline" ref={wrapRef} style={{ height: height + (povClip ? 30 : 0) }}>
      {povClip && (
        <div className="tl-pov-bar" style={{ '--c': trackColors[0] }}>
          <span className="tl-pov-who"><i /> <b>{povEntry.name}’s tracks</b></span>
          <label className="tl-pov-vol" title={'All of ' + povEntry.name + '’s tracks together — double-click for 100%'}>
            <span className="dim">Volume</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={povEntry.vol ?? 1}
              onChange={(e) => useStore.getState().updatePov(povEntry.key, { vol: Number(e.target.value) })}
              onDoubleClick={() => useStore.getState().updatePov(povEntry.key, { vol: 1 })}
            />
            <span className="tl-pov-volnum">{Math.round((povEntry.vol ?? 1) * 100)}%</span>
          </label>
          <span className="tl-pov-align">
            <button className="link-btn" onClick={() => splitAt(povEntry.key, player.getTime())} title={'From the playhead on, use a new alignment for ' + povEntry.name + ' (e.g. you paused your recording and they didn’t). Then Shift+drag their tracks to line them up.'}>Out of step from here</button>
            {gapAt(povEntry, playhead) ? (
              <button className="link-btn" onClick={() => cutAt(povEntry.key, player.getTime(), false)} title="Put their footage back for this stretch">Bring this stretch back</button>
            ) : (
              <button className="link-btn" onClick={() => cutAt(povEntry.key, player.getTime(), true)} title="Leave their footage out of this stretch (start and end it with “Out of step from here” first). Their video shows “cut out” there.">Cut out this stretch</button>
            )}
            {stretchAt(povEntry, playhead) >= 0 && <button className="link-btn" onClick={() => mergeAt(povEntry.key, player.getTime())} title="Take this stretch away — the one before it carries on">Merge back</button>}
            <button className="link-btn" disabled={!aligned.canUndo} onClick={undoAlign} title="Undo the last alignment change (Ctrl+Z)">↶</button>
            <button className="link-btn" disabled={!aligned.canRedo} onClick={redoAlign} title="Redo it">↷</button>
          </span>
          <span className="dim small tl-pov-hint" title="Drag their tracks sideways with Shift held to line them up with yours">Shift+drag their tracks to line up</span>
          <span className="grow" />
          <button className="link-btn" onClick={() => useStore.getState().setPovFocus(null)} title="Back to your own tracks (and your view big)">Back to yours</button>
        </div>
      )}
      <div className="tl-row tl-main-row">
        <div className="tl-heads">
          <div className="tl-head tl-ruler-head" style={{ height: RULER_H }}>
            <ZoomBar get={zoomGet} set={zoomSet} onFit={() => bus.emit('fit')} onStep={(dir) => bus.emit('zoom', dir > 0 ? 1 / 1.6 : 1.6)} fitTitle="Fit the whole recording" />
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
                  empty={!!(wclip.probe && wclip.probe.audio[i] && wclip.probe.audio[i].likelySilent)}
                  meterRef={povClip ? undefined : (el) => (meterRefs.current[i] = el)}
                  height={laneH[i]}
                  speechOn={!!speechShow[i]}
                  skipOn={!!speechSkip[i]}
                  pov={povClip ? povEntry.key : null}
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
