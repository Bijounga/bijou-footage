// The voiceover as its own little timeline (in Edit's Voiceover strip), like
// the voiceover sequence you keep open next to the cut in Premiere: the real
// waveform clips of a voiceover section, laid out end to end. Scroll through
// it (wheel / drag the bar), Ctrl+wheel zooms, and grab a clip to bring it to
// the footage:
// It has its own playhead and plays on its own (voSrc), like a source
// monitor — listen before you bring a line down:
//   click / drag anywhere   move its playhead there (Space plays it while
//                           the strip has the focus — see lib/voSrcKeys.js)
//   drag a clip             onto the voiceover track in the cut
//   double-click a clip     drops it at the cut's playhead
// Clips that are on the track already are dimmed with a tick.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { fmtTime } from '../lib/time.js'
import { CLIP_LABEL_HEX } from '../lib/editModel.js'
import { ensurePeaks, peaksOf, onPeaks } from '../lib/voPeaks.js'
import { VO_MIME } from '../lib/voLane.js'
import { voSrc } from '../lib/voPlayer.js'
import { onTick, bus } from '../lib/hooks.js'

const RULER_H = 20
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

function SrcClip({ it, x, w, h, placed, said, tall, onGo, onDragStart, ver }) {
  const cv = useRef(null)
  const hex = it.clip.color ? CLIP_LABEL_HEX[it.clip.color] : null
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(1, Math.min(4000, Math.round(w)))
    c.width = Math.round(W * dpr)
    c.height = Math.round(h * dpr)
    c.style.width = '100%'
    c.style.height = h + 'px'
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, h)
    const pk = peaksOf(it.take)
    if (!pk) return
    const css = getComputedStyle(document.documentElement)
    ctx.fillStyle = hex || css.getPropertyValue('--cyan').trim() || '#4fd1c5'
    const mid = h / 2
    const half = h / 2 - 4
    const per = it.dur / W // seconds per drawn pixel
    ctx.beginPath()
    for (let px = 0; px < W; px++) {
      const a = it.in + px * per
      const i0 = Math.floor(a * 200)
      const i1 = Math.max(i0 + 1, Math.floor((a + per) * 200))
      let m = 0
      for (let i = Math.max(0, i0); i < Math.min(i1, pk.length); i++) if (pk[i] > m) m = pk[i]
      if (m < 3) continue
      const hh = Math.max(1, (m / 255) * half)
      ctx.rect(px, mid - hh, 1, hh * 2)
    }
    ctx.fill()
  }, [it, w, h, ver, hex])
  return (
    <div
      className={'vo-src-clip' + (placed ? ' placed' : '')}
      style={{ left: x, width: Math.max(3, w), '--cc': hex || 'var(--cyan)' }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => { window.__voDragLen = null }}
      onDoubleClick={onGo}
      title={(said ? said + '\n\n' : '') + fmtTime(it.dur, true) + " · click: put the playhead here · drag: onto the voiceover track · double-click: drop at the cut's playhead"}
    >
      <canvas ref={cv} />
      {w > 34 && <span className="vo-src-n">{placed ? '✓ ' : ''}{it.n}</span>}
      {tall && w > 120 && said && <span className="vo-src-said">{said}</span>}
    </div>
  )
}

