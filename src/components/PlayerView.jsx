import React, { useEffect, useRef, useState } from 'react'
import { useStore, trackNamesFor } from '../state/store.js'
import { player, WATCH_SPEEDS } from '../lib/player.js'
import { usePlayerTime, usePlayerState, bus } from '../lib/hooks.js'
import { fmtTime, fmtDay, fmtClock } from '../lib/time.js'
import { clipProgress } from './Library.jsx'
import { MARKER_COLORS } from '../lib/beats.js'
import { useKeyHint } from './Keybinds.jsx'

// A button's key hint, following the user's bindings (hidden if unbound).
function Kbd({ id }) {
  const k = useKeyHint(id)
  return k ? <kbd>{k}</kbd> : null
}

function LibraryToggle() {
  const hidden = useStore((s) => s.settings.libraryHidden)
  const toggleLibrary = useStore((s) => s.toggleLibrary)
  if (!hidden) return null
  return <button className="icon-btn lib-show" onClick={toggleLibrary} title="Show library (Ctrl+\)">»</button>
}

// What's running in the background (transcription, audio prep), so you
// can see it from anywhere. Click the transcription part to open the tab.
function Activity() {
  const tx = useStore((s) => s.tx)
  const waveQueue = useStore((s) => s.waveformQueue)
  const waveKey = useStore((s) => {
    for (const k in s.waveforms) if (s.waveforms[k].status === 'running') return k
    return null
  })
  const waveProg = useStore((s) => (waveKey && s.waveforms[waveKey] ? s.waveforms[waveKey].progress || 0 : 0))
  const r = tx.running
  const txName = useStore((s) => (r ? trackNamesFor(s, r.key)[r.track] : ''))
  const waveLeft = (waveKey ? 1 : 0) + (waveQueue || 0)
  if (!r && !waveLeft) return null
  const openTranscript = () => {
    const st = useStore.getState()
    st.setSideTab(st.settings.sideTab === 'both' ? 'both' : 'transcript')
  }
  const more = tx.queue.length
  return (
    <div className="activity">
      {r && (
        <button className="act-item" onClick={openTranscript} title={'Transcribing on your graphics card' + (more ? ` · ${more} more track${more === 1 ? '' : 's'} queued` : '') + ' — click to open the transcript'}>
          <span className="act-dot" />
          {r.loading ? 'Loading speech model…' : `Transcribing ${txName} · ${r.duration ? Math.floor((100 * r.done) / r.duration) : 0}%`}
          {more > 0 && <span className="dim"> +{more}</span>}
        </button>
      )}
      {waveLeft > 0 && (
        <span className="act-item quiet" title="Building waveforms and per-track audio in the background (makes seeking faster)">
          <span className="act-dot" />
          Preparing audio{waveKey ? ` · ${Math.round(waveProg * 100)}%` : ''}
          {waveLeft > 1 && <span className="dim"> · {waveLeft} left</span>}
        </span>
      )}
    </div>
  )
}

// "2:48:20", "48:20", "90", "1:02:03.5" → seconds; "+30" / "-1:00" jump
// relative to now. null if it doesn't parse.
export function parseTimecode(str, now) {
  const m = String(str).trim().match(/^([+-])?\s*((?:\d+:){0,2}\d+(?:\.\d+)?)$/)
  if (!m) return null
  const secs = m[2].split(':').reduce((a, p) => a * 60 + parseFloat(p), 0)
  if (m[1] === '+') return now + secs
  if (m[1] === '-') return now - secs
  return secs
}

// The playhead time; click it (or Ctrl+G) to type a time to jump to.
function TimeReadout() {
  const t = usePlayerTime(80) // only this readout re-renders with the clock
  const [editing, setEditing] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => bus.on('gotoTime', () => setEditing(true)), [])
  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() }
  }, [editing])
  if (!editing) {
    return (
      <span className="t-cur t-cur-btn" onClick={() => setEditing(true)} title="Click to go to a time (Ctrl+G) — e.g. 2:48:20, or +30 / -1:00">
        {fmtTime(t, true)}
      </span>
    )
  }
  const go = (e) => {
    const v = parseTimecode(e.target.value, player.getTime())
    if (v != null) player.seek(Math.max(0, Math.min(player.duration || v, v)), { exact: true })
    else useStore.getState().showToast("Couldn't read that time — try 2:48:20, 48:20 or +30")
  }
  return (
    <input
      ref={inputRef}
      className="t-goto"
      defaultValue={fmtTime(t, true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { go(e); setEditing(false) }
        if (e.key === 'Escape') setEditing(false)
      }}
      onBlur={() => setEditing(false)}
    />
  )
}

