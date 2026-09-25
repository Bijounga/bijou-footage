// The playback engine. Deliberately imperative and outside React: it runs
// at media-clock speed and React only needs to hear about coarse state
// changes (play/pause/rate/clip), never every frame.
//
// How multi-track audio works: every audio track gets its own hidden
// <audio> element. Once background prep has extracted a track to a small
// .m4a (electron/main/waveform.js), its element plays that; before then it
// plays the full recording with only that track enabled (Chromium demuxes
// every track but plays only enabled ones) — except track 1, which until
// then rides on the <video> element itself. Once everything is extracted
// the video element is picture-only, which is what makes seeking while
// playing resume fastest. Every element feeds its own GainNode
// (volume/mute/solo) and AnalyserNode (meters), mixed into one master gain,
// and is slaved to the video clock with small playbackRate nudges, or a
// hard re-seek if it ever drifts far.
//
// Muted / empty tracks don't get an element playing at all, so they cost
// nothing — no extra disk reads or decoding.

// Shuttle steps (B/L up, J down). Up to 10× is real playback — measured
// smooth on 1440p60 at up to ~118 Mbps (the GPU decoder keeps pace, audio
// keeps playing, pitch-corrected). Beyond that, and in reverse, we skim.
export const RATE_LADDER = [-64, -32, -16, -8, -4, -2, 1, 1.5, 2, 3, 4, 6, 8, 10, 16, 32, 64]
export const WATCH_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10]
const NATIVE_MAX = 10 // above this (or reversed) we "skim" by seeking instead of playing
// Longest the main video's exact seek waits for the ghost's keyframe to
// land first. Exact seeks in 1440p OBS footage take 250-900ms; a keyframe
// ~20-40ms, so this barely delays the exact frame.
const MAIN_DEFER = 40

export function mediaUrl(path) {
  return 'footage://media/' + encodeURIComponent(path)
}

class Player {
  constructor() {
    this.video = null
    this.ctx = null
    this.master = null
    this.chains = [] // index = track index; { el, source, gain, analyser, active, ready }
    this.clip = null
    this.listeners = {}
    this.mixer = [] // [{vol, mute}]
    this.solo = new Set()
    this.masterVol = 1
    this.rate = 1
    this.skim = null
    this.syncTimer = null
    this.levelBuf = new Float32Array(1024)
    this.audioFiles = {} // trackIndex -> extracted .m4a path (see electron/main/waveform.js)
    // The "ghost": a second, silent <video> stacked over the main one. It
    // only ever seeks — to keyframes while moving (one-frame decode, ~100ms)
    // and to the exact frame once the pointer rests. It covers the main
    // video while that does the slow exact seek, powers hover thumbnails,
    // scrubbing and skimming. See seek() / scrubTo() / startSkim().
    this.ghost = null
    this.ghostBusy = false
    this.ghostPending = null
    this.ghostBusyTimer = null
    this.ghostRestTimer = null
    this.ghostShown = false
    this.covering = null // {id, t} while the ghost is standing in for a main-video seek
    this.coverSeq = 0
    this.scrub = null
    this.instantSeek = true // settings: "Instant seeks while playing"
    this.baseRate = 1 // settings: watch speed
    this.shuttling = false
  }

  on(evt, fn) {
    ;(this.listeners[evt] ||= new Set()).add(fn)
    return () => this.listeners[evt].delete(fn)
  }

  emit(evt, payload) {
    const set = this.listeners[evt]
    if (set) set.forEach((fn) => fn(payload))
  }

  ensureContext() {
    if (this.ctx) return
    // 'interactive' = smallest output buffer; 'playback' added ~70ms before
    // you'd hear anything after a seek or play.
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.gain.value = this.masterVol
    this.master.connect(this.ctx.destination)
  }

  makeChain(el) {
    this.ensureContext()
    const source = this.ctx.createMediaElementSource(el)
    const gain = this.ctx.createGain()
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(this.master)
    return { el, source, gain, analyser, active: false, ready: false }
  }

