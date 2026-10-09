// The viewer: a second window with just the picture, to put on another
// monitor and make as big as you like (Review and Edit).
//
// It doesn't play the file itself — two decoders would drift apart, and
// Edit's cuts swap between two decks. Instead it copies whatever the main
// player is showing onto a canvas, once per frame of its own monitor: the
// main video, Review's "ghost" (instant seeks, hover previews, skims) or
// Edit's active deck. Frame-exact, and nothing to keep in sync.
//
// The window is opened with window.open (same page, so the canvas can
// draw the main window's video elements); the main process gives it its
// size / place from last time (electron/main/index.js, 'bijou-viewer').
// Keys pressed in it go to the main window, so Space, J/K/L… still work.
import { player } from './player.js'
import { seqPlayer } from './seqPlayer.js'
import { bus } from './hooks.js'
import { useStore } from '../state/store.js'
import { isFramed } from './editModel.js'

const workspace = () => useStore.getState().settings.workspace || 'review'
// The framing of the edit clip on screen (or while it's being dragged).
function seqFraming() {
  const it = seqPlayer.currentItem()
  const m = seqPlayer.liveMotion || (it && it.motion)
  return isFramed(m) ? m : null
}

let win = null
let raf = 0

export const viewerOpen = () => !!(win && !win.closed)

// What the main player is showing right now.
function source(workspace) {
  if (workspace === 'edit') return seqPlayer.active && seqPlayer.active.video
  // While the ghost is up (scrubbing, skimming, a seek landing) it's the
  // picture — even mid-seek, when paint() just keeps its last frame. Falling
  // back to the main video then would flick to its stale frame.
  if (player.ghostShown && player.ghost) return player.ghost
  return player.video
}

export function toggleViewer() {
  if (viewerOpen()) closeViewer()
  else openViewer()
}

export function closeViewer() {
  if (win && !win.closed) win.close()
}