function ClipHeader({ clip }) {
  const review = useStore((s) => s.reviews[clip.key])
  const toggleDone = useStore((s) => s.toggleDone)
  const setStarted = useStore((s) => s.setStarted)
  const p = clipProgress(clip, review)
  const pr = clip.probe
  const codec = pr && pr.vcodec ? { h264: 'H.264', hevc: 'HEVC', av1: 'AV1' }[pr.vcodec] || pr.vcodec.toUpperCase() : null
  return (
    <div className="clip-header">
      <LibraryToggle />
      <div className="ch-title">
        <span className="ch-name">{clip.name}</span>
        <span className="dim small">
          {fmtDay(clip.recordedAt)} · {fmtClock(clip.recordedAt)}
          {pr && pr.width ? ` · ${pr.width}×${pr.height}` : ''}
          {pr && pr.fps ? ` · ${Math.round(pr.fps * 100) / 100}fps` : ''}
          {codec ? ` · ${codec}` : ''}
        </span>
      </div>
      <Activity />
      <div className="ch-actions">
        {p.status === 'new' ? (
          <button className="btn small accent" onClick={() => setStarted(clip.key, true)} title="Mark this recording as one you're reviewing">▶ Start review</button>
        ) : (
          <>
            {p.status === 'started' && <button className="btn small ghost" onClick={() => setStarted(clip.key, false)} title="Back to not started">Not started</button>}
            <button className={'btn small' + (p.status === 'done' ? ' done' : '')} onClick={() => toggleDone(clip.key)} title="Mark reviewed (D)">
              {p.status === 'done' ? '✓ Reviewed' : 'Mark reviewed'}
            </button>
          </>
        )}
        <button className="btn small ghost" onClick={() => window.footage.showItem(clip.path)} title="Show in Explorer">Show file</button>
        <NotesToggle />
      </div>
    </div>
  )
}

function NotesToggle() {
  const hidden = useStore((s) => s.settings.notesHidden)
  const toggleNotesPanel = useStore((s) => s.toggleNotesPanel)
  if (!hidden) return null
  return <button className="icon-btn" onClick={toggleNotesPanel} title="Show notes (Ctrl+Shift+\)">«</button>
}

