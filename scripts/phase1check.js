// Dev check for Phase 1 (layout / timeline / shuttle). Run via scripts/cdp.mjs.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => window.__store.getState()
  const p = window.__player
  const tl = () => window.__tl
  const ov = document.querySelector('.tl-overlay')
  const r = ov.getBoundingClientRect()
  const wheel = (opts) => ov.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 60, deltaY: 100, ...opts }))
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: extra.code || 'Key' + k.toUpperCase(), bubbles: true, ...extra }))
  const out = {}
  p.pause()
  await sleep(200)

  // wheel: pan / alt zoom / ctrl vertical scroll
  window.__footageBus && 0
  const v0 = { ...tl().view.current }
  wheel({ altKey: true, deltaY: -300 }) // zoom in
  await sleep(50)
  const v1 = { ...tl().view.current }
  wheel({}) // pan right
  await sleep(50)
  const v2 = { ...tl().view.current }
  const s0 = tl().scrollRef.current
  wheel({ ctrlKey: true, deltaY: 60 })
  await sleep(50)
  const s1 = tl().scrollRef.current
  out.wheel = {
    altZoomedIn: v1.end - v1.start < v0.end - v0.start,
    plainPanned: v2.start > v1.start && Math.abs(v2.end - v2.start - (v1.end - v1.start)) < 0.01,
    ctrlScrolledTracks: s1 > s0,
    pageZoomUnchanged: window.devicePixelRatio
  }

  // lane resize: drag the bottom edge of track 2 down 40px
  const h0 = st().settings.laneHeights[1]
  const handle = document.querySelectorAll('.th-resize')[1]
  const hr = handle.getBoundingClientRect()
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: hr.left + 20, clientY: hr.top + 2 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: hr.left + 20, clientY: hr.top + 42 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(50)
  out.laneResize = { before: h0, after: st().settings.laneHeights[1], headHeightPx: document.querySelectorAll('.track-head')[1].getBoundingClientRect().height }
  st().setLaneHeight(1, h0)

  // splitter: drag up 100px → timeline taller, video shorter
  const sp = document.querySelector('.splitter')
  const sr = sp.getBoundingClientRect()
  const vid0 = document.querySelector('.stage').getBoundingClientRect().height
  const th0 = st().settings.timelineHeight
  sp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: sr.left + 50, clientY: sr.top + 3 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: sr.left + 50, clientY: sr.top - 97 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(100)
  out.splitter = { timelineBefore: th0, timelineAfter: st().settings.timelineHeight, videoBefore: Math.round(vid0), videoAfter: Math.round(document.querySelector('.stage').getBoundingClientRect().height) }
  st().setTimelineHeight(th0)

  // shuttle: B from stopped plays at watch speed, each B speeds up, a stop returns to watch speed
  st().setWatchSpeed(1.5)
  await sleep(50)
  const seq = []
  key('b')
  await sleep(250)
  seq.push(p.rate + (p.playing ? '▶' : '■'))
  key('b')
  await sleep(250)
  seq.push(p.rate + (p.playing ? '▶' : '■'))
  key('b')
  await sleep(250)
  seq.push(p.rate + (p.playing ? '▶' : '■') + ' video=' + p.video.playbackRate)
  key(' ', { code: 'Space' })
  await sleep(300)
  seq.push(p.rate + (p.playing ? '▶' : '■') + ' video=' + p.video.playbackRate)
  key(' ', { code: 'Space' })
  await sleep(300)
  seq.push(p.rate + (p.playing ? '▶' : '■') + ' video=' + p.video.playbackRate)
  key('b')
  await sleep(250)
  seq.push(p.rate + (p.playing ? '▶' : '■'))
  key('k')
  await sleep(300)
  seq.push(p.rate + (p.playing ? '▶' : '■'))
  out.shuttle = seq.join('  →  ')
  st().setWatchSpeed(1)

  // library toggle
  key('\\', { ctrlKey: true, code: 'Backslash' })
  await sleep(150)
  const hidden = !document.querySelector('.library') && !!document.querySelector('.lib-show')
  key('\\', { ctrlKey: true, code: 'Backslash' })
  await sleep(150)
  out.libraryToggle = { hidden, shownAgain: !!document.querySelector('.library') }
  return out
})()