  attach(video) {
    if (this.video === video) return
    // Review's player is rebuilt each time you come back from Edit: where
    // was the recording on the old element (or where was it asked to go)?
    const prev = this.video
    const resumeAt = this.clip ? (this.wantAt != null ? this.wantAt : prev && prev.readyState >= 1 ? prev.currentTime : null) : null
    this.video = video
    video.preload = 'auto'
    // Track 1 plays from the video element itself only until its extracted
    // .m4a exists; after that the video is picture-only and every track is
    // an <audio> chain in this.chains.
    this.videoChain = this.makeChain(video)
    this.videoChain.active = true
    const v = video
    v.addEventListener('play', () => { this.ctx.resume(); this.syncAll(true); this.startSync(); this.emitState() })
    v.addEventListener('playing', () => this.syncAll(true))
    v.addEventListener('pause', () => {
      this.pauseAudio()
      this.savePosition()
      this.stopSync()
      // A real stop (not the pause that starts a skim or a timeline drag)
      // ends any shuttle: back to the watch speed.
      if (!this.skim && !this.scrub) this.endShuttle()
      this.emitState()
    })
    v.addEventListener('waiting', () => this.pauseAudio())
    v.addEventListener('seeking', () => {
      // Extracted .m4a tracks seek almost for free, so do it now. Tracks
      // still reading the full video file wait until the video's own seek is
      // done — seeking them in parallel was measured to make the video seek
      // itself 2-3× slower (they all compete for the same disk reads).
      for (const c of this.chains) {
        if (!c) continue
        if (c.extracted) this.syncOne(c, false)
        else c.el.pause()
      }
    })
    v.addEventListener('seeked', () => {
      this.wantAt = null
      this.syncAll(!v.paused)
      this.uncover()
      this.emit('seeked')
    })
    v.addEventListener('ratechange', () => this.syncAll(!v.paused))
    v.addEventListener('ended', () => { this.savePosition(); this.emitState(); this.emit('ended') })
    v.addEventListener('loadedmetadata', () => {
      this.updateVideoAudio()
      this.emitState()
    })
    v.addEventListener('error', () => this.emit('error', v.error ? v.error.message || 'Playback error ' + v.error.code : 'Playback error'))
    if (this.pendingLoad) {
      const p = this.pendingLoad
      this.pendingLoad = null
      this.load(p.clip, p.startAt)
    } else if (this.clip && resumeAt != null) {
      // … and carry on from there on the new element.
      this.load(this.clip, resumeAt)
    }
  }

  get trackCount() {
    return this.clip && this.clip.probe ? Math.max(1, this.clip.probe.audio.length) : 1
  }

  get fps() {
    return (this.clip && this.clip.probe && this.clip.probe.fps) || 60
  }

  get duration() {
    return (this.video && isFinite(this.video.duration) && this.video.duration) || (this.clip && this.clip.probe && this.clip.probe.duration) || 0
  }

  get playing() {
    return !!this.skim || (this.video && !this.video.paused && !this.video.ended)
  }

  getTime() {
    if (this.scrub) return this.scrub.t
    if (this.skim) return this.skim.target
    if (this.pendingMain != null) return this.pendingMain
    return this.video ? this.video.currentTime : 0
  }

  load(clip, startAt = 0) {
    // Remember where this load is headed until the video gets there (a
    // re-attach mid-load resumes here, not at 0).
    this.wantAt = startAt
    this.stopSkim()
    this.savePosition() // where we were in the recording we're leaving
    this.scrub = null
    this.clip = clip
    this.rate = this.baseRate
    this.shuttling = false
    this.audioFiles = {}
    this.covering = null
    this.pendingMain = null
    clearTimeout(this.pendingMainTimer)
    this.showGhost(false)
    if (this.ghost) {
      this.ghostBusy = false
      this.ghostPending = null
      this.ghost.src = mediaUrl(clip.path)
    }
    for (const c of this.chains) {
      if (!c) continue
      c.el.pause()
      c.el.removeAttribute('src')
      c.el.load()
      c.active = false
      c.ready = false
    }
    const v = this.video
    // Not on screen yet (the app opened in Edit): load when Review's video
    // element attaches.
    if (!v) {
      this.pendingLoad = { clip, startAt }
      return
    }
    v.playbackRate = this.baseRate
    v.src = mediaUrl(clip.path)
    if (startAt > 0) {
      const onMeta = () => {
        v.removeEventListener('loadedmetadata', onMeta)
        v.currentTime = Math.min(startAt, Math.max(0, v.duration - 1))
      }
      v.addEventListener('loadedmetadata', onMeta)
    }
    // The caller (store.openClip) pushes this clip's mixer right after —
    // applying the previous clip's mixer here would briefly spin up tracks
    // that are auto-muted as empty in this one.
    this.emitState()
  }

