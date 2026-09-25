// Playback for Edit mode: plays a section (a list of clips from any
// recordings) as one continuous timeline, smoothly through every cut.
//
// Two "decks", each a <video> (picture only) plus one <audio> per OBS
// track. One deck plays the current clip; the other has already loaded the
// NEXT clip, positioned just before its first frame. Shortly before the
// cut it starts playing hidden, and the moment it reaches its first frame
// the two swap — no seek, no load, no gap. A cut in a long-GOP recording
// rarely lands on a keyframe, and an exact seek there takes 200-900 ms;
// doing it ahead of time is what makes playback through cuts smooth.
// Consecutive clips that continue the same recording seamlessly (a split
// that wasn't trimmed) don't swap at all.
//
// The moment of the cut comes from requestVideoFrameCallback (the exact
// media time of each frame shown), with a timer as a fallback.
//
// Audio: every deck's track elements feed one shared GainNode per track
// (the same mixer volumes/mutes as Review), then a master gain.
import { mediaUrl, RATE_LADDER } from './player.js'
import { layout } from './editModel.js'

// The incoming clip starts playing (hidden, silent) this long before its
// cut, from this far before its first frame: a paused video takes ~3
// frames to get moving after play(), which otherwise shows as a hitch at
// every cut. It's swapped in the moment it reaches its first frame.
const LEAD = 0.12
// A video's first frame after play() comes this long later (seconds of
// wall time) — learned from each cut: the outgoing clip's last frame was
// held while the incoming one caught up → start earlier next time; it
// arrived early → start a little later.
const START_LAG_INIT = 0.035
const START_LAG_MAX = 0.15

class Deck {
  constructor(sp, video) {
    this.sp = sp
    this.video = video
    video.muted = true
    video.preload = 'auto'
    this.audios = [] // track index -> <audio>
    this.key = null
    this.idx = -1 // which timeline clip this deck is showing / holding
    this.ready = false // prerolled: sitting on idx's first frame
    this.want = null
    this.seeking = false
    this.waiters = []
    video.addEventListener('seeked', () => this.onSeeked())
  }

  audio(i) {
    let el = this.audios[i]
    if (!el) {
      el = new Audio()
      el.preload = 'auto'
      el.addEventListener('loadedmetadata', () => {
        // Not extracted yet: this element plays the whole recording with
        // only its track enabled (needs the AudioVideoTracks feature).
        if (el._track != null && el.audioTracks && el.audioTracks.length > 1) {
          for (let k = 0; k < el.audioTracks.length; k++) el.audioTracks[k].enabled = k === el._track
        }
      })
      this.sp.connect(el, i)
      this.audios[i] = el
    }
    return el
  }

  async load(src) {
    if (this.key === src.key) return
    this.key = src.key
    // Changing the file abandons any seek in flight — its "seeked" never
    // comes. Release whoever was waiting on it.
    this.finishSeek()
    const meta = new Promise((res) => this.video.addEventListener('loadedmetadata', res, { once: true }))
    this.video.src = mediaUrl(src.path)
    for (let i = 0; i < this.sp.trackCount; i++) {
      const el = this.audio(i)
      if (i >= src.trackCount || src.empty[i]) {
        el.removeAttribute('src')
        el._track = null
        continue
      }
      const file = src.audioFiles[i]
      el._track = file ? null : i
      el.src = mediaUrl(file || src.path)
    }
    await meta
  }

  // Seeks coalesce: while one is in flight, only the newest target is kept.
  seek(t) {
    this.want = t
    const p = new Promise((res) => this.waiters.push(res))
    if (!this.seeking) this.startSeek()
    return p
  }
  startSeek() {
    this.seeking = true
    this.seekingTo = this.want
    this.video.currentTime = this.want
    for (const el of this.audios) if (el && el.src) el.currentTime = this.want
    // Never wait forever on a "seeked" that doesn't come.
    clearTimeout(this.seekTimer)
    this.seekTimer = setTimeout(() => this.seeking && this.onSeeked(true), 4000)
  }
  onSeeked(timedOut = false) {
    if (!this.seeking) return
    if (!timedOut && this.want !== this.seekingTo) return this.startSeek()
    this.finishSeek()
  }
  finishSeek() {
    clearTimeout(this.seekTimer)
    this.seeking = false
    const w = this.waiters
    this.waiters = []
    w.forEach((r) => r())
  }

