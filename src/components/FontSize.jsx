// Text size for a panel: A− / A+ buttons (the size shows on hover) and
// Ctrl+scroll over the panel. `value` is a scale, 1 = normal.
import React, { useEffect } from 'react'
import { useStore } from '../state/store.js'

// A step function for a setting that holds the scale.
export const stepSetting = (key) => (dir) => {
  const st = useStore.getState()
  st.updateSettings({ [key]: stepScale(st.settings[key] || 1, dir) })
}

export const SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.4]
export function stepScale(cur, dir) {
  const i = SCALES.reduce((best, s, k) => (Math.abs(s - cur) < Math.abs(SCALES[best] - cur) ? k : best), 0)
  return SCALES[Math.max(0, Math.min(SCALES.length - 1, i + dir))]
}

// Ctrl+scroll over `ref`'s element changes the size (onStep(+1 / -1)).
export function useCtrlWheelSize(ref, onStep) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      onStep(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [ref, onStep])
}

// onStep(dir) should step from the CURRENT saved size, so quick clicks add up.
export default function FontSize({ value, onStep }) {
  return (
    <div className="font-size" title={'Text size ' + Math.round(value * 100) + '% — or Ctrl+scroll over the panel'}>
      <button onClick={() => onStep(-1)} disabled={value <= SCALES[0]} aria-label="Smaller text">A<small>−</small></button>
      <button onClick={() => onStep(1)} disabled={value >= SCALES[SCALES.length - 1]} aria-label="Bigger text">A<small>+</small></button>
    </div>
  )
}