  unload() {
    this.savePosition()
    this.stopSkim()
    this.clip = null
    if (this.video) {
      this.video.pause()
      this.video.removeAttribute('src')
      this.video.load()
    }
    this.chains.forEach((c) => c && (c.el.pause(), c.el.removeAttribute('src'), c.el.load(), (c.active = false)))
    this.emitState()
  }

  // Video element decodes audio (track 1) only while track 1 has no
  // extracted file of its own. Picture-only resumes faster after a seek.
  updateVideoAudio() {
    const v = this.video
    if (!v || !v.audioTracks || !v.audioTracks.length) return
    const want = !this.audioFiles[0]
    Array.from(v.audioTracks).forEach((t, i) => {
      const on = want && i === 0
      if (t.enabled !== on) t.enabled = on
    })
  }

  // ---- mixer ----

  setMixer(mixer, solo, masterVol) {
    this.mixer = mixer
    this.solo = solo
    if (masterVol != null) this.masterVol = masterVol
    this.applyMixer()
  }

  effectiveGain(i) {
    const m = this.mixer[i] || { vol: 1, mute: false }
    if (this.solo.size) return this.solo.has(i) ? m.vol : 0
    return m.mute ? 0 : m.vol
  }

  applyMixer() {
    if (!this.video) return // Review isn't on screen yet; applied when it attaches
    if (!this.ctx) this.ensureContext()
    if (this.master) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.015)
    const n = this.trackCount
    const track0OnVideo = !this.audioFiles[0]
    this.updateVideoAudio()
    for (let i = 0; i < n; i++) {
      const g = this.effectiveGain(i)
      if (i === 0) {
        this.videoChain.gain.gain.setTargetAtTime(track0OnVideo ? g : 0, this.ctx.currentTime, 0.015)
        if (track0OnVideo) {
          if (this.chains[0] && this.chains[0].active) {
            this.chains[0].active = false
            this.chains[0].el.pause()
          }
          continue
        }
      }
      if (g > 0 && this.clip) {
        const c = this.ensureTrack(i)
        c.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.015)
        if (!c.active) {
          c.active = true
          this.syncOne(c, this.playing && !this.skim)
        }
      } else if (this.chains[i] && this.chains[i].active) {
        const c = this.chains[i]
        c.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015)
        c.active = false
        c.el.pause()
      }
    }
  }

  ensureTrack(i) {
    let c = this.chains[i]
    if (!c) {
      const el = document.createElement('audio')
      el.preload = 'auto'
      el.preservesPitch = true
      c = this.chains[i] = this.makeChain(el)
    }
    const extracted = this.audioFiles[i]
    const url = mediaUrl(extracted || this.clip.path)
    if (c.el.getAttribute('src') !== url) {
      c.ready = false
      c.extracted = !!extracted
      c.el.src = url
      const onMeta = () => {
        c.el.removeEventListener('loadedmetadata', onMeta)
        // The full recording has every track; pick ours. An extracted .m4a
        // only has the one.
        if (!extracted && c.el.audioTracks) Array.from(c.el.audioTracks).forEach((t, j) => (t.enabled = j === i))
        c.ready = true
        this.syncOne(c, this.playing && !this.skim && !this.scrub)
      }
      c.el.addEventListener('loadedmetadata', onMeta)
    }
    return c
  }

  // Called when background prep finishes extracting this clip's tracks:
  // any track still reading the big video file (or riding on the video
  // element, for track 1) switches to its small .m4a — a brief blip on that
  // one track, once per clip.
  setAudioFiles(key, files) {
    if (!this.clip || this.clip.key !== key) return
    this.audioFiles = files || {}
    this.applyMixer()
  }

  // ---- sync ----

  syncOne(c, play) {
    if (!c.active || !c.ready || !this.video) return
    c.el.playbackRate = this.video.playbackRate
    if (Math.abs(c.el.currentTime - this.video.currentTime) > 0.02) c.el.currentTime = this.video.currentTime
    if (play && !this.video.paused && this.video.readyState >= 3) c.el.play().catch(() => {})
    else c.el.pause()
  }

  syncAll(play) {
    for (let i = 0; i < this.chains.length; i++) if (this.chains[i]) this.syncOne(this.chains[i], play)
  }

  pauseAudio() {
    for (let i = 0; i < this.chains.length; i++) if (this.chains[i]) this.chains[i].el.pause()
  }

  startSync() {
    this.stopSync()
    this.syncTimer = setInterval(() => {
      const v = this.video
      if (!v || v.paused || v.seeking) return
      for (let i = 0; i < this.chains.length; i++) {
        const c = this.chains[i]
        if (!c || !c.active || !c.ready || c.el.seeking) continue
        if (c.el.paused && v.readyState >= 3) { this.syncOne(c, true); continue }
        const drift = c.el.currentTime - v.currentTime
        if (Math.abs(drift) > 0.25) c.el.currentTime = v.currentTime
        else if (Math.abs(drift) > 0.02) c.el.playbackRate = v.playbackRate * (1 - Math.max(-0.05, Math.min(0.05, drift * 0.5)))
        else if (c.el.playbackRate !== v.playbackRate) c.el.playbackRate = v.playbackRate
      }
    }, 200)
  }

  stopSync() {
    clearInterval(this.syncTimer)
    this.syncTimer = null
  }

  // ---- transport ----

  play() {
    if (!this.video || !this.clip) return
    if (this.skim) return
    this.ensureContext()
    this.ctx.resume()
    if (!this.shuttling && this.video.playbackRate !== this.baseRate) this.video.playbackRate = this.rate = this.baseRate
    if (this.video.ended) this.video.currentTime = 0
    this.video.play().catch(() => {})
  }

  pause() {
    if (this.skim) {
      this.stopSkim()
      this.endShuttle()
      return
    }
    if (this.video) this.video.pause()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  // ---- speed: watch speed + shuttle ----
  // baseRate is the user's chosen watch speed (0.5×–10×). Shuttling (B/L
  // faster, J slower/reverse) steps away from it; the moment playback stops
  // for any reason, speed snaps back to the watch speed — like Premiere.

  setBaseRate(r) {
    this.baseRate = r
    if (!this.shuttling) {
      this.rate = r
      if (this.video && !this.skim) this.video.playbackRate = r
      this.emitState()
    }
  }

  endShuttle() {
    if (!this.shuttling && this.rate === this.baseRate) return
    this.shuttling = false
    this.rate = this.baseRate
    if (this.video) this.video.playbackRate = this.baseRate
    this.emitState()
  }

  // opts.dir: +1/-1 for relative jumps (arrow keys), so an instant seek
  // always moves the way you asked even when snapping to a keyframe.
  // opts.resume: treat as playing (a drag that paused playback and will
  // resume it right after). opts.exact: always frame-exact, even while playing.
  seek(t, opts = {}) {
    if (!this.video) return
    t = Math.max(0, Math.min(this.duration || t, t))
    if (this.skim) {
      this.skim.target = t
      this.ghostSeek(t, false)
      this.emit('seek', t)
      return
    }
    // Instant seek while playing: an exact seek has to decode every frame
    // from the previous keyframe (up to 250 frames, 200-900ms before the
    // picture moves again). Landing ON a keyframe is a one-frame decode, so
    // playback carries on immediately. Paused seeks stay frame-exact.
    const kt = !opts.exact && this.instantSeek && (this.playing || opts.resume) && !this.scrub ? this.keyframeFor(t, opts.dir) : null
    if (kt != null) {
      this.pendingMain = null
      clearTimeout(this.pendingMainTimer)
      this.covering = null
      this.showGhost(false)
      this.video.currentTime = kt
      this.emit('seek', kt)
      return
    }
    if (this.cover(t)) {
      // Give the ghost's one-frame keyframe decode a head start: started
      // together, the main video's exact seek competes with it for the
      // decoder and the first picture arrives ~2× later. The main seek
      // starts as soon as the ghost frame is up (or MAIN_DEFER at most).
      this.pendingMain = t
      clearTimeout(this.pendingMainTimer)
      this.pendingMainTimer = setTimeout(() => this.applyPendingMain(), MAIN_DEFER)
    } else {
      this.video.currentTime = t
    }
    this.emit('seek', t)
  }

  applyPendingMain() {
    clearTimeout(this.pendingMainTimer)
    if (this.pendingMain == null) return
    const t = this.pendingMain
    this.pendingMain = null
    this.video.currentTime = t
  }

  // ---- ghost (instant-feedback second decoder) ----

  attachGhost(el) {
    if (this.ghost === el) return
    this.ghost = el
    el.muted = true
    el.preload = 'auto'
    // It only ever shows pictures — don't make it demux/decode audio too.
    el.addEventListener('loadedmetadata', () => {
      if (el.audioTracks) Array.from(el.audioTracks).forEach((t) => (t.enabled = false))
    })
    el.addEventListener('seeked', () => this.onGhostSeeked())
    if (this.clip) el.src = mediaUrl(this.clip.path)
  }

  // Keyframe to start instant playback from, or null (no keyframe info).
  // Clicks: the keyframe at-or-before t, so you see the moment you clicked
  // (starting at most one keyframe interval early). Relative jumps: the
  // nearest keyframe, but never one that fails to move in `dir`.
  keyframeFor(t, dir) {
    const kf = this.clip && this.clip.probe && this.clip.probe.keyframes
    if (!kf) return null
    const list = kf.times
    const at = (i) => (list ? list[i] : kf.phase + i * kf.interval)
    const count = list ? list.length : Math.floor((this.duration - kf.phase) / kf.interval) + 1
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (at(mid) <= t + 0.0005) lo = mid
      else hi = mid - 1
    }
    let i = lo // last keyframe <= t
    if (dir) {
      if (i + 1 < count && Math.abs(at(i + 1) - t) < Math.abs(at(i) - t)) i++
      const cur = this.video.currentTime
      if (dir > 0) while (i + 1 < count && at(i) <= cur + 0.05) i++
      else while (i > 0 && at(i) >= cur - 0.05) i--
    }
    return Math.max(0, Math.min(this.duration - 0.05, at(i) + 0.001))
  }

  // Nearest keyframe to t: the exact list from the file's index when we have
  // it, else the periodic estimate (MKV). Without either, no snapping.
  snapToKeyframe(t) {
    const kf = this.clip && this.clip.probe && this.clip.probe.keyframes
    if (!kf) return t
    let k
    if (kf.times) {
      const a = kf.times
      let lo = 0
      let hi = a.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (a[mid] < t) lo = mid + 1
        else hi = mid
      }
      k = lo > 0 && Math.abs(a[lo - 1] - t) < Math.abs(a[lo] - t) ? a[lo - 1] : a[lo]
    } else {
      k = kf.phase + Math.round((t - kf.phase) / kf.interval) * kf.interval
    }
    // +1ms so float rounding can't land just before the keyframe (which
    // would decode the whole previous group instead of one frame).
    return Math.max(0, Math.min(this.duration - 0.05, k + 0.001))
  }

  // precise=false: snap to a keyframe (fast). A request made while a seek is
  // in flight replaces any older pending one — only the latest matters.
  // urgent=true interrupts whatever the ghost is doing (a new seek replaces
  // an in-flight one) — used when the user actually clicks/seeks, so it
  // never waits behind a slow exact-frame hover decode.
  ghostSeek(t, precise, urgent = false) {
    const g = this.ghost
    if (!g || !g.getAttribute('src') || g.readyState < 1) return
    const target = precise ? t : this.snapToKeyframe(t)
    if (urgent) this.ghostPending = null
    else if (this.ghostBusy) {
      this.ghostPending = { t, precise }
      return
    }
    if (Math.abs(g.currentTime - target) < 0.004 && g.readyState >= 2) {
      this.onGhostSeeked()
      return
    }
    this.ghostBusy = true
    g.currentTime = target
    clearTimeout(this.ghostBusyTimer)
    this.ghostBusyTimer = setTimeout(() => { this.ghostBusy = false }, 1500) // never wedge on a dropped seek
  }

  onGhostSeeked() {
    this.ghostBusy = false
    clearTimeout(this.ghostBusyTimer)
    const g = this.ghost
    this.emit('ghostFrame', g.currentTime)
    if (this.scrub || this.skim) this.showGhost(true)
    else if (this.covering && (this.pendingMain != null || this.video.seeking)) this.showGhost(true)
    this.applyPendingMain()
    if (this.ghostPending) {
      const p = this.ghostPending
      this.ghostPending = null
      this.ghostSeek(p.t, p.precise)
    }
  }

  // Hover thumbnails: keyframes while the pointer moves, the exact frame
  // once it rests — which also means a click right after hovering can show
  // that exact frame instantly.
  hoverPreview(t) {
    if (this.ghostShown || this.scrub || this.skim) return
    this.ghostSeek(t, false)
    clearTimeout(this.ghostRestTimer)
    this.ghostRestTimer = setTimeout(() => {
      if (!this.ghostShown && !this.scrub && !this.skim) this.ghostSeek(t, true)
    }, 110)
  }

  showGhost(on) {
    if (!this.ghost || this.ghostShown === on) return
    this.ghostShown = on
    this.ghost.style.opacity = on ? '1' : '0'
  }

  // Stand the ghost in for the main video while it does a slow exact seek.
  // If the ghost already holds this exact frame (the user hovered here
  // first), show it immediately; otherwise fetch the nearest keyframe and
  // show that if the main seek is still going after COVER_DELAY — a seek
  // that's genuinely quick never flashes an in-between frame.
  // Returns true if the ghost is fetching a keyframe (so the caller should
  // briefly defer the main seek), false if there's nothing to wait for.
  cover(t) {
    const g = this.ghost
    if (!g || !g.getAttribute('src') || g.readyState < 1) return false
    this.covering = { id: ++this.coverSeq, t }
    if (!this.ghostBusy && g.readyState >= 2 && Math.abs(g.currentTime - t) < 0.5 / this.fps) {
      this.showGhost(true)
      return false
    }
    // (If the ghost is already showing — e.g. right after a scrub — it stays
    // up with its nearby frame rather than flashing the old main frame.)
    this.ghostSeek(t, false, true)
    return true
  }

  // Main video finished seeking: hide the ghost once the main video has
  // actually put the new frame on screen (not just decoded it), so there's
  // never a flash of the old frame in between.
  uncover() {
    const c = this.covering
    if (!c || this.scrub || this.skim) return
    const done = () => {
      if (this.covering !== c || this.video.seeking) return
      this.covering = null
      this.showGhost(false)
    }
    if (!this.ghostShown) return done()
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(done)
    setTimeout(done, 250) // fallback if no new frame gets presented
  }

  // ---- scrubbing (dragging on the timeline) ----
  // The main video doesn't seek at all while dragging — only the ghost
  // does, snapping to keyframes, so the picture keeps up with the mouse.
  // Releasing does one exact seek, covered by the ghost until it lands.

  scrubStart(t) {
    if (!this.clip) return
    const wasPlaying = this.playing && !this.skim
    if (this.skim) { this.stopSkim(); this.endShuttle() }
    if (wasPlaying) this.video.pause()
    this.scrub = { t: this.getTime(), wasPlaying }
    if (t != null) this.scrubTo(t)
  }

  scrubTo(t) {
    if (!this.scrub) return
    t = Math.max(0, Math.min(this.duration, t))
    this.scrub.t = t
    this.ghostSeek(t, false)
    this.emit('scrub', t) // e.g. the transcript follows along while you drag
    clearTimeout(this.ghostRestTimer)
    this.ghostRestTimer = setTimeout(() => this.scrub && this.ghostSeek(this.scrub.t, true), 120)
  }

  scrubEnd() {
    const s = this.scrub
    if (!s) return
    clearTimeout(this.ghostRestTimer)
    this.scrub = null
    // Was playing before the drag: resume instantly from the keyframe.
    this.seek(s.t, { resume: s.wasPlaying })
    if (s.wasPlaying) this.play()
  }

  nudge(dt) {
    this.seek(this.getTime() + dt, { dir: Math.sign(dt) })
  }

  step(frames) {
    this.pause()
    this.seek(this.getTime() + frames / this.fps)
  }

  setRate(r) {
    this.rate = r
    if (r > NATIVE_MAX || r < 0) {
      this.startSkim(r)
    } else {
      const wasSkimming = !!this.skim
      this.stopSkim()
      this.video.playbackRate = r
      if (wasSkimming) this.play()
    }
    this.emitState()
  }

  // Shuttle forward (B / L). From stopped: start playing at the watch
  // speed. While playing: step up to the next speed on the ladder.
  faster() {
    if (!this.clip) return
    if (!this.playing) {
      this.shuttling = false
      this.setRate(this.baseRate)
      this.play()
      this.shuttling = true
      return
    }
    this.shuttling = true
    const next = RATE_LADDER.find((r) => r > this.rate + 1e-9)
    if (next != null) this.setRate(next)
  }

  // Shuttle back (J): step down the ladder, through 1× into reverse skim.
  // From stopped: start reversing.
  slower() {
    if (!this.clip) return
    this.shuttling = true
    if (!this.playing) {
      this.setRate(-2)
      return
    }
    const prev = [...RATE_LADDER].reverse().find((r) => r < this.rate - 1e-9)
    if (prev == null) return
    this.setRate(prev)
    if (prev > 0 && !this.playing) this.play()
  }

  // Skimming: for fast-forward past 4× (and any reverse), actually decoding
  // every frame would choke on 1440p60, so instead the main video pauses and
  // the ghost hops from keyframe to keyframe on a timer (one-frame decodes,
  // so it keeps up). Stopping does one exact seek of the main video.
  startSkim(rate) {
    const v = this.video
    if (!v) return
    if (!this.skim) {
      v.pause()
      this.pauseAudio()
      this.skim = { rate, target: v.currentTime, last: performance.now(), timer: null }
      const tick = () => {
        const s = this.skim
        if (!s) return
        const now = performance.now()
        s.target += s.rate * ((now - s.last) / 1000)
        s.last = now
        if (s.target <= 0 || s.target >= this.duration) {
          s.target = Math.max(0, Math.min(this.duration, s.target))
          this.stopSkim()
          this.endShuttle()
          return
        }
        if (this.ghost) this.ghostSeek(s.target, false)
        else if (!v.seeking) v.currentTime = s.target
        s.timer = setTimeout(tick, 40)
      }
      this.skim.timer = setTimeout(tick, 0)
    } else {
      this.skim.rate = rate
    }
  }

  stopSkim() {
    if (!this.skim) return
    clearTimeout(this.skim.timer)
    const t = this.skim.target
    this.skim = null
    if (!this.video) return
    if (Math.abs(this.video.currentTime - t) > 0.02) {
      this.video.currentTime = t
      this.cover(t)
    } else this.showGhost(false)
  }

  // Resume-where-you-left-off: the store saves this per recording. Called
  // at natural stop points (pause, end, switching recordings, closing) —
  // not continuously while playing.
  savePosition() {
    if (this.clip && this.video) this.emit('position', { key: this.clip.key, t: this.getTime() })
  }

  // ---- meters ----

  levels() {
    const out = []
    for (let i = 0; i < this.trackCount; i++) {
      const c = i === 0 && !this.audioFiles[0] ? this.videoChain : this.chains[i]
      if (!c || !c.active || !this.playing || this.skim) {
        out.push(0)
        continue
      }
      c.analyser.getFloatTimeDomainData(this.levelBuf)
      let peak = 0
      for (let k = 0; k < this.levelBuf.length; k++) {
        const a = Math.abs(this.levelBuf[k])
        if (a > peak) peak = a
      }
      out.push(peak)
    }
    return out
  }

  emitState() {
    this.emit('state', { playing: this.playing, rate: this.rate, baseRate: this.baseRate, shuttling: this.shuttling, skimming: !!this.skim })
  }
}

export const player = new Player()
if (typeof window !== 'undefined') window.__player = player
