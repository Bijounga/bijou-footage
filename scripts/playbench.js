// Dev benchmark: while playing, how long from a seek until the picture is
// actually MOVING again and each audio track is actually PLAYING again.
// Run: node scripts/cdp.mjs eval "$(cat scripts/playbench.js)"
(async () => {
  const p = window.__player
  const v = p.video
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const measure = (t) =>
    new Promise((resolve) => {
      const t0 = performance.now()
      let firstFrame = null
      let moving = null
      const audio = {}
      let frameTimes = []
      const onFrame = (now, meta) => {
        frameTimes.push(meta.mediaTime)
        if (firstFrame == null) firstFrame = performance.now() - t0
        // "moving" = two consecutive new frames with advancing media time
        if (moving == null && frameTimes.length >= 2 && frameTimes[frameTimes.length - 1] > frameTimes[frameTimes.length - 2] && !v.seeking && p.pendingMain == null) moving = performance.now() - t0
        if (moving == null) v.requestVideoFrameCallback(onFrame)
      }
      const startT = {}
      p.chains.forEach((c, i) => c && c.active && (startT[i] = null))
      const poll = () => {
        const el = performance.now() - t0
        // Track 1 plays inside the video element, so it moves when the
        // picture moves. Extra tracks: playing, at the NEW position (near
        // the video's time), and advancing.
        if (moving != null && audio[0] == null) audio[0] = Math.round(moving)
        p.chains.forEach((c, i) => {
          if (i === 0 || !c || !c.active || audio[i] != null) return
          const cur = c.el.currentTime
          const atNewSpot = !v.seeking && p.pendingMain == null && Math.abs(cur - v.currentTime) < 0.3
          if (!c.el.paused && !c.el.seeking && c.el.readyState >= 3 && atNewSpot) {
            if (startT[i] == null) startT[i] = cur
            else if (cur > startT[i] + 0.001) audio[i] = Math.round(el)
          }
        })
        const allAudio = p.chains.every((c, i) => !c || !c.active || audio[i] != null)
        if ((moving != null && allAudio) || el > 3000) return resolve({ picture: Math.round(firstFrame), moving: Math.round(moving), audio })
        requestAnimationFrame(poll)
      }
      p.seek(t)
      v.requestVideoFrameCallback(onFrame)
      requestAnimationFrame(poll)
    })
  p.play()
  await sleep(1500)
  const out = []
  for (const t of [300.5, 911.2, 1500.9, 1203.3, 1800.1, 608.1, 1111.1, 222.2]) {
    out.push(await measure(t))
    await sleep(900)
  }
  p.pause()
  return {
    audioLatencyMs: Math.round(((p.ctx.baseLatency || 0) + (p.ctx.outputLatency || 0)) * 1000),
    rows: out.map((r) => `picture ${r.picture} | moving ${r.moving} | audio ${Object.entries(r.audio).map(([i, ms]) => 't' + (+i + 1) + ':' + ms).join(' ')}`)
  }
})()
