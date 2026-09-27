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

const workspace = () => useStore.getState().settings.workspace || 'review'

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
    body.idle { cursor: none; }`
  doc.head.appendChild(style)
  const canvas = doc.createElement('canvas')
  const hint = doc.createElement('div')
  hint.className = 'hint'
  hint.textContent = 'Double-click: full screen · keys work here too · Ctrl+Shift+V closes'
  doc.body.append(canvas, hint)
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
    if (!force && !resized && el === last.el && frame === last.frame && w === last.w && h === last.h && el.videoWidth === last.vw) return
    // Letterboxed, like the main player (object-fit: contain).
    const sc = Math.min(w / el.videoWidth, h / el.videoHeight)
    const dw = Math.round(el.videoWidth * sc)
    const dh = Math.round(el.videoHeight * sc)
    if (resized || w !== last.w || h !== last.h || dw !== last.dw) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(el, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh)
    stats.draws++
    last = { el, frame, w, h, vw: el.videoWidth, dw }
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
