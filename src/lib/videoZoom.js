// Zoom into the footage (Review's player, Edit's monitor). Ctrl+scroll or a
// trackpad pinch over the picture zooms at the mouse (100–800%); dragging
// while zoomed moves around (a plain click still plays / pauses); Ctrl+0 or
// the % badge goes back to 100%. The video elements just get a CSS
// transform — nothing is decoded differently.
import { useEffect, useRef, useState } from 'react'

const MAX = 8

export function useVideoZoom(stageRef, selector, resetKey) {
  const z = useRef({ s: 1, x: 0, y: 0 })
  const [scale, setScale] = useState(1)

  const apply = () => {
    const stage = stageRef.current
    if (!stage) return
    const { s, x, y } = z.current
    for (const v of stage.querySelectorAll(selector)) {
      v.style.transformOrigin = '0 0'
      v.style.transform = s === 1 ? '' : `translate(${x}px, ${y}px) scale(${s})`
    }
    setScale(s)
  }
  // Keep the picture covering the stage (no gaps at the edges).
  const clamp = (W, H) => {
    const t = z.current
    t.x = Math.min(0, Math.max(W - W * t.s, t.x))
    t.y = Math.min(0, Math.max(H - H * t.s, t.y))
  }
  const zoomAt = (factor, px, py) => {
    const stage = stageRef.current
    const W = stage.clientWidth
    const H = stage.clientHeight
    const t = z.current
    const s = Math.max(1, Math.min(MAX, t.s * factor))
    t.x = px - (px - t.x) * (s / t.s)
    t.y = py - (py - t.y) * (s / t.s)
    t.s = s
    if (s === 1) { t.x = 0; t.y = 0 }
    clamp(W, H)
    apply()
  }
  const reset = () => {
    z.current = { s: 1, x: 0, y: 0 }
    apply()
  }

  useEffect(() => reset(), [resetKey]) // e.g. another recording opened

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return // Ctrl+scroll, or a pinch (it arrives as Ctrl+scroll)
      e.preventDefault()
      e.stopPropagation()
      const r = stage.getBoundingClientRect()
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      const factor = Math.abs(d) >= 50 ? (d < 0 ? 1.25 : 0.8) : Math.exp(-d * 0.01) // a wheel notch vs a pinch
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
    }
    // Drag to move while zoomed; a drag must not also count as a click.
    let drag = null
    let swallowClick = false
    const onDown = (e) => {
      if (e.button !== 0 || z.current.s === 1) return
      drag = { x: e.clientX, y: e.clientY, ox: z.current.x, oy: z.current.y, moved: false }
      const move = (ev) => {
        const dx = ev.clientX - drag.x
        const dy = ev.clientY - drag.y
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
        drag.moved = true
        stage.classList.add('zoom-dragging')
        z.current.x = drag.ox + dx
        z.current.y = drag.oy + dy
        clamp(stage.clientWidth, stage.clientHeight)
        apply()
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        stage.classList.remove('zoom-dragging')
        swallowClick = drag && drag.moved
        drag = null
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    const onClick = (e) => {
      if (swallowClick) {
        swallowClick = false
        e.stopPropagation()
        e.preventDefault()
      }
    }
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0') && z.current.s !== 1) {
        e.preventDefault()
        e.stopPropagation()
        reset()
      }
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('pointerdown', onDown)
    stage.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey, true)
    const ro = new ResizeObserver(() => { clamp(stage.clientWidth, stage.clientHeight); apply() })
    ro.observe(stage)
    return () => {
      stage.removeEventListener('wheel', onWheel)
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
      ro.disconnect()
    }
  }, [])

  return { scale, reset }
}
