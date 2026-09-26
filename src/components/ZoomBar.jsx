// Zoom bar for the timelines (Review and Edit): Fit · − · slider · +.
// The slider runs from "everything fits" (left) to the closest zoom
// (right), on a log scale so each bit of travel zooms by the same ratio.
// get(): current zoom as 0…1 — read every few frames (the timelines zoom
// by wheel / pinch / keys too, outside React), set(z): zoom to it.
import React, { useEffect, useRef, useState } from 'react'
import { onTick } from '../lib/hooks.js'

export default function ZoomBar({ get, set, onFit, onStep, fitTitle = 'Fit everything' }) {
  const [z, setZ] = useState(() => get())
  const dragging = useRef(false)
  useEffect(
    () =>
      onTick(80, () => {
        if (dragging.current) return
        const v = get()
        setZ((p) => (Math.abs(p - v) > 0.002 ? v : p))
      }),
    [get]
  )
  const move = (e) => {
    const v = Number(e.target.value) / 1000
    setZ(v)
    set(v)
  }
  return (
    <div className="zoom-bar">
      <button className="mini-btn" onClick={onFit} title={fitTitle}>Fit</button>
      <button className="mini-btn" onClick={() => onStep(-1)} title="Zoom out">−</button>
      <input
        type="range"
        className="zoom-range"
        min="0"
        max="1000"
        value={Math.round(z * 1000)}
        onChange={move}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        title="Zoom — drag, or pinch / Alt+scroll over the timeline"
        style={{ '--z': z * 100 + '%' }}
      />
      <button className="mini-btn" onClick={() => onStep(1)} title="Zoom in">+</button>
    </div>
  )
}
