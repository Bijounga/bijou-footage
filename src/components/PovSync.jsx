// Lining a POV up with your recording. Two ways, as you like:
//   by sound   "Match by sound" — compares the two recordings' audio (your
//              Discord against theirs, any track against any) and finds the
//              shift; a fresh POV starts doing this on its own
//   by eye     switch to "Separately", move each side to the same moment (a
//              death, a door, someone talking), then "These match" (M)
// Then check it: "Together" runs them locked, and the nudges (Alt+← →) move
// theirs a frame / a tenth / a second at a time until it's right — or drag
// their waveform against yours.
// Keys: Space play / pause · ← → a second · Shift+← → five · , . a frame ·
// Alt+← → nudge theirs a frame (Shift: a tenth) · T together / separately ·
// M these match · Enter save · Esc cancel. Ctrl+scroll zooms into a picture.
import React, { useEffect, useRef, useState } from 'react'
import { useStore, trackNamesFor, useTrackColors } from '../state/store.js'
import { player, mediaUrl } from '../lib/player.js'
import { findOffset, loadPeaks, overlap, preciseGuess, guessOffset, startOf } from '../lib/povSync.js'
import { useVideoZoom } from '../lib/videoZoom.js'
import SyncWaves from './SyncWaves.jsx'
import { makeSideAudio } from '../lib/syncAudio.js'
import { offsetText } from './PovStage.jsx'
import { fmtTime, fmtDay, fmtClock } from '../lib/time.js'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// One side: a picture you can zoom into, its own playhead, and a few controls.
function Pane({ title, color, clip, vref, t, setT, dur, muted, setMuted, fps, onPlay, playing, follows, active, onActivate, note, tracksOwnSound }) {
  const stageRef = useRef(null)
  const zoom = useVideoZoom(stageRef, 'video', clip && clip.key)
  return (
    <div className={'ps-pane' + (active ? ' active' : '')} style={{ '--cc': color }} onMouseDown={onActivate}>
      <div className="ps-pane-head">
        <i className="ps-dot" />
        <b>{title}</b>
        <span className="ps-time">{fmtTime(t, true)}</span>
        <span className="vo-tx-spacer" />
        <button className={'mini-btn' + (muted ? '' : ' on')} onClick={() => setMuted(!muted)} title={muted ? 'Sound off — click to hear it' : 'Sound on — click to mute'}>{muted ? 'Muted' : 'Sound on'}</button>
      </div>
      <div className="ps-video" ref={stageRef}>
        {clip ? <video ref={vref} src={mediaUrl(clip.path)} muted={muted || tracksOwnSound} preload="auto" onClick={onPlay} /> : <div className="dim">Missing</div>}
        {zoom.scale !== 1 && (
          <button className="zoom-badge" onClick={(e) => { e.stopPropagation(); zoom.reset() }} title="Back to 100%">{Math.round(zoom.scale * 100)}% ⟲</button>
        )}
        {!playing && clip && !note && <span className="ps-paused">❚❚</span>}
        {note && <div className="ps-note">{note}</div>}
      </div>
      <input
        type="range"
        className="ps-scrub"
        min="0"
        max={dur || 1}
        step="0.01"
        value={clamp(t, 0, dur || 1)}
        disabled={follows}
        onChange={(e) => setT(Number(e.target.value))}
        title={follows ? 'Following yours — switch to Separately to move this one on its own' : 'Drag to find the moment'}
      />
      {!follows && (
        <div className="ps-row">
          <button className="mini-btn" onClick={() => setT(t - 1)} title="Back 1 second (←)">−1s</button>
          <button className="mini-btn" onClick={() => setT(t - 1 / fps)} title="Back a frame (,)">−1f</button>
          <button className="mini-btn" onClick={onPlay} title="Play / pause (Space)">{playing ? 'Pause' : 'Play'}</button>
          <button className="mini-btn" onClick={() => setT(t + 1 / fps)} title="Forward a frame (.)">+1f</button>
          <button className="mini-btn" onClick={() => setT(t + 1)} title="Forward 1 second (→)">+1s</button>
        </div>
      )}
      {follows && <div className="ps-row dim small ps-follows">Following yours{zoom.scale === 1 ? ' · Ctrl+scroll to zoom in' : ''}</div>}
    </div>
  )
}

