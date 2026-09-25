// Dev benchmark, run via: node scripts/cdp.mjs eval "$(cat scripts/seekbench.js)"
// "visible" = time until the screen shows the new position (ghost frame or
// main frame, whichever first); "exact" = time until the main video has the
// exact frame.
(async () => {
  const p = window.__player
  const v = p.video
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const measure = (t) =>
    new Promise((resolve) => {
      const t0 = performance.now()
      let visible = null
      let exact = null
      v.addEventListener('seeked', () => { exact = performance.now() - t0 }, { once: true })
      const poll = () => {
        if (visible == null && (p.ghostShown || exact != null)) visible = performance.now() - t0
        if (exact != null && !p.ghostShown) return resolve({ visible: Math.round(visible), exact: Math.round(exact) })
        requestAnimationFrame(poll)
      }
      p.seek(t)
      requestAnimationFrame(poll)
    })
  const points = [300.5, 911.2, 1500.9, 1203.3, 1800.1, 608.1, 1111.1, 222.2]
  const out = { cold: [], afterHover: [], playing: [] }
  for (const t of points) { out.cold.push(await measure(t)); await sleep(300) }
  for (const t of points) { p.hoverPreview(t + 7); await sleep(400); out.afterHover.push(await measure(t + 7)); await sleep(300) }
  p.play(); await sleep(800)
  for (const t of points.slice(0, 5)) { out.playing.push(await measure(t + 13)); await sleep(700) }
  p.pause()
  const fmt = (arr) => arr.map((x) => x.visible + '/' + x.exact).join('  ')
  return { 'cold (visible/exact ms)': fmt(out.cold), 'after hover': fmt(out.afterHover), 'while playing': fmt(out.playing) }
})()