// Watch speed (the normal playback speed) + live shuttle readout. While
// shuttling the readout shows the shuttle speed in amber; stopping returns
// to the watch speed.
function SpeedControl({ st }) {
  const watchSpeed = useStore((s) => s.settings.watchSpeed || 1)
  const setWatchSpeed = useStore((s) => s.setWatchSpeed)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(null) // where the menu opens (fixed position)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const shuttling = st.rate !== watchSpeed
  const label = (st.rate < 0 ? '◀◀ ' : '') + Math.abs(st.rate) + '×'
  return (
    <div className="speed" ref={ref}>
      <button className={'t-rate' + (shuttling ? ' shuttle' : watchSpeed !== 1 ? ' on' : '')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 }); setOpen(!open) }} title="Watch speed · B / L shuttle faster, J slower — stopping returns here">
        {label}
      </button>
      {open && (
        <div className="speed-menu" style={at}>
          <div className="dim small speed-title">Watch speed</div>
          {WATCH_SPEEDS.map((r) => (
            <button key={r} className={r === watchSpeed ? 'on' : ''} onClick={() => { setWatchSpeed(r); setOpen(false) }}>
              {r}×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Magnet: timeline clicks, scrubs and note drags snap to notes & markers.
function SkipSilenceToggle() {
  const on = useStore((s) => !!s.settings.skipSilence)
  const toggle = useStore((s) => s.toggleSkipSilence)
  return (
    <button className={'snap-btn' + (on ? ' on' : '')} onClick={toggle} title={(on ? 'Skip silence is ON — playback jumps over pauses longer than ~1 s where nobody on the ⇥ tracks is talking. Click to turn off.' : 'Skip silence — play only the parts where someone is talking (uses the ⇥ tracks)') + ' (Shift+X)'}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" />
        <rect x="4" y="4" width="2" height="8" rx="1" fill="currentColor" />
        <path d="M8 8h3" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1 1.4" />
        <path d="M11 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Skip silence</span>
    </button>
  )
}

function SnapToggle() {
  const on = useStore((s) => s.settings.snap !== false)
  const toggleSnap = useStore((s) => s.toggleSnap)
  return (
    <button className={'snap-btn' + (on ? ' on' : '')} onClick={toggleSnap} title={on ? 'Snapping is ON — clicks & drags on the timeline snap to notes and markers. Click to turn off.' : 'Snapping is OFF — click to snap the playhead to notes and markers'}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 2h3v6a2 2 0 0 0 4 0V2h3v6a5 5 0 0 1-10 0V2z" fill="currentColor" />
        <rect x="3" y="2" width="3" height="2.5" fill="currentColor" opacity="0.6" />
        <rect x="10" y="2" width="3" height="2.5" fill="currentColor" opacity="0.6" />
      </svg>
      <span>Snap</span>
    </button>
  )
}

function Transport() {
  const st = usePlayerState()
  const masterVol = useStore((s) => s.settings.masterVol)
  const setMasterVol = useStore((s) => s.setMasterVol)
  const addNote = useStore((s) => s.addNote)
  const markerColor = useStore((s) => s.settings.markerColor)
  const prevMk = useKeyHint('prevMarker')
  const nextMk = useKeyHint('nextMarker')
  const dur = player.duration
  return (
    <div className="transport">
      <button className="t-btn" onClick={() => bus.emit('jumpNote', -1)} title="Previous note ([)">⏮</button>
      <button className="t-btn" onClick={() => player.slower()} title="Slower / reverse (J)">◀◀</button>
      <button className="t-btn play" onClick={() => player.toggle()} title="Play / pause (Space or K)">{st.playing ? '❚❚' : '▶'}</button>
      <button className="t-btn" onClick={() => player.faster()} title="Faster (L)">▶▶</button>
      <button className="t-btn" onClick={() => bus.emit('jumpNote', 1)} title="Next note (])">⏭</button>
      <span className="mk-nav" style={{ '--c': (MARKER_COLORS[markerColor] || MARKER_COLORS.yellow).hex }}>
        <button className="t-btn mk-nav-btn" onClick={() => bus.emit('jumpNote', -1, 'MARKER')} title={'Previous marker' + (prevMk ? ' (' + prevMk + ')' : '')}>‹<span className="mk-shield" /></button>
        <button className="t-btn mk-nav-btn" onClick={() => bus.emit('jumpNote', 1, 'MARKER')} title={'Next marker' + (nextMk ? ' (' + nextMk + ')' : '')}><span className="mk-shield" />›</button>
      </span>
      <div className="t-time">
        <TimeReadout />
        <span className="dim"> / {fmtTime(dur)}</span>
      </div>
      <SpeedControl st={st} />
      <SnapToggle />
      <SkipSilenceToggle />
      <div className="t-spacer" />
      <button className="btn small" onClick={() => addNote('beat')} title="Add beat at playhead">+ Beat <Kbd id="addBeat" /></button>
      <button className="btn small" onClick={() => addNote('note')} title="Add plain note">+ Note <Kbd id="addNote" /></button>
      <button className="btn small marker-btn" style={{ '--c': (MARKER_COLORS[markerColor] || MARKER_COLORS.yellow).hex }} onClick={() => addNote('marker')} onContextMenu={(e) => { e.preventDefault(); useStore.getState().openColorMenu({ x: e.clientX, y: e.clientY }) }} title="Drop a colored Premiere marker · right-click to choose the color new markers use"><span className="mk-shield" /> Marker <Kbd id="addMarker" /></button>
      <button className="btn small ghost" onClick={() => addNote('break')} title="Scene break">Break <Kbd id="sceneBreak" /></button>
      <div className="t-vol" title={`Master volume ${Math.round(masterVol * 100)}%`}>
        <span>🔊</span>
        <input type="range" min="0" max="1.5" step="0.01" value={masterVol} onChange={(e) => setMasterVol(Number(e.target.value))} onDoubleClick={() => setMasterVol(1)} />
      </div>
      <button className="t-btn" onClick={() => bus.emit('fullscreen')} title="Fullscreen (F)">⛶</button>
    </div>
  )
}

export default function PlayerView() {
  const clip = useStore((s) => s.clips.find((c) => c.key === s.currentKey) || null)
  const clipsCount = useStore((s) => s.clips.length)
  const videoRef = useRef(null)
  const ghostRef = useRef(null)
  const stageRef = useRef(null)
  const [osd, setOsd] = useState(null)
  const [error, setError] = useState(null)
  const st = usePlayerState()

  useEffect(() => {
    player.attach(videoRef.current)
    player.attachGhost(ghostRef.current)
    const offs = [
      player.on('error', (m) => setError(m)),
      bus.on('osd', (text) => {
        const id = Date.now()
        setOsd({ id, text })
        setTimeout(() => setOsd((o) => (o && o.id === id ? null : o)), 700)
      }),
      bus.on('fullscreen', () => {
        if (document.fullscreenElement) document.exitFullscreen()
        else stageRef.current && stageRef.current.requestFullscreen()
      })
    ]
    return () => offs.forEach((o) => o())
  }, [])

  useEffect(() => setError(null), [clip && clip.key])

  return (
    <div className="player-area">
      {clip ? <ClipHeader clip={clip} /> : <div className="clip-header"><LibraryToggle /><span className="grow" /><NotesToggle /></div>}
      <div className="stage" ref={stageRef} onDoubleClick={() => bus.emit('fullscreen')}>
        <video ref={videoRef} className="video" onClick={() => player.toggle()} />
        {/* Instant-seek stand-in, see player.js "ghost". Clicks pass through. */}
        <video ref={ghostRef} className="video ghost" muted />

        {!clip && (
          <div className="stage-empty">
            {clipsCount ? 'Pick a recording on the left.' : 'Add your recordings folder to get started.'}
          </div>
        )}
        {error && clip && (
          <div className="stage-error">
            Couldn't play this file: {error}
          </div>
        )}
        {st.skimming && <div className="skim-badge">{st.rate < 0 ? '◀◀' : '▶▶'} {Math.abs(st.rate)}×</div>}
        {osd && <div className="osd" key={osd.id}>{osd.text}</div>}
      </div>
      {clip && <Transport />}
    </div>
  )
}
