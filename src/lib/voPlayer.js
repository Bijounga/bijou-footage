// Voiceover playback. A VO section is clips played back to back, each a
// window (in → out) into a recorded take. Instead of decoding whole takes
// (an hour of audio would be gigabytes), it reads just the stretch it's
// about to play straight from the WAV (voiceover.js readPcm) in pieces of a
// few seconds, a little ahead of time, and schedules them on the Web Audio
// clock — gapless and sample-exact, however many cuts there are. Each clip
// fades in / out over a few ms so cuts don't click.
import { layoutVo } from './voModel.js'

const api = window.footage
const PIECE = 4 // seconds of audio per read
const AHEAD = 2.5 // keep this much scheduled ahead of the playhead
const EDGE_FADE = 0.004

// One player per place that plays voiceover: the Voiceover tab's own, and
// the one behind Edit's VO lane (voMix, slaved to the cut's playhead).
function makePlayer() {
  const listeners = {}
  return {
  ctx: null,
  master: null,
  folder: null,
  items: [],
  total: 0,
  pos: 0, // the playhead while stopped
  // Speed (pitch stays put: each piece is time-stretched by ffmpeg). `base` is
  // your chosen speed; L / J shuttle above or below it for a while — pausing
  // or stopping puts it back to `base`, like Edit and Review.
  base: 1,
  shuttle: null,
  volume: 1,
  get rate() {
    return this.shuttle != null ? this.shuttle : this.base
  },
  playing: false,
  startCtx: 0, // ctx time the playhead was at startT
  startT: 0,
  sources: [],
  scheduledUntil: 0, // timeline time scheduled up to
  timer: 0,
  cache: new Map(), // `${take}@${t0}` -> Promise<AudioBuffer>
  gen: 0, // bumps on every stop, so late reads are dropped

  on(evt, fn) {
    ;(listeners[evt] ||= new Set()).add(fn)
    return () => listeners[evt].delete(fn)
  },
  emit(evt, p) {
    const s = listeners[evt]
    if (s) s.forEach((fn) => fn(p))
  },
  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' })
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      // a tap after the volume, for the track's level meter
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.master.connect(this.analyser)
    }
    return this.ctx
  },
  // Edit's lane: clips already placed on the timeline ({take, in, out, start, dur, gain}).
  setItems(folder, items) {
    const wasPlaying = this.playing
    const t = this.getTime()
    if (wasPlaying) this.stopSources()
    this.folder = folder
    this.items = items.slice().sort((a, b) => a.start - b.start)
    this.total = this.items.reduce((a, it) => Math.max(a, it.start + it.dur), 0)
    this.pos = t
    if (wasPlaying && t < this.total) this.startAt(t)
    else if (wasPlaying) this.pause()
    this.emit('state')
  },
  setSection(folder, clips) {
    const wasPlaying = this.playing
    const t = this.getTime()
    if (wasPlaying) this.stopSources()
    this.folder = folder
    const { items, total } = layoutVo(clips || [])
    this.items = items
    this.total = total
    this.pos = Math.max(0, Math.min(total, t))
    if (wasPlaying && this.pos < total) this.startAt(this.pos)
    else if (wasPlaying) this.pause()
    this.emit('state')
  },
  // The audio clock (ctx.currentTime) only ticks every ~20 ms, so read raw it
  // moves in steps — invisible at 1×, a stutter at 4× or 8× (each step is that
  // many times longer on the timeline). So the playhead runs on the smooth
  // real-time clock, and each time the audio clock ticks it nudges that clock
  // 5% of the way toward it: it can't drift away from the sound, and it never
  // jumps (a real gap — a stall — snaps it back at once).
  getTime() {
    if (!this.playing) return this.pos
    const now = performance.now() / 1000
    let est = this.startT + (now - this.perfStart) * this.rate
    const c = this.ctx.currentTime
    if (c !== this.lastCtx) {
      this.lastCtx = c
      const audio = this.startT + (c - this.startCtx) * this.rate
      const err = audio - est
      this.perfStart -= (Math.abs(err) > 0.12 * Math.max(1, this.rate) ? err : err * 0.05) / this.rate
      est = this.startT + (now - this.perfStart) * this.rate
    }
    return Math.min(this.total, Math.max(this.startT, est))
  },
  seek(t) {
    t = Math.max(0, Math.min(this.total, t))
    if (this.playing) {
      this.stopSources()
      this.startAt(t)
    } else this.pos = t
    this.emit('seek', t)
  },
  toggle() {
    if (this.playing) this.pause()
    else this.play()
  },
  // Change the speed (by running fn, which sets base / shuttle) without a gap.
  changeRate(fn) {
    const was = this.playing
    const t = was ? this.getTime() : 0
    if (was) this.stopSources()
    fn()
    if (was) this.startAt(t)
    this.emit('state')
  },
  setBase(x) {
    this.changeRate(() => {
      this.base = x
      this.shuttle = null
    })
  },
  // L / J: the next speed up or down from where it is, for now.
  shuttleStep(dir) {
    const ladder = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10]
    const cur = this.rate
    const next = dir > 0 ? ladder.find((x) => x > cur + 1e-6) : [...ladder].reverse().find((x) => x < cur - 1e-6)
    if (!next) return cur
    this.changeRate(() => { this.shuttle = Math.abs(next - this.base) < 1e-6 ? null : next })
    return next
  },
  // Peak level (0..1) right now, for a meter; 0 when stopped.
  level() {
    if (!this.playing || !this.analyser) return 0
    const buf = this.levelBuf || (this.levelBuf = new Float32Array(1024))
    this.analyser.getFloatTimeDomainData(buf)
    let p = 0
    for (let k = 0; k < buf.length; k++) { const v = Math.abs(buf[k]); if (v > p) p = v }
    return p
  },
  setVolume(v) {
    this.volume = v
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015)
  },
  async play() {
    if (this.playing || !this.items.length) return
    let t = this.pos
    if (t >= this.total - 0.01) t = 0
    await this.startAt(t)
  },
  pause() {
    if (!this.playing) {
      if (this.shuttle != null) {
        this.shuttle = null
        this.emit('state')
      }
      return
    }
    this.pos = this.getTime()
    this.stopSources()
    this.playing = false
    this.shuttle = null // stopping returns to the chosen speed
    this.emit('state')
  },
  stopSources() {
    this.gen++
    clearInterval(this.timer)
    for (const s of this.sources) {
      try { s.stop() } catch { /* already done */ }
    }
    this.sources = []
  },
  async startAt(t) {
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()
    const gen = ++this.gen
    // Have the first piece in hand before the clock starts.
    const first = this.pieceAt(t)
    if (first) await this.load(first).catch(() => null)
    if (gen !== this.gen) return
    // Slaved to another clock (Edit's picture): by now it has moved on while the
    // audio was being read — start from where it is, not where it was.
    if (this.clockSource) {
      const m = this.clockSource()
      if (m != null && Math.abs(m - t) < 3) t = m
    }
    this.playing = true
    this.startT = t
    this.startCtx = ctx.currentTime + 0.03
    this.perfStart = performance.now() / 1000 + 0.03
    this.lastCtx = -1
    this.scheduledUntil = t
    this.pump()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.pump(), 120)
    this.emit('state')
  },
  // The piece of audio that plays at timeline time t: {item, t0 (in take), dur}.
  pieceAt(t) {
    const it = this.items.find((x) => t < x.start + x.dur - 1e-6)
    if (!it || t < it.start - 1e-6) return null // the end, or a gap before it
    const into = t - it.start
    const k = Math.floor(into / PIECE)
    const t0 = it.in + k * PIECE
    return { it, t0, dur: Math.min(PIECE, it.out - t0), at: it.start + k * PIECE }
  },
  load(p) {
    const key = p.it.take + '@' + p.t0.toFixed(4) + '+' + p.dur.toFixed(4) + 'x' + this.rate
    let pr = this.cache.get(key)
    if (!pr) {
      pr = api.voReadPcm(this.folder, p.it.take, p.t0, p.dur, this.rate).then(({ sr, ch, samples }) => {
        const f = new Float32Array(samples)
        const n = Math.floor(f.length / ch)
        const buf = this.ctx.createBuffer(ch, Math.max(1, n), sr)
        for (let c = 0; c < ch; c++) {
          const d = buf.getChannelData(c)
          for (let i = 0; i < n; i++) d[i] = f[i * ch + c]
        }
        return buf
      })
      this.cache.set(key, pr)
      if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value)
    }
    return pr
  },
  // Schedule whatever starts before now + AHEAD and isn't scheduled yet.
  pump() {
    if (!this.playing) return
    const now = this.getTime()
    if (now >= this.total - 1e-3) {
      this.pause()
      this.pos = this.total
      this.emit('ended')
      return
    }
    const gen = this.gen
    while (this.scheduledUntil < Math.min(this.total, now + AHEAD * this.rate) - 1e-6) {
      const p = this.pieceAt(this.scheduledUntil + 1e-6)
      if (!p) {
        // a gap (the lane isn't gapless): jump to the next clip, or the end
        const next = this.items.find((x) => x.start > this.scheduledUntil + 1e-6)
        this.scheduledUntil = next ? next.start : this.total
        continue
      }
      // Starting mid-piece (a seek): play from the playhead.
      const skip = Math.max(0, this.scheduledUntil - p.at)
      const pieceEnd = p.at + p.dur
      this.scheduledUntil = pieceEnd
      const edgeIn = Math.abs(p.at - p.it.start) < 1e-6
      const edgeOut = Math.abs(pieceEnd - (p.it.start + p.it.dur)) < 1e-6
      this.load(p).then((buf) => {
        if (gen !== this.gen || !this.playing) return
        const ctx = this.ctx
        const when = this.startCtx + (p.at + skip - this.startT) / this.rate
        const lateBy = Math.max(0, ctx.currentTime - when)
        const offset = skip / this.rate + lateBy // in the (time-stretched) buffer
        if (offset >= buf.duration) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        const g = ctx.createGain()
        src.connect(g).connect(this.master)
        const t0 = Math.max(when, ctx.currentTime)
        const len = buf.duration - offset
        const vol = p.it.gain != null ? Math.pow(10, p.it.gain / 20) : 1
        g.gain.setValueAtTime(edgeIn && offset === 0 ? 0 : vol, t0)
        if (edgeIn && offset === 0) g.gain.linearRampToValueAtTime(vol, t0 + EDGE_FADE)
        if (edgeOut) {
          g.gain.setValueAtTime(vol, t0 + Math.max(0, len - EDGE_FADE))
          g.gain.linearRampToValueAtTime(0, t0 + len)
        }
        src.start(t0, offset, len)
        this.sources.push(src)
        src.onended = () => {
          const i = this.sources.indexOf(src)
          if (i >= 0) this.sources.splice(i, 1)
        }
      }).catch(() => {})
    }
  },
  forget(take) {
    for (const k of [...this.cache.keys()]) if (k.startsWith(take + '@')) this.cache.delete(k)
  },
  // The section changed under it (a cut, a re-record): what was read for the
  // old layout is still right (pieces are keyed by take + window), nothing to drop.
  }
}

export const voPlayer = makePlayer()
export const voMix = makePlayer()
// Edit's Voiceover strip: its own little player, like a source monitor
export const voSrc = makePlayer()

if (typeof window !== 'undefined') window.__voPlayer = voPlayer // for tests (scripts/cdp.mjs)

if (typeof window !== "undefined") window.__voMix = voMix
if (typeof window !== "undefined") window.__voSrc = voSrc // for tests (scripts/cdp.mjs)