export default function PovSync() {
  const sync = useStore((s) => s.povSync)
  const mainClip = useStore((s) => (sync ? s.clips.find((c) => c.key === sync.main) : null))
  const povClip = useStore((s) => (sync ? s.clips.find((c) => c.key === sync.pov) : null))
  const pov = useStore((s) => (sync && s.reviews[sync.main] ? (s.reviews[sync.main].povs || []).find((p) => p.key === sync.pov) : null))
  const youSet = useStore((s) => s.settings.povYou)
  const you = { name: 'You', color: '#e5e7eb', ...(youSet || {}) }
  const [off, setOff] = useState(pov ? pov.off || 0 : 0)
  const [linked, setLinked] = useState(true)
  const [tm, setTm] = useState(() => player.getTime())
  const [tp, setTp] = useState(() => player.getTime() + (pov ? pov.off || 0 : 0))
  const [playM, setPlayM] = useState(false)
  const [playP, setPlayP] = useState(false)
  const [mutedM, setMutedM] = useState(false)
  const [mutedP, setMutedP] = useState(false)
  const [auto, setAuto] = useState(null) // {phase, progress, result, error}
  const [prep, setPrep] = useState(null) // their / your audio being prepared: {who, p}
  const [side, setSide] = useState('main') // which side the keys move when they're separate
  const vm = useRef(null)
  const vp = useRef(null)
  const offRef = useRef(off)
  offRef.current = off
  const linkedRef = useRef(linked)
  linkedRef.current = linked
  const fps = (povClip && povClip.probe && povClip.probe.fps) || 60
  const durM = (mainClip && mainClip.probe && mainClip.probe.duration) || 0
  const durP = (povClip && povClip.probe && povClip.probe.duration) || 0
  const name = pov ? pov.name : 'POV'
  const povColor = (pov && pov.color) || '#4fd1c5'

  useEffect(() => { player.pause() }, [])
  // every track of both sides through a mixer, so you can mute / solo them
  const ctxRef = useRef(null)
  const sides = useRef({})
  const [own, setOwn] = useState({ a: false, b: false }) // that side's tracks play on their own
  const [mix, setMix] = useState({ a: {}, b: {} })
  useEffect(() => {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    ctxRef.current = ctx
    sides.current = { a: makeSideAudio(ctx), b: makeSideAudio(ctx) }
    window.__syncSides = sides.current // for tests (scripts/cdp.mjs)
    let gone = false
    const hook = async (side, clip, vref) => {
      if (!clip) return
      const files = await window.footage.audioFiles(clip).catch(() => ({}))
      if (gone || !vref.current) return
      if (sides.current[side].attach(vref.current, files)) setOwn((o) => ({ ...o, [side]: true }))
    }
    hook('a', mainClip, vm)
    hook('b', povClip, vp)
    return () => {
      gone = true
      sides.current.a.stop()
      sides.current.b.stop()
      ctx.close().catch(() => {})
    }
  }, [])
  const anySolo = Object.values(mix.a).some((m) => m.solo) || Object.values(mix.b).some((m) => m.solo)
  const audible = (side, i) => {
    if (side === 'a' ? mutedM : mutedP) return false
    const m = mix[side][i] || {}
    return anySolo ? !!m.solo : !m.mute
  }
  useEffect(() => {
    for (const side of ['a', 'b']) if (sides.current[side]) sides.current[side].mix((i) => (audible(side, i) ? 1 : 0))
  }, [mix, mutedM, mutedP, own])
  const onMix = (side, i, what) => setMix((x) => {
    const cur = x[side][i] || {}
    if (what === 'mute') return { ...x, [side]: { ...x[side], [i]: { ...cur, mute: !cur.mute } } }
    if (what === 'soloAdd') return { ...x, [side]: { ...x[side], [i]: { ...cur, solo: !cur.solo } } }
    // solo: just this one (or none, if it already was the only one)
    const only = cur.solo && [...Object.values(x.a), ...Object.values(x.b)].filter((m) => m.solo).length === 1
    const clear = (o) => Object.fromEntries(Object.entries(o).map(([k, m]) => [k, { ...m, solo: false }]))
    const next = { a: clear(x.a), b: clear(x.b) }
    if (!only) next[side][i] = { ...(next[side][i] || {}), solo: true }
    return next
  })
  // start where you were — or, if they weren't recording then, where you both are
  useEffect(() => {
    const a = vm.current
    if (!a) return
    const go = () => {
      let t = player.getTime()
      const o = offRef.current
      if (t + o < 0 || t + o > durP) t = Math.min(durM, Math.max(0, -o) + Math.min(5, durP / 4))
      seekM(t)
    }
    if (a.readyState >= 1) go()
    else a.addEventListener('loadedmetadata', go, { once: true })
  }, [])
  // both recordings' waveforms: for the waveform view and for matching by sound
  const [peaks, setPeaks] = useState({ A: null, B: null })
  const peaksP = useRef(null)
  const getPeaks = () => {
    if (!peaksP.current) {
      const st = () => useStore.getState()
      peaksP.current = (async () => {
        const A = await loadPeaks(mainClip, (p) => setPrep({ who: 'yours', p }), () => st().waveforms[mainClip.key])
        setPeaks((x) => ({ ...x, A }))
        const B = await loadPeaks(povClip, (p) => setPrep({ who: 'theirs', p }), () => st().waveforms[povClip.key])
        setPeaks({ A, B })
        setPrep(null)
        return { A, B }
      })()
      peaksP.current.catch((e) => { peaksP.current = null; setPrep({ error: String(e.message || e) }) })
    }
    return peaksP.current
  }
  useEffect(() => {
    if (!mainClip || !povClip) return
    if (sync && sync.auto) runAuto()
    else getPeaks().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const trackColors = useTrackColors()

  // keep the readouts with the videos; when together, theirs follows yours
  useEffect(() => {
    const id = setInterval(() => {
      const a = vm.current
      const b = vp.current
      if (a) { setTm(a.currentTime); setPlayM(!a.paused) }
      if (b) { setTp(b.currentTime); setPlayP(!b.paused) }
      if (a && b && linkedRef.current) {
        const want = a.currentTime + offRef.current
        if (want < 0 || want > (b.duration || Infinity)) { if (!b.paused) b.pause(); return }
        if (!a.paused) {
          if (b.paused) { b.currentTime = want; b.play().catch(() => {}) }
          const d = b.currentTime - want
          if (Math.abs(d) > 0.25) b.currentTime = want
          else b.playbackRate = 1 - clamp(d * 0.6, -0.06, 0.06)
        } else {
          if (!b.paused) b.pause()
          if (Math.abs(b.currentTime - want) > 0.02 && !b.seeking) b.currentTime = want
        }
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

  const seekM = (t) => {
    const a = vm.current
    if (!a) return
    a.currentTime = clamp(t, 0, durM || t)
    setTm(a.currentTime)
    if (linkedRef.current) seekP(a.currentTime + offRef.current, true)
  }
  const seekP = (t, force) => {
    const b = vp.current
    if (!b || (linkedRef.current && !force)) return
    b.currentTime = clamp(t, 0, durP || t)
    setTp(b.currentTime)
  }
  const align = (o) => {
    const a = vm.current
    if (a) seekP(a.currentTime + o, true)
  }
  const nudge = (d) => {
    const o = Math.round((offRef.current + d) * 1000) / 1000
    setOff(o)
    if (linkedRef.current) align(o)
  }
  const playToggle = (which) => {
    if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume()
    const a = vm.current
    const b = vp.current
    if (linkedRef.current || which === 'main') {
      if (!a) return
      if (a.paused) a.play().catch(() => {})
      else a.pause()
      return
    }
    if (!b) return
    if (b.paused) b.play().catch(() => {})
    else b.pause()
  }
  const theseMatch = () => {
    const a = vm.current
    const b = vp.current
    if (!a || !b) return
    setOff(Math.round((b.currentTime - a.currentTime) * 1000) / 1000)
    setLinked(true)
    setAuto(null)
  }

  async function runAuto() {
    if (!mainClip || !povClip) return
    try {
      setAuto({ phase: 'prep' })
      const { A, B } = await getPeaks()
      setAuto({ phase: 'match', progress: 0 })
      // both files say when they started recording: only look around there
      const near = preciseGuess(mainClip, povClip) ? guessOffset(mainClip, povClip) : null
      let r = await findOffset(A, B, { near, onProgress: (p) => setAuto({ phase: 'match', progress: p }) })
      // nothing clear near the time the files say (an edited copy can carry
      // the original's time): look everywhere
      if (near != null && (!r || r.confidence < 0.3)) {
        const wide = await findOffset(A, B, { onProgress: (p) => setAuto({ phase: 'match', progress: p }) })
        if (wide && (!r || wide.z > r.z)) r = wide
      }
      if (!r) return setAuto({ phase: 'done', result: null })
      setAuto({ phase: 'done', result: r })
      if (r.confidence > 0.05) {
        setOff(Math.round(r.offset * 1000) / 1000)
        setLinked(true)
        // somewhere you can both be seen
        const a = vm.current
        if (a) {
          let t = a.currentTime
          if (t + r.offset < 0 || t + r.offset > durP) t = Math.max(0, -r.offset) + Math.min(10, durP / 4)
          seekM(t)
          align(r.offset)
        }
      }
    } catch (e) {
      setAuto({ phase: 'error', error: String(e.message || e) })
    }
  }

  useEffect(() => { if (linked) align(off) }, [linked])

  const close = () => useStore.getState().closePovSync()
  const save = () => {
    useStore.getState().updatePov(sync.pov, { off, synced: true })
    close()
  }

  // the window's keys (the app's own keys are off while it's open)
  const keys = useRef(null)
  keys.current = (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || ''
    if (tag === 'INPUT' && document.activeElement.type === 'text') return
    const target = linkedRef.current ? 'main' : side
    const move = (d) => (target === 'main' ? seekM((vm.current ? vm.current.currentTime : tm) + d) : seekP((vp.current ? vp.current.currentTime : tp) + d))
    let done = true
    if (e.key === ' ') playToggle(target)
    else if (e.key === 'Escape') close()
    else if (e.key === 'Enter') save()
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) nudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 1 / fps))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') move((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))
    else if (e.key === ',' || e.key === '.') { if (vm.current) vm.current.pause(); if (vp.current) vp.current.pause(); move((e.key === ',' ? -1 : 1) / fps) }
    else if (e.key.toLowerCase() === 't') setLinked((l) => !l)
    else if (e.key.toLowerCase() === 'm' && !linkedRef.current) theseMatch()
    else if (e.key === 'Tab' && !linkedRef.current) setSide((s) => (s === 'main' ? 'pov' : 'main'))
    else done = false
    if (done) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  useEffect(() => {
    const h = (e) => keys.current(e)
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  if (!sync) return null
  const names = mainClip ? trackNamesFor(useStore.getState(), mainClip.key) : []
  const res = auto && auto.result
  // the recording of yours it was really recorded alongside
  const home = mainClip && povClip ? useStore.getState().clips.filter((c) => c.probe && c.key !== povClip.key && c.key !== mainClip.key).map((c) => ({ c, o: overlap(c, povClip) })).filter((x) => x.o > 60).sort((a, b) => b.o - a.o).map((x) => x.c)[0] || null : null
  const apart = mainClip && povClip && mainClip.probe && povClip.probe && overlap(mainClip, povClip) < -60 && preciseGuess(mainClip, povClip)
  const busy = auto && (auto.phase === 'prep' || auto.phase === 'match')
  // theirs, following yours, when they weren't recording
  const at = tm + off
  const povNote = linked && durP ? (at < 0 ? name + ' starts recording in ' + fmtTime(-at, true) : at > durP ? name + ' stopped recording ' + fmtTime(at - durP) + ' ago' : null) : null
  const prepText = prep && !prep.error ? `Getting ${prep.who === 'yours' ? 'your' : name + '’s'} audio ready… ${Math.round((prep.p || 0) * 100)}%` : null
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal ps-modal">
        <div className="ps-head">
          <h3>Line up {name}</h3>
          <span className="ps-offset" style={{ '--cc': povColor }}>{offsetText(off)}</span>
          <span className="vo-tx-spacer" />
          <button className="btn small accent" onClick={runAuto} disabled={busy} title="Compare the two recordings’ audio and line them up">{busy ? 'Matching…' : 'Match by sound'}</button>
        </div>
        <div className="ps-status-row small">
          {!auto && !prepText && <span className="dim">Line it up by sound, or by eye: switch to <b>Separately</b>, put both on the same moment, press <b>These match</b>.</span>}
          {auto && auto.phase === 'prep' && <span className="dim">{prepText || 'Getting the audio ready…'}</span>}
          {!auto && prepText && <span className="dim">{prepText}</span>}
          {auto && auto.phase === 'match' && <span className="dim">Comparing… {Math.round((auto.progress || 0) * 100)}%</span>}
          {auto && auto.phase === 'error' && <span className="ps-bad">{auto.error}</span>}
          {auto && auto.phase === 'done' && !res && <span className="ps-bad">Neither recording has any sound to compare — line it up by eye instead.</span>}
          {res && res.confidence >= 0.5 && <span className="ps-good">✓ Matched by sound — your {names[res.pair[0]] || 'track ' + (res.pair[0] + 1)} and their track {res.pair[1] + 1}. Press Space to check it.</span>}
          {res && res.confidence > 0.05 && res.confidence < 0.5 && <span className="ps-warn">Probably right, but not certain — press Space to check it, or line it up by eye.</span>}
          {res && res.confidence <= 0.05 && <span className="ps-bad">Couldn’t find a clear match by sound — line it up by eye: Separately, same moment in both, These match.</span>}
        </div>
        {apart && (
          <div className="ps-apart">
            These two weren’t recorded at the same time: {name} started {fmtDay(startOf(povClip))} at {fmtClock(startOf(povClip))}, yours {fmtDay(startOf(mainClip))} at {fmtClock(startOf(mainClip))}.{' '}
            {home ? (
              <button className="btn small accent ps-move" onClick={() => useStore.getState().movePov(sync.pov, home.key)}>Move it to your {fmtDay(startOf(home))} {fmtClock(startOf(home))} recording</button>
            ) : (
              'None of your recordings is from then — line it up by hand if the times are wrong.'
            )}
          </div>
        )}
        <div className="ps-panes">
          <Pane title={you.name} color={you.color} clip={mainClip} vref={vm} t={tm} setT={seekM} dur={durM} muted={mutedM} setMuted={setMutedM} tracksOwnSound={own.a} fps={fps} onPlay={() => playToggle('main')} playing={playM} active={!linked && side === 'main'} onActivate={() => setSide('main')} />
          <Pane title={name} color={povColor} clip={povClip} vref={vp} t={tp} setT={(t) => seekP(t)} dur={durP} muted={mutedP} setMuted={setMutedP} tracksOwnSound={own.b} fps={fps} onPlay={() => playToggle('pov')} playing={linked ? playM : playP} follows={linked} active={!linked && side === 'pov'} onActivate={() => setSide('pov')} note={povNote} />
        </div>
        <div className="ps-mode">
          <div className="seg ps-seg" title="Together: theirs follows yours (check and nudge). Separately: move each on its own to find the same moment. (T)">
            <button className={linked ? 'on' : ''} onClick={() => setLinked(true)}>Together</button>
            <button className={!linked ? 'on' : ''} onClick={() => setLinked(false)}>Separately</button>
          </div>
          {linked ? (
            <span className="ps-nudge" title="Move theirs earlier or later against yours">
              <span className="dim small">Nudge {name}</span>
              <button className="mini-btn" onClick={() => nudge(-1)}>−1s</button>
              <button className="mini-btn" onClick={() => nudge(-0.1)} title="Shift+Alt+←">−0.1s</button>
              <button className="mini-btn" onClick={() => nudge(-1 / fps)} title="Alt+←">−1 frame</button>
              <button className="mini-btn" onClick={() => nudge(1 / fps)} title="Alt+→">+1 frame</button>
              <button className="mini-btn" onClick={() => nudge(0.1)} title="Shift+Alt+→">+0.1s</button>
              <button className="mini-btn" onClick={() => nudge(1)}>+1s</button>
            </span>
          ) : (
            <span className="ps-nudge">
              <span className="dim small">Put both on the same moment (click a side, then ← → , . move it) —</span>
              <button className="btn small accent" onClick={theseMatch} title="Use this: both sides show the same moment (M)">These match</button>
            </span>
          )}
        </div>
        <SyncWaves
          A={peaks.A}
          B={peaks.B}
          waiting={prepText || (prep && prep.error) || null}
          off={off}
          setOff={setOff}
          t={tm}
          onSeek={seekM}
          onCommit={(o) => { if (linkedRef.current) align(o) }}
          mainNames={names}
          mainColors={trackColors}
          povName={name}
          povColor={povColor}
          mix={mix}
          onMix={own.a || own.b ? onMix : null}
          audible={audible}
        />
        <div className="ps-foot">
          <span className="dim small ps-keys">
            <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> 1 s · <kbd>,</kbd><kbd>.</kbd> frame · <kbd>Alt</kbd>+<kbd>←</kbd><kbd>→</kbd> nudge theirs · <kbd>T</kbd> together / separately · <kbd>Ctrl</kbd>+scroll zoom · <kbd>Enter</kbd> save
          </span>
          <span className="vo-tx-spacer" />
          <button className="btn small ghost" onClick={close}>Cancel</button>
          <button className="btn small accent" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
