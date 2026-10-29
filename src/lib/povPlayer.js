// Keeps the POV videos (other people's recordings of the same session) in
// step with your recording in Review. Your recording stays the clock
// (lib/player.js); each POV just follows: its time = yours + its offset.
//
//   playing     plays along at the same speed, nudging its speed by a few %
//               when it drifts and jumping only if it's way off
//   paused      sits on the exact matching frame
//   scrubbing / skimming   quick keyframe jumps to keep up
//   out of range           (they hadn't started recording yet, or had
//               stopped) paused and hidden, with a note saying when
//
// Sound: a POV is silent unless it's the big view (then yours goes quiet
// instead — store.setPovFocus).
import { player } from './player.js'
import { offsetAt, gapAt } from './povSync.js'

const cams = new Map() // key -> {el, off, dur, onRange}
let timer = 0
let offs = []

// their time at this moment: yours + the offset that holds here (it can change along the way: povSync.js)
function want(c) {
  const t = player.getTime()
  return t + offsetAt(c, t)
}

function inRange(c, t) {
  return t >= 0 && t <= (c.dur || (c.el && c.el.duration) || Infinity) - 0.05
}

function follow(c, quick) {
  const el = c.el
  if (!el || !el.src || el.readyState < 1) return
  const t = want(c)
  const ok = inRange(c, t) && !gapAt(c, player.getTime()) // not before / after they recorded, nor in a stretch you cut out
  if (c.onRange && ok !== c.lastOk) {
    c.lastOk = ok
    c.onRange(ok)
  }
  if (!ok) {
    if (!el.paused) el.pause()
    return
  }
  const playing = player.playing && !player.skim && !player.scrub
  const rate = (player.video && player.video.playbackRate) || 1
  if (!playing) {
    if (!el.paused) el.pause()
    seekTo(c, t, quick)
    return
  }
  const drift = el.currentTime - t
  if (el.paused) {
    el.currentTime = t
    el.playbackRate = rate
    el.play().catch(() => {})
    return
  }
  if (Math.abs(drift) > 0.3) {
    el.currentTime = t
    el.playbackRate = rate
  } else if (Math.abs(drift) > 0.03) el.playbackRate = rate * (1 - Math.max(-0.06, Math.min(0.06, drift * 0.6)))
  else if (el.playbackRate !== rate) el.playbackRate = rate
}

// One seek at a time: a new one while the last is still landing would cancel
// it (scrubbing fires dozens a second — none would ever show). The latest
// wanted time waits and goes as soon as the current seek lands. While
// scrubbing it lands on keyframes (fast); once you let go, the exact frame.
function seekTo(c, t, quick) {
  const el = c.el
  if (Math.abs(el.currentTime - t) <= 0.02 && !el.seeking) return
  if (el.seeking) {
    c.pending = { t, quick }
    if (!c.onSeeked) {
      c.onSeeked = () => {
        const p = c.pending
        c.pending = null
        if (p) seekTo(c, p.t, p.quick)
      }
      el.addEventListener('seeked', c.onSeeked)
    }
    return
  }
  if (quick && el.fastSeek) el.fastSeek(t)
  else el.currentTime = t
}

function followAll(quick) {
  for (const c of cams.values()) follow(c, quick)
}

function start() {
  if (timer) return
  timer = setInterval(() => followAll(false), 200)
  offs = [
    player.on('state', () => followAll(false)),
    player.on('seek', () => followAll(!!player.playing)),
    player.on('seeked', () => followAll(false)),
    player.on('scrub', () => followAll(true)),
    player.on('ghostFrame', () => { if (!player.scrub) followAll(false) })
  ]
}

function stop() {
  clearInterval(timer)
  timer = 0
  offs.forEach((o) => o && o())
  offs = []
}

// The POV that's big (for the viewer window on the other screen).
let bigKey = null
export function setBigPov(key) {
  bigKey = key || null
}
export function bigPovVideo() {
  const c = bigKey && cams.get(bigKey)
  return c && c.el && c.el.readyState >= 2 && c.lastOk !== false ? c.el : null
}

// A POV's <video> joins (or updates: a new offset). Returns a remover.
export function registerPov(key, el, { off, pts, gap, dur, onRange }) {
  const prev = cams.get(key)
  cams.set(key, { el, off, pts, gap, dur, onRange, lastOk: prev ? prev.lastOk : undefined })
  start()
  follow(cams.get(key), false)
  return () => {
    if (cams.get(key) && cams.get(key).el === el) cams.delete(key)
    if (!cams.size) stop()
  }
}

export function setPovOffset(key, off) {
  const c = cams.get(key)
  if (!c) return
  c.off = off
  follow(c, false)
}


// ---- hearing a POV: every one of its tracks ----
// While a POV is the big view you hear it like your own recording: each of
// its audio tracks plays from the small .m4a that background prep extracted
// (electron/main/waveform.js), so they all play (a <video> only plays its
// first) and each has its own mute / solo / volume (the timeline's track
// heads). Before those files exist, its first track plays from the video.
let listening = null // {key, els: [audio], video}

export function listenTo(key, { files, video, off, pts, gap, dur, mix, solo, master }) {
  stopListening()
  // Through the player's audio engine (a gain per track), so the faders go to
  // 200% like your own tracks — an element's own volume stops at 100%.
  player.ensureContext()
  const ctx = player.ctx
  const els = []
  const gains = []
  for (const [i, file] of Object.entries(files || {})) {
    const el = new Audio()
    el.preload = 'auto'
    el.src = 'footage://media/' + encodeURIComponent(file)
    el.dataset.track = i
    const g = ctx.createGain()
    try {
      ctx.createMediaElementSource(el).connect(g)
      g.connect(ctx.destination)
    } catch { /* no engine: plain element volume */ }
    els[+i] = el
    gains[+i] = g
    cams.set(key + '#a' + i, { el, off, pts, gap, dur })
  }
  listening = { key, els, gains, video, fallback: !els.length }
  if (video) video.muted = els.length > 0
  start()
  followAll(false)
  setListenMix(mix, solo, master)
}

export function stopListening() {
  if (!listening) return
  for (const [k, c] of [...cams]) {
    if (k.startsWith(listening.key + '#a')) {
      c.el.pause()
      c.el.removeAttribute('src')
      c.el.load()
      cams.delete(k)
    }
  }
  for (const g of listening.gains || []) if (g) g.disconnect()
  if (listening.video) listening.video.muted = true
  listening = null
}

// mix: [{vol, mute}] per track; solo: [track indexes]; master 0..1.5
export function setListenMix(mix, solo, master) {
  if (!listening) return
  const soloOn = solo && solo.length > 0
  const gainOf = (i) => {
    const m = (mix && mix[i]) || { vol: 1, mute: false }
    const on = soloOn ? solo.includes(i) : !m.mute
    return on ? Math.max(0, m.vol * master) : 0
  }
  const ctx = player.ctx
  listening.els.forEach((el, i) => {
    const g = listening.gains && listening.gains[i]
    if (g && ctx) g.gain.setTargetAtTime(gainOf(i), ctx.currentTime, 0.015)
    else if (el) el.volume = Math.min(1, gainOf(i))
  })
  if (listening.fallback && listening.video) {
    listening.video.muted = gainOf(0) === 0
    listening.video.volume = Math.min(1, gainOf(0))
  }
}

export function setListenOffset(key, off) {
  for (const [k, c] of cams) if (k === key || k.startsWith(key + '#a')) c.off = off
  followAll(false)
}
if (typeof window !== 'undefined') window.__povListen = () => listening // for tests (scripts/cdp.mjs)