export default function VoSource({ src, items, said, placedOf, folder, height: avail = 160 }) {
  const scrollRef = useRef(null)
  const [width, setWidth] = useState(600)
  const [pps, setPpsState] = useState(0) // 0 = not fitted yet
  const ppsRef = useRef(0)
  const [ver, setVer] = useState(0)
  const total = items.length ? items[items.length - 1].start + items[items.length - 1].dur : 0
  // what's left for the clips after the bar, the ruler and the scrollbar
  const height = Math.max(30, avail - RULER_H - 14)
  const tall = height > 64
  const setPps = (v) => { ppsRef.current = v; setPpsState(v) }
  const fitPps = () => Math.max(0.5, (width - 30) / Math.max(1, total))

  useEffect(() => { if (folder) ensurePeaks(folder, items.map((it) => it.take)) }, [folder, items])
  useEffect(() => onPeaks(() => setVer((v) => v + 1)), [])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // It shows the whole voiceover (and keeps doing so as the panel is resized)
  // until you zoom; Fit goes back to that. A different section starts fitted.
  useEffect(() => { setPps(0) }, [src.id])
  // its playhead, moved outside React every frame; the strip scrolls along
  // while it plays
  const headRef = useRef(null)
  const pRef = useRef(1)
  const scrubbing = useRef(false)
  useEffect(() => onTick(0, () => {
    const el = headRef.current
    const sc = scrollRef.current
    if (!el || !sc) return
    const x = Math.round(voSrc.getTime() * pRef.current)
    if (el._x !== x) {
      el._x = x
      el.style.transform = `translateX(${x}px)`
    }
    if (voSrc.playing && !scrubbing.current && (x > sc.scrollLeft + sc.clientWidth - 30 || x < sc.scrollLeft)) sc.scrollLeft = x - 40
  }), [])
  // the zoom keys (= − \) while the strip has the focus: around its playhead
  useEffect(() => bus.on('voSrcZoom', (dir) => {
    const sc = scrollRef.current
    if (!sc) return
    if (dir === 0) { setPps(0); sc.scrollLeft = 0; return }
    const cur = ppsRef.current || fitPps()
    const next = Math.max(fitPps() * 0.25, Math.min(220, cur * (dir > 0 ? 1.6 : 1 / 1.6)))
    const t = voSrc.getTime()
    const x = t * cur - sc.scrollLeft
    setPps(next)
    requestAnimationFrame(() => { sc.scrollLeft = t * next - (x >= 0 && x <= sc.clientWidth ? x : sc.clientWidth / 2) })
  }), [width, total])
  // Press anywhere (ruler, a clip, empty space): the playhead goes there;
  // drag to scrub. On a clip a drag is the clip being dragged out instead.
  function seekDown(e) {
    if (e.button !== 0 || e.target.closest('.vo-src-bar')) return
    const inner = e.currentTarget.querySelector('.vo-src-inner')
    const tAt = (ev) => Math.max(0, Math.min(voSrc.total, (ev.clientX - inner.getBoundingClientRect().left) / pRef.current))
    voSrc.seek(tAt(e))
    if (e.target.closest('.vo-src-clip')) return
    e.preventDefault()
    scrubbing.current = true
    const was = voSrc.playing
    if (was) voSrc.pause()
    const move = (ev) => voSrc.seek(tAt(ev))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      scrubbing.current = false
      if (was) voSrc.play()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // wheel scrolls sideways; Ctrl+wheel zooms at the mouse
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const cur = ppsRef.current || fitPps()
      if (e.ctrlKey || e.altKey) {
        const r = el.getBoundingClientRect()
        const x = e.clientX - r.left
        const t = (el.scrollLeft + x) / cur
        const next = Math.max(fitPps() * 0.25, Math.min(220, cur * (e.deltaY < 0 ? 1.25 : 0.8)))
        setPps(next)
        requestAnimationFrame(() => { el.scrollLeft = t * next - x })
      } else {
        el.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [width, total])

  const p = pps || fitPps()
  pRef.current = p
  const step = STEPS.find((s) => s * p >= 80) || STEPS[STEPS.length - 1]
  const ticks = []
  for (let t = 0; t <= total + step; t += step) ticks.push(t)
  return (
    <div className="vo-src">
      <div className="vo-src-bar">
        <button className="mini-btn" onClick={() => { setPps(0); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }} title="Fit the whole voiceover">Fit</button>
        <button className="mini-btn" onClick={() => setPps(Math.max(fitPps() * 0.25, p / 1.4))} title="Zoom out">−</button>
        <button className="mini-btn" onClick={() => setPps(Math.min(220, p * 1.4))} title="Zoom in">+</button>
      </div>
      <div className="vo-src-scroll" title="Click to move the playhead · scroll to look through it · Ctrl+scroll zooms" ref={scrollRef} style={{ height: height + RULER_H + 14 }} onMouseDown={seekDown}>
        <div className="vo-src-inner" style={{ width: total * p + 24, height: height + RULER_H }}>
          <div className="vo-src-ruler" style={{ height: RULER_H }}>
            {ticks.map((t) => <span key={t} className="vo-src-tick" style={{ left: t * p }}>{fmtTime(t)}</span>)}
          </div>
          <div className="vo-src-lane" style={{ top: RULER_H, height }}>
            {items.map((it) => (
              <SrcClip
                key={it.id}
                it={it}
                x={it.start * p}
                w={it.dur * p}
                h={height - 4}
                placed={placedOf(it.id)}
                said={said.get(it.id)}
                tall={tall}
                ver={ver}
                onGo={() => useStore.getState().placeVoClip(src.id, it.id, seqPlayer.getTime())}
                onDragStart={(e) => {
                  e.dataTransfer.setData(VO_MIME, JSON.stringify({ src: src.id, clip: it.id }))
                  e.dataTransfer.effectAllowed = 'copy'
                  window.__voDragLen = it.dur
                }}
              />
            ))}
          </div>
          <div className="vo-src-head" ref={headRef} />
        </div>
      </div>
    </div>
  )
}
