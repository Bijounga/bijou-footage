// Dev: find what makes in-app playing seeks slower than a bare <video>.
(async () => {
  const p = window.__player
  const v = p.video
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const points = [300.5, 911.2, 1500.9, 1203.3, 1800.1, 608.1]
  const moving = (t) =>
    new Promise((res) => {
      const t0 = performance.now()
      let last = -1
      let n = 0
      const cb = (now, meta) => {
        if (meta.mediaTime > last && last >= t - 0.01) n++
        last = meta.mediaTime
        if (n >= 2) res(Math.round(performance.now() - t0))
        else v.requestVideoFrameCallback(cb)
      }
      v.currentTime = t
      v.requestVideoFrameCallback(cb)
    })
  const run = async (label) => {
    p.play()
    await sleep(1200)
    const out = []
    for (const s of points) {
      out.push(await moving(p.keyframeFor(s)))
      await sleep(700)
    }
    p.pause()
    await sleep(300)
    return label + ': ' + out.join(' ')
  }
  const res = []
  res.push(await run('as-is             '))
  const ghostSrc = p.ghost.getAttribute('src')
  p.ghost.removeAttribute('src'); p.ghost.load()
  res.push(await run('ghost unloaded    '))
  const saved = p.chains.slice(1).map((c) => c && c.el.getAttribute('src'))
  p.chains.slice(1).forEach((c) => c && (c.el.pause(), c.el.removeAttribute('src'), c.el.load()))
  res.push(await run('+ extra tracks off'))
  if (v.audioTracks) Array.from(v.audioTracks).forEach((t) => (t.enabled = false))
  res.push(await run('+ video audio off '))
  // restore
  if (v.audioTracks) Array.from(v.audioTracks).forEach((t, i) => (t.enabled = i === 0))
  p.ghost.src = ghostSrc
  p.chains.slice(1).forEach((c, i) => c && saved[i] && (c.el.src = saved[i]))
  return res
})()