export function openViewer() {
  if (viewerOpen()) {
    win.focus()
    return
  }
  win = window.open('about:blank', 'bijou-viewer')
  if (!win) return
  const doc = win.document
  doc.title = 'Bijou Footage — Viewer'
  doc.body.innerHTML = ''
  const style = doc.createElement('style')
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: default; user-select: none; }
    canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
    .hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
      background: rgba(20, 21, 26, 0.82); color: #ece9e2; font: 12px/1.3 'Inter', -apple-system, 'Segoe UI', sans-serif;
      opacity: 0; transition: opacity 0.25s; pointer-events: none; white-space: nowrap; }
    body.show-hint .hint { opacity: 1; }
    body.idle { cursor: none; }
    body.zoomed { cursor: grab; }
    .zbadge { position: fixed; top: 12px; right: 12px; display: none; padding: 4px 10px; border: 0; border-radius: 7px;
      background: rgba(10, 11, 14, 0.75); color: #fff; font: 600 12px Menlo, Consolas, monospace; cursor: pointer; }`
  doc.head.appendChild(style)
  const canvas = doc.createElement('canvas')
  const hint = doc.createElement('div')
  hint.className = 'hint'
  hint.textContent = 'Double-click: full screen · Ctrl+scroll / pinch to zoom, drag to move · keys work here too · Ctrl+Shift+V closes'
  const badge = doc.createElement('button')
  badge.className = 'zbadge'
  badge.title = 'Back to 100% (Ctrl+0)'
  doc.body.append(canvas, hint, badge)

  // Zoom into the picture: Ctrl+scroll or a pinch at the mouse, drag to
  // move, Ctrl+0 / the badge back to 100%. In canvas pixels.
  const vz = { s: 1, x: 0, y: 0 }
  const clampZ = () => {
    const W = canvas.width
    const H = canvas.height
    vz.x = Math.min(0, Math.max(W - W * vz.s, vz.x))
    vz.y = Math.min(0, Math.max(H - H * vz.s, vz.y))
  }
  const zoomChanged = () => {
    clampZ()
    badge.textContent = Math.round(vz.s * 100) + '% ⟲'
    badge.style.display = vz.s > 1 ? 'block' : 'none'
    doc.body.classList.toggle('zoomed', vz.s > 1)
    paint(true)
  }
  const resetZoom = () => { vz.s = 1; vz.x = 0; vz.y = 0; zoomChanged() }
  badge.addEventListener('click', resetZoom)
  badge.addEventListener('dblclick', (e) => e.stopPropagation())
  win.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const dpr = win.devicePixelRatio || 1
    const px = e.clientX * dpr
    const py = e.clientY * dpr
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
    const s = Math.max(1, Math.min(8, vz.s * (Math.abs(d) >= 50 ? (d < 0 ? 1.25 : 0.8) : Math.exp(-d * 0.01))))
    vz.x = px - (px - vz.x) * (s / vz.s)
    vz.y = py - (py - vz.y) * (s / vz.s)
    vz.s = s
    if (s === 1) { vz.x = 0; vz.y = 0 }
    zoomChanged()
  }, { passive: false })
  win.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || vz.s === 1 || e.target === badge) return
    const dpr = win.devicePixelRatio || 1
    const start = { x: e.clientX, y: e.clientY, ox: vz.x, oy: vz.y }
    const move = (ev) => {
      vz.x = start.ox + (ev.clientX - start.x) * dpr
      vz.y = start.oy + (ev.clientY - start.y) * dpr
      zoomChanged()
    }
    const up = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up) }
    win.addEventListener('pointermove', move)
    win.addEventListener('pointerup', up)
  })
  const ctx = canvas.getContext('2d', { alpha: false })

  // The hint (and the pointer) show while the mouse moves, then hide.
  let idleTimer = null
  const wake = () => {
    doc.body.classList.add('show-hint')
    doc.body.classList.remove('idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      doc.body.classList.remove('show-hint')
      doc.body.classList.add('idle')
    }, 1800)
  }
  win.addEventListener('mousemove', wake)
  wake()
  win.addEventListener('dblclick', () => {
    if (doc.fullscreenElement) doc.exitFullscreen()
    else doc.documentElement.requestFullscreen().catch(() => {})
  })
  // Keys → the main window's shortcuts (Esc leaves full screen first).
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && doc.fullscreenElement) return
    if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0')) { e.preventDefault(); resetZoom(); return }
    const copy = new KeyboardEvent('keydown', {
      key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(copy)
    if (copy.defaultPrevented) e.preventDefault()
  })

  // Draw only when the picture changes: another video frame (not every
  // screen refresh — the loop runs at the main monitor's rate, often far
  // above the video's), another element, a resize. While a video is between
  // frames (seeking, loading the next file) the last picture stays up, like
  // in the main player — no black flashes. Black only when there's nothing
  // to show at all for a moment (no recording open).
  let last = { el: null, frame: -1, w: 0, h: 0, vw: 0, dw: 0 }
  let noSourceSince = 0
  const stats = (win.__viewerStats = { frames: 0, draws: 0 }) // for tests
  const fps = () => (workspace() === 'edit' ? seqPlayer.fps : player.clip && player.clip.probe && player.clip.probe.fps) || 60
  const paint = (force) => {
    const dpr = win.devicePixelRatio || 1
    const w = Math.round(win.innerWidth * dpr)
    const h = Math.round(win.innerHeight * dpr)
    let resized = false
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      resized = true
    }
    const el = source(workspace())
    if (!el) {
      if (!noSourceSince) noSourceSince = performance.now()
      if (last.el !== null && performance.now() - noSourceSince > 600) {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        last = { el: null, frame: -1, w, h, vw: 0, dw: 0 }
      }
      return
    }
    noSourceSince = 0
    if (el.readyState < 2 || !el.videoWidth) return // between frames: keep the last one
    const frame = Math.floor(el.currentTime * fps() + 0.01)
    // Edit: the clip's framing (zoom / position), as on the monitor.
    const m = workspace() === 'edit' ? seqFraming() : null
    const mk = m ? m.scale + ',' + m.x + ',' + m.y : ''
    if (!force && !resized && el === last.el && frame === last.frame && w === last.w && h === last.h && el.videoWidth === last.vw && mk === last.mk) return
    // Letterboxed, like the main player (object-fit: contain).
    const sc = Math.min(w / el.videoWidth, h / el.videoHeight)
    const dw = Math.round(el.videoWidth * sc)
    const dh = Math.round(el.videoHeight * sc)
    if (resized || w !== last.w || h !== last.h || dw !== last.dw || vz.s > 1 || m || last.mk) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
    }
    // Zoomed in (its own zoom, separate from the main player's).
    if (vz.s > 1) ctx.setTransform(vz.s, 0, 0, vz.s, vz.x, vz.y)
    const ox = Math.round((w - dw) / 2)
    const oy = Math.round((h - dh) / 2)
    if (m) {
      // Framed: scaled about its centre, shifted, cut to the frame.
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox, oy, dw, dh)
      ctx.clip()
      ctx.translate(ox + dw / 2 + m.x * dw, oy + dh / 2 + m.y * dh)
      ctx.scale(m.scale / 100, m.scale / 100)
      ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    } else ctx.drawImage(el, ox, oy, dw, dh)
    if (vz.s > 1) ctx.setTransform(1, 0, 0, 1, 0, 0)
    stats.draws++
    last = { el, frame, w, h, vw: el.videoWidth, dw, mk }
  }
  const draw = () => {
    if (!win || win.closed) return
    raf = win.requestAnimationFrame(draw)
    stats.frames++
    paint(false)
  }
  // A seek landing (a click, a jump, each step of a drag): show that frame
  // right away rather than at the next refresh.
  const onSeeked = () => { if (win && !win.closed) paint(true) }
  document.addEventListener('seeked', onSeeked, true)
  win.addEventListener('beforeunload', () => document.removeEventListener('seeked', onSeeked, true))
  ctx.imageSmoothingQuality = 'high'
  raf = win.requestAnimationFrame(draw)
  win.addEventListener('beforeunload', () => {
    win = null
    bus.emit('viewer', false)
  })
  bus.emit('viewer', true)
}
if (typeof window !== 'undefined') window.__viewer = () => (viewerOpen() ? win : null) // for tests (scripts/cdp.mjs)
