// Lining a POV up with your recording. Two ways, as you like:
//   by sound   "Match by sound" — compares the two recordings' audio (your
//              Discord against theirs, any track against any) and finds the
//              shift; a fresh POV starts doing this on its own
//   by eye     move each side to the same moment (a death, a door, someone
//              talking) with its own playhead, then "These match"
// Then check it: with "Play together" they run locked, and the nudges move
// theirs a frame / a tenth / a second at a time until it's right.
import React, { useEffect, useRef, useState } from 'react'
import { useStore, trackNamesFor } from '../state/store.js'
import { player, mediaUrl } from '../lib/player.js'
import { findOffset, loadPeaks, overlap, preciseGuess, guessOffset, startOf } from '../lib/povSync.js'
import SyncWaves from './SyncWaves.jsx'
import { useTrackColors } from '../state/store.js'
import { fmtDay, fmtClock } from '../lib/time.js'
import { offsetText } from './PovStage.jsx'
import { fmtTime } from '../lib/time.js'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// One side: a picture, its own playhead, and a few controls.
function Pane({ title, clip, vref, t, setT, dur, muted, setMuted, fps, onPlay, playing, disabledSeek }) {
  return (
    <div className="ps-pane">
      <div className="ps-pane-head">
        <b>{title}</b>
        <span className="vo-tx-spacer" />
        <button className={'mini-btn' + (muted ? '' : ' on')} onClick={() => setMuted(!muted)} title={muted ? 'Sound off — click to hear it' : 'Sound on'}>{muted ? 'Muted' : 'Sound'}</button>
      </div>
      <div className="ps-video">
        {clip ? <video ref={vref} src={mediaUrl(clip.path)} muted={muted} preload="auto" onClick={onPlay} /> : <div className="dim">Missing</div>}
      </div>
      <input
        type="range"
        className="ps-scrub"
        min="0"
        max={dur || 1}
        step="0.01"
        value={clamp(t, 0, dur || 1)}
        disabled={disabledSeek}
        onChange={(e) => setT(Number(e.target.value))}
        title={disabledSeek ? 'Following yours (Play together is on)' : 'Drag to find the moment'}
      />
      <div className="ps-row">
        <span className="ps-time">{fmtTime(t, true)}</span>
        <span className="vo-tx-spacer" />
        {!disabledSeek && (
          <>
            <button className="mini-btn" onClick={() => setT(t - 1)} title="Back 1 second">−1s</button>
            <button className="mini-btn" onClick={() => setT(t - 1 / fps)} title="Back a frame">−1f</button>
            <button className="mini-btn" onClick={() => setT(t + 1 / fps)} title="Forward a frame">+1f</button>
            <button className="mini-btn" onClick={() => setT(t + 1)} title="Forward 1 second">+1s</button>
          </>
        )}
        <button className="mini-btn ps-play" onClick={onPlay}>{playing ? 'Pause' : 'Play'}</button>
      </div>
    </div>
  )
}