  play(rate) {
    this.video.playbackRate = rate
    const p = this.video.play().catch(() => {})
    for (const el of this.audios) {
      if (!el || !el.src) continue
      el.playbackRate = rate
      el.currentTime = this.video.currentTime
      el.play().catch(() => {})
    }
    return p
  }
  pause() {
    this.video.pause()
    for (const el of this.audios) if (el) el.pause()
  }
  show(on) {
    // opacity, not visibility: Chrome keeps an invisible video's frames
    // out of the compositor, so the incoming clip wasn't really warm.
    this.video.style.opacity = on ? '1' : '0'
  }
}

class SequencePlayer {
  constructor() {
    this.decks = null
    this.active = null
    this.idle = null
    this.items = []
    this.total = 0
    this.cur = -1
    this.rate = 1
    this.baseRate = 1 // the chosen playback speed (speed button); shuttles return here
    this.shuttling = false
    this.pending = null // timeline time of a seek in progress
    this.listeners = {}
    this.trackCount = 6
    this.resolve = null // key -> Promise<{key, path, trackCount, audioFiles, empty, fps, keyframes}>
    this.sources = new Map()
    this.ctx = null
    this.gains = []
    this.mixer = []
    this.solo = []
    this.masterVol = 1
    this.fps = 60
    this.startLag = START_LAG_INIT
    this.holdAt = 0
  }

  on(evt, fn) {
    ;(this.listeners[evt] ||= new Set()).add(fn)
    return () => this.listeners[evt].delete(fn)
  }
  emit(evt, p) {
    const s = this.listeners[evt]
    if (s) s.forEach((fn) => fn(p))
  }

  // ---- audio ----
  ensureCtx() {
    if (this.ctx) return
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    this.analysers = []
    this.levelBuf = new Float32Array(1024)
    for (let i = 0; i < this.trackCount; i++) {
      const g = this.ctx.createGain()
      const a = this.ctx.createAnalyser()
      a.fftSize = 1024
      g.connect(a)
      a.connect(this.master)
      this.gains.push(g)
      this.analysers.push(a)
    }
    this.applyMix()
  }
  connect(el, i) {
    this.ensureCtx()
    this.ctx.createMediaElementSource(el).connect(this.gains[i])
  }
  setMix(mixer, solo, masterVol) {
    this.mixer = mixer || []
    this.solo = solo || []
    this.masterVol = masterVol ?? 1
    this.applyMix()
  }
  applyMix() {
    if (!this.ctx) return
    const soloOn = this.solo.length > 0
    this.gains.forEach((g, i) => {
      const m = this.mixer[i] || { vol: 1, mute: false }
      const audible = soloOn ? this.solo.includes(i) : !m.mute
      g.gain.value = audible ? m.vol : 0
    })
    this.master.gain.value = this.masterVol
  }

  // Peak level per track (0..1) for the meters, while playing.
  levels() {
    const out = []
    for (let i = 0; i < this.trackCount; i++) {
      const a = this.analysers && this.analysers[i]
      if (!a || !this.playing) { out.push(0); continue }
      a.getFloatTimeDomainData(this.levelBuf)
      let p = 0
      for (let k = 0; k < this.levelBuf.length; k++) { const v = Math.abs(this.levelBuf[k]); if (v > p) p = v }
      out.push(p)
    }
    return out
  }

  // ---- setup ----
  attach(videoA, videoB) {
    if (this.decks && this.decks[0].video === videoA) return
    this.decks = [new Deck(this, videoA), new Deck(this, videoB)]
    this.active = this.decks[0]
    this.idle = this.decks[1]
    this.active.show(true)
    this.idle.show(false)
    for (const d of this.decks) d.video.addEventListener('ended', () => this.cur >= 0 && d === this.active && this.advance())
  }

  source(key) {
    if (!this.sources.has(key)) this.sources.set(key, this.resolve(key))
    return this.sources.get(key)
  }
  // Forget cached sources (e.g. their per-track audio got extracted since).
  refreshSources() {
    this.sources.clear()
  }

  // A new or edited cut. Keeps the position; playback carries on from it.
  async setClips(clips) {
    const T = this.getTime()
    const wasPlaying = this.playing
    this.items = layout(clips).items
    this.total = this.items.reduce((a, c) => a + c.dur, 0)
    if (!this.decks) return
    for (const d of this.decks) {
      d.idx = -1
      d.ready = false
    }
    this.cur = -1
    if (!this.items.length) {
      this.pause()
      this.decks.forEach((d) => d.show(false))
      this.emit('state')
      return
    }
    await this.seek(Math.min(T, Math.max(0, this.total - 0.001)))
    if (wasPlaying) this.play()
  }

