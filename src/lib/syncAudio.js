// The line-up window's sound, track by track (PovSync.jsx). Each side plays
// every one of its audio tracks from the small .m4a files background prep
// extracted (a <video> only plays its first track), each through its own
// gain — so tracks can be muted and soloed to check the sync by ear (your
// Discord against theirs, say). The tracks follow their side's picture.
// Before those files exist, the side's video plays its own first track.
export function makeSideAudio(ctx) {
  let els = [] // [{el, gain}] by track
  let video = null
  let timer = 0
  let alive = true

  const follow = () => {
    if (!video) return
    const t = video.currentTime
    const playing = !video.paused && !video.seeking && video.readyState >= 3
    for (const c of els) {
      if (!c) continue
      const el = c.el
      if (!playing) {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - t) > 0.05 && !el.seeking) el.currentTime = t
        continue
      }
      el.playbackRate = video.playbackRate
      if (el.paused) {
        el.currentTime = t
        el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - t) > 0.12) el.currentTime = t
    }
  }

  return {
    // files: {trackIndex: path} (from window.footage.audioFiles)
    attach(videoEl, files) {
      video = videoEl
      for (const [i, file] of Object.entries(files || {})) {
        const el = new Audio()
        el.preload = 'auto'
        el.src = 'footage://media/' + encodeURIComponent(file)
        const gain = ctx.createGain()
        ctx.createMediaElementSource(el).connect(gain)
        gain.connect(ctx.destination)
        els[+i] = { el, gain }
      }
      if (els.some(Boolean) && video) video.muted = true
      clearInterval(timer)
      timer = setInterval(() => alive && follow(), 100)
      if (video) {
        video.addEventListener('play', follow)
        video.addEventListener('pause', follow)
        video.addEventListener('seeked', follow)
      }
      return els.some(Boolean)
    },
    // gainOf(i) → 0 / 1 for each track
    mix(gainOf) {
      els.forEach((c, i) => { if (c) c.gain.gain.setTargetAtTime(gainOf(i), ctx.currentTime, 0.015) })
    },
    hasTracks: () => els.some(Boolean),
    gains: () => els.map((c) => (c ? Math.round(c.gain.gain.value * 100) / 100 : null)),
    playing: () => els.filter((c) => c && !c.el.paused).length,
    stop() {
      alive = false
      clearInterval(timer)
      if (video) {
        video.removeEventListener('play', follow)
        video.removeEventListener('pause', follow)
        video.removeEventListener('seeked', follow)
      }
      for (const c of els) if (c) { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.gain.disconnect() }
      els = []
    }
  }
}