export default function PovSync() {
  const sync = useStore((s) => s.povSync)
  const mainClip = useStore((s) => (sync ? s.clips.find((c) => c.key === sync.main) : null))
  const povClip = useStore((s) => (sync ? s.clips.find((c) => c.key === sync.pov) : null))
  const pov = useStore((s) => (sync && s.reviews[sync.main] ? (s.reviews[sync.main].povs || []).find((p) => p.key === sync.pov) : null))
  const [off, setOff] = useState(pov ? pov.off || 0 : 0)
  const [linked, setLinked] = useState(true)
  const [tm, setTm] = useState(() => player.getTime())
  const [tp, setTp] = useState(() => player.getTime() + (pov ? pov.off || 0 : 0))
  const [playing, setPlaying] = useState(false)
  const [mutedM, setMutedM] = useState(false)
  const [mutedP, setMutedP] = useState(false)
  const [auto, setAuto] = useState(null) // {phase, progress, result, error}
  const vm = useRef(null)
  const vp = useRef(null)
  const offRef = useRef(off)
  offRef.current = off
  const linkedRef = useRef(linked)
  linkedRef.current = linked
  const fps = (povClip && povClip.probe && povClip.probe.fps) || 60
  const durM = (mainClip && mainClip.probe && mainClip.probe.duration) || 0
  const durP = (povClip && povClip.probe && povClip.probe.duration) || 0

  useEffect(() => { player.pause() }, [])
  // both recordings' waveforms: for the waveform view and for matching by sound
  const [peaks, setPeaks] = useState({ A: null, B: null })
  const peaksP = useRef(null)
  const getPeaks = (onProgress) => {
    if (!peaksP.current) {
      const st = () => useStore.getState()
      peaksP.current = (async () => {
        const A = await loadPeaks(mainClip, (p) => onProgress && onProgress('yours', p), () => st().waveforms[mainClip.key])
        setPeaks((x) => ({ ...x, A }))
        const B = await loadPeaks(povClip, (p) => onProgress && onProgress('theirs', p), () => st().waveforms[povClip.key])
        setPeaks({ A, B })
        return { A, B }
      })()
      peaksP.current.catch(() => { peaksP.current = null })
    }
    return peaksP.current
  }
  useEffect(() => { if (mainClip && povClip && !(sync && sync.auto)) getPeaks().catch(() => {}) }, [])
  const trackColors = useTrackColors()
  useEffect(() => {
    if (sync && sync.auto) runAuto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the readouts with the videos; when linked, theirs follows yours
  useEffect(() => {
    const id = setInterval(() => {
      const a = vm.current
      const b = vp.current
      if (a) setTm(a.currentTime)
      if (b) setTp(b.currentTime)
      if (a && b && linkedRef.current) {
        const want = a.currentTime + offRef.current
        if (want < 0 || want > (b.duration || Infinity)) { if (!b.paused) b.pause(); return }
        if (!a.paused) {
          if (b.paused) { b.currentTime = want; b.play().catch(() => {}) }
          const d = b.currentTime - want
          if (Math.abs(d) > 0.25) b.currentTime = want
          else b.playbackRate = 1 - clamp(d * 0.6, -0.06, 0.06)
        } else if (!b.paused) b.pause()
      }
    }, 120)
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
  const togglePlay = () => {
    const a = vm.current
    const b = vp.current
    if (!a) return
    if (playing) {
      a.pause()
      if (b) b.pause()
      setPlaying(false)
      return
    }
    a.play().catch(() => {})
    if (b && !linkedRef.current) b.play().catch(() => {})
    setPlaying(true)
  }
  const togglePlayP = () => {
    const b = vp.current
    if (!b || linkedRef.current) return togglePlay()
    if (b.paused) b.play().catch(() => {})
    else b.pause()
  }
  const theseMatch = () => {
    const a = vm.current
    const b = vp.current
    if (!a || !b) return
    const o = Math.round((b.currentTime - a.currentTime) * 1000) / 1000
    setOff(o)
    setLinked(true)
    setAuto(null)
  }

  async function runAuto() {
    if (!mainClip || !povClip) return
    const st = () => useStore.getState()
    try {
      setAuto({ phase: 'prep', progress: 0, who: 'yours' })
      const { A, B } = await getPeaks((who, p) => setAuto({ phase: 'prep', progress: p, who }))
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

  if (!sync) return null
  const close = () => useStore.getState().closePovSync()
  const save = () => {
    useStore.getState().updatePov(sync.pov, { off, synced: true })
    close()
  }
  const name = pov ? pov.name : 'POV'
  const names = mainClip ? trackNamesFor(useStore.getState(), mainClip.key) : []
  const res = auto && auto.result
  // the recording of yours it was really recorded alongside
  const home = mainClip && povClip ? useStore.getState().clips.filter((c) => c.probe && c.key !== povClip.key && c.key !== mainClip.key).map((c) => ({ c, o: overlap(c, povClip) })).filter((x) => x.o > 60).sort((a, b) => b.o - a.o).map((x) => x.c)[0] || null : null
  const apart = mainClip && povClip && mainClip.probe && povClip.probe && overlap(mainClip, povClip) < -60 && preciseGuess(mainClip, povClip)
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal ps-modal" onKeyDown={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <h3>Line up {name}</h3>
          <span className="dim small">{offsetText(off)}</span>
        </div>
        <div className="ps-panes">
          <Pane title="You" clip={mainClip} vref={vm} t={tm} setT={seekM} dur={durM} muted={mutedM} setMuted={setMutedM} fps={fps} onPlay={togglePlay} playing={playing} />
          <Pane title={name} clip={povClip} vref={vp} t={tp} setT={(t) => seekP(t)} dur={durP} muted={mutedP} setMuted={setMutedP} fps={fps} onPlay={togglePlayP} playing={playing} disabledSeek={linked} />
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
        <SyncWaves
          A={peaks.A}
          B={peaks.B}
          off={off}
          setOff={setOff}
          t={tm}
          onSeek={seekM}
          onCommit={(o) => { if (linkedRef.current) align(o) }}
          mainNames={names}
          mainColors={trackColors}
          povName={name}
        />
        <div className="ps-tools">
          <div className="ps-way">
            <button className="btn small accent" onClick={runAuto} disabled={auto && (auto.phase === 'prep' || auto.phase === 'match')}>Match by sound</button>
            <span className="dim small ps-status">
              {!auto && 'Compares the two recordings’ audio (your Discord against theirs) and lines them up.'}
              {auto && auto.phase === 'prep' && `Getting ${auto.who === 'yours' ? 'your' : name + '’s'} audio ready… ${Math.round((auto.progress || 0) * 100)}%`}
              {auto && auto.phase === 'match' && `Comparing… ${Math.round((auto.progress || 0) * 100)}%`}
              {auto && auto.phase === 'error' && <span className="ps-bad">{auto.error}</span>}
              {auto && auto.phase === 'done' && !res && <span className="ps-bad">Neither recording has any sound to compare — pick the same moment in both instead.</span>}
              {res && res.confidence >= 0.5 && <span className="ps-good">Matched by sound — your {names[res.pair[0]] || 'track ' + (res.pair[0] + 1)} and their track {res.pair[1] + 1}. Play together to check.</span>}
              {res && res.confidence > 0.05 && res.confidence < 0.5 && <span className="ps-warn">Probably right, but not certain — play together to check, or pick the same moment in both.</span>}
              {res && res.confidence <= 0.05 && <span className="ps-bad">Couldn’t find a clear match by sound — pick the same moment in both and press These match.</span>}
            </span>
          </div>
          <div className="ps-way">
            <label className="check" title="On: theirs follows yours, so you can check the sync and nudge it. Off: move each side on its own to find the same moment.">
              <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> Play together
            </label>
            {!linked && <button className="btn small" onClick={theseMatch} title="Both sides show the same moment now — use that">These match</button>}
            {linked && (
              <span className="ps-nudge" title="Move theirs earlier or later against yours">
                <span className="dim small">Nudge theirs</span>
                <button className="mini-btn" onClick={() => nudge(-1)}>−1s</button>
                <button className="mini-btn" onClick={() => nudge(-0.1)}>−0.1s</button>
                <button className="mini-btn" onClick={() => nudge(-1 / fps)}>−1f</button>
                <button className="mini-btn" onClick={() => nudge(1 / fps)}>+1f</button>
                <button className="mini-btn" onClick={() => nudge(0.1)}>+0.1s</button>
                <button className="mini-btn" onClick={() => nudge(1)}>+1s</button>
              </span>
            )}
            {!linked && <span className="dim small">Move each side to the same moment (a death, a door, someone talking), then press These match.</span>}
          </div>
        </div>
        <div className="ps-foot">
          <span className="vo-tx-spacer" />
          <button className="btn small ghost" onClick={close}>Cancel</button>
          <button className="btn small accent" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