  // ---- time ----
  indexAt(T) {
    const it = this.items
    for (let i = 0; i < it.length; i++) if (T < it[i].start + it[i].dur - 1e-6) return i
    return it.length - 1
  }
  getTime() {
    if (this.scrubT != null) return this.scrubT // dragging: exactly under the mouse
    if (this.skim) return this.skim.target
    if (this.pending != null) return this.pending
    const it = this.items[this.cur]
    if (!it || !this.active) return 0
    return Math.max(it.start, Math.min(it.start + it.dur, it.start + (this.active.video.currentTime - it.in)))
  }
  get playing() {
    return !!this.active && this.cur >= 0 && (!this.active.video.paused || this.handover)
  }

  // fast: land on the keyframe before the spot (one-frame decode) — for
  // scrubbing; the final position is then sought exactly.
  async seek(T, { fast = false } = {}) {
    if (!this.decks || !this.items.length) return
    T = Math.max(0, Math.min(this.total, T))
    const idx = this.indexAt(T)
    const it = this.items[idx]
    let st = it.in + Math.min(it.dur, T - it.start)
    if (it.dur - (st - it.in) < 1 / 120) st = Math.max(it.in, it.out - 1 / 60) // not past the clip's last frame
    this.pending = T
    const wasPlaying = this.playing
    const d = this.active
    if (wasPlaying) d.pause()
    let src
    try {
      src = await this.source(it.key)
    } catch (e) {
      this.sources.delete(it.key) // try again next time
      if (this.pending === T) this.pending = null
      this.emit('error', String(e.message || e))
      return
    }
    if (fast) st = this.keyframeBefore(src, st)
    await d.load(src)
    d.idx = idx
    d.ready = false
    this.cur = idx
    await d.seek(st)
    if (this.pending === T) this.pending = null
    d.show(true)
    this.idle.show(false)
    if (wasPlaying) this.play()
    else if (!this.skim) this.preroll(idx + 1) // (not on every skim hop)
    this.emit('seek', T)
  }
  keyframeBefore(src, t) {
    const kf = src.keyframes
    if (!kf) return t
    if (kf.times && kf.times.length) {
      let lo = 0
      let hi = kf.times.length - 1
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (kf.times[m] <= t) lo = m
        else hi = m - 1
      }
      return kf.times[lo] + 0.001
    }
    if (kf.interval) return Math.max(0, kf.phase + Math.floor((t - kf.phase) / kf.interval) * kf.interval) + 0.001
    return t
  }

  // Dragging the playhead: it stays exactly where you point (not on the
  // keyframe the picture jumped to); the picture shows the nearest keyframe
  // while moving and the exact frame as soon as you pause (~0.1 s).
  scrubTo(T) {
    this.scrubT = Math.max(0, Math.min(this.total, T))
    clearTimeout(this.scrubRest)
    this.seek(this.scrubT, { fast: true })
    this.scrubRest = setTimeout(() => { if (this.scrubT != null) this.seek(this.scrubT) }, 110)
    this.emit('seek', this.scrubT)
  }
  scrubEnd() {
    const T = this.scrubT
    this.scrubT = null
    clearTimeout(this.scrubRest)
    if (T != null) {
      this.pending = T // hold the playhead there while the exact frame loads
      return this.seek(T)
    }
  }

  // Load the clip after `idx` into the idle deck, sitting on its first frame.
  async preroll(idx) {
    const it = this.items[idx]
    const d = this.idle
    if (!it || !d) return
    if (this.continues(idx)) return // plays on from the same deck
    if (d.idx === idx && d.ready) return
    d.idx = idx
    d.ready = false
    const src = await this.source(it.key).catch(() => null)
    if (!src || d.idx !== idx) return
    await d.load(src)
    if (d.idx !== idx) return
    await d.seek(Math.max(0, it.in - LEAD))
    if (d.idx === idx) {
      d.ready = true
      d.started = false
    }
  }
  // Clip idx picks up exactly where idx-1 left off in the same recording.
  continues(idx) {
    const a = this.items[idx - 1]
    const b = this.items[idx]
    return a && b && a.key === b.key && Math.abs(b.in - a.out) < 1 / 240
  }

  // ---- play ----
  async play() {
    if (!this.decks || !this.items.length) return
    this.ensureCtx()
    this.ctx.resume()
    if (this.getTime() >= this.total - 1 / 60) await this.seek(0)
    if (this.cur < 0) await this.seek(this.getTime())
    this.active.play(this.rate)
    this.watch()
    this.preroll(this.cur + 1)
    this.emit('state')
  }
  // Pause the decks without ending a shuttle (used when a skim starts).
  halt() {
    if (!this.decks) return
    this.decks.forEach((d) => d.pause())
    clearInterval(this.syncTimer)
  }
  setBaseRate(r) {
    this.baseRate = r
    if (!this.shuttling && !this.skim) {
      this.rate = r
      if (this.playing) this.active.play(r)
    }
    this.emit('state')
  }
  // Any stop ends a shuttle: back to the chosen speed.
  endShuttle() {
    this.shuttling = false
    this.rate = this.baseRate
  }
  pause() {
    if (!this.decks) return
    if (this.skim) {
      // any stop ends a skim where it is
      clearTimeout(this.skim.timer)
      this.skim = null
    }
    if (this.shuttling) this.endShuttle()
    const wasHandover = this.handover
    this.handover = false
    this.holdAt = 0
    this.decks.forEach((d) => {
      d.pause()
      if (d.started) {
        // stopped mid hand-over: the incoming deck has moved off its mark
        d.started = false
        d.ready = false
        d.idx = -1
      }
    })
    clearInterval(this.syncTimer)
    if (wasHandover && this.cur >= 0) this.seek(this.getTime())
    this.emit('state')
  }
  toggle() {
    if (this.skim) return this.stop()
    this.playing ? this.pause() : this.play()
  }
  setRate(r) {
    this.rate = r
    if (this.playing) this.active.play(r)
    this.emit('state')
  }

  // ---- shuttle (J / K / L), like Review ----
  // Up to 10× plays for real; faster, and any reverse, "skims": the decks
  // stay paused and hop keyframe to keyframe on a timer.
  get shuttleRate() {
    return this.skim ? this.skim.rate : this.playing ? this.rate : 0
  }
  get busy() {
    return this.playing || !!this.skim
  }
  faster() {
    if (!this.busy) {
      // from stopped: play at the chosen speed; the next L steps up
      this.shuttling = true
      this.rate = this.baseRate
      this.play()
      this.emit('state')
      return
    }
    const next = RATE_LADDER.find((r) => r > this.shuttleRate + 1e-9)
    if (next != null) this.shuttleTo(next)
  }
  slower() {
    if (!this.busy) return this.shuttleTo(-2)
    const prev = [...RATE_LADDER].reverse().find((r) => r < this.shuttleRate - 1e-9)
    if (prev != null) this.shuttleTo(prev)
  }
  shuttleTo(r) {
    this.shuttling = true
    if (r > 0 && r <= 10) {
      if (this.skim) this.stopSkim()
      this.rate = r
      if (this.playing) this.active.play(r)
      else this.play()
    } else this.startSkim(r)
    this.emit('state')
  }
  // K: stop, back to the chosen speed.
  stop() {
    if (this.skim) this.stopSkim()
    this.pause()
    this.endShuttle()
    this.emit('state')
  }
  startSkim(rate) {
    if (this.skim) {
      this.skim.rate = rate
      return
    }
    const t = this.getTime()
    this.halt()
    this.skim = { rate, target: t, last: performance.now(), busy: false, timer: null }
    const tick = () => {
      const s = this.skim
      if (!s) return
      const now = performance.now()
      s.target += s.rate * ((now - s.last) / 1000)
      s.last = now
      if (s.target <= 0 || s.target >= this.total) {
        s.target = Math.max(0, Math.min(this.total, s.target))
        this.stopSkim()
        this.emit('state')
        return
      }
      if (!s.busy) {
        s.busy = true
        this.seek(s.target, { fast: true }).finally(() => { if (this.skim === s) s.busy = false })
      }
      s.timer = setTimeout(tick, 50)
    }
    this.skim.timer = setTimeout(tick, 0)
    this.emit('state')
  }
  stopSkim() {
    const s = this.skim
    if (!s) return
    clearTimeout(s.timer)
    this.skim = null
    this.seek(s.target) // land exactly
  }

  // Per-frame watch on the playing deck's video. Each callback is bound to
  // its own video, so one still pending on the deck we just left can't
  // trigger a cut on the new one.
  watch() {
    const v = this.active.video
    if (v.requestVideoFrameCallback && !v._seqCb) {
      const cb = (now, meta) => {
        v._seqCb = null
        if (!this.active || v !== this.active.video || !this.playing) return
        this.checkBoundary(meta.mediaTime)
        if (this.playing && this.active.video === v && !v._seqCb) v._seqCb = v.requestVideoFrameCallback(cb)
      }
      v._seqCb = v.requestVideoFrameCallback(cb)
    }
    clearInterval(this.syncTimer)
    this.syncTimer = setInterval(() => this.tick(), 40)
  }
  tick() {
    if (!this.playing) return
    this.checkBoundary(this.active.video.currentTime)
    // keep the track audio locked to the picture
    const t = this.active.video.currentTime
    for (const el of this.active.audios) if (el && el.src && !el.paused && Math.abs(el.currentTime - t) > 0.06) el.currentTime = t
  }
  // Called as each frame is shown: when it's the clip's LAST frame, cut
  // now, so the next vsync already shows the next clip (whose first frame
  // is sitting decoded on the other deck).
  checkBoundary(mediaTime) {
    const it = this.items[this.cur]
    if (!it) return
    const fps = this.fps || 60
    const next = this.cur + 1
    const d = this.idle
    const handsOver = next < this.items.length && !this.continues(next) && d.idx === next && d.ready
    // Get the incoming clip moving, hidden and silent, just before the cut.
    if (handsOver && !d.started && mediaTime >= it.out - LEAD - 1.5 / fps - this.startLag * this.rate) {
      d.started = true
      d.video.playbackRate = this.rate
      d.video.play().catch(() => {})
      this.watchIncoming(d, this.items[next])
    }
    if (mediaTime >= it.out - 1.5 / fps) {
      if (handsOver && d.started) {
        // Last frame of this clip: hold it until the incoming one reaches
        // its first frame (usually it already has, or does next vsync).
        if (!this.handover) this.holdAt = performance.now()
        this.handover = true
        this.active.pause()
        return
      }
      if (!this.handover) this.advance()
    }
  }
  watchIncoming(d, it) {
    const v = d.video
    const fps = this.fps || 60
    const cb = (now, meta) => {
      if (d !== this.idle || !d.started) return
      if (meta.mediaTime >= it.in - 0.5 / fps) this.swapTo(d)
      else v.requestVideoFrameCallback(cb)
    }
    v.requestVideoFrameCallback(cb)
  }
  // The incoming deck (already playing) becomes the active one.
  swapTo(d) {
    const old = this.active
    const fps = this.fps || 60
    if (this.holdAt) {
      // The last frame stayed up longer than a frame: we started late.
      const held = (performance.now() - this.holdAt) / 1000 - 1 / fps
      if (held > 0) this.startLag = Math.min(START_LAG_MAX, this.startLag + 0.6 * held)
    } else if (this.cur >= 0 && this.items[this.cur]) {
      // Swapped before the outgoing clip reached its end: started early.
      const early = (this.items[this.cur].out - old.video.currentTime) / (this.rate || 1) - 1 / fps
      if (early > 0) this.startLag = Math.max(0, this.startLag - 0.5 * early)
    }
    this.holdAt = 0
    d.show(true)
    old.pause()
    old.show(false)
    for (const el of d.audios) {
      if (!el || !el.src) continue
      el.playbackRate = this.rate
      el.currentTime = d.video.currentTime
      el.play().catch(() => {})
    }
    this.handover = false
    this.active = d
    this.idle = old
    this.cur = d.idx
    d.started = false
    d.ready = false
    old.idx = -1
    old.ready = false
    old.started = false
    this.watch()
    this.preroll(this.cur + 1)
  }

  advance() {
    const next = this.cur + 1
    if (next >= this.items.length) {
      this.pause()
      this.cur = this.items.length - 1
      this.emit('ended')
      return
    }
    if (this.continues(next)) {
      this.cur = next
      this.active.idx = next
      this.preroll(next + 1)
      return
    }
    // The next clip wasn't prerolled in time (e.g. an edit right before
    // the cut, or a very short clip): jump to it the slow way.
    this.seek(this.items[next].start).then(() => this.playing || this.play())
  }
}

export const seqPlayer = new SequencePlayer()
if (typeof window !== 'undefined') window.__seq = seqPlayer // like __player: for scripts/cdp.mjs and the smoke test
