import { useEffect, useState } from 'react'
import { player } from './player.js'

// One shared animation-frame ticker for everything that follows the
// playhead in React (instead of a rAF loop per component). It only runs
// while something is subscribed, and each subscriber is called at most
// every `ms`.
const tickSubs = new Set()
let tickRaf = 0
function tickLoop(now) {
  for (const sub of tickSubs) {
    if (now - sub.last >= sub.ms) {
      sub.last = now
      sub.fn()
    }
  }
  tickRaf = tickSubs.size ? requestAnimationFrame(tickLoop) : 0
}
export function onTick(ms, fn) {
  const sub = { ms, fn, last: 0 }
  tickSubs.add(sub)
  if (!tickRaf) tickRaf = requestAnimationFrame(tickLoop)
  return () => tickSubs.delete(sub)
}

// Current playhead time, re-rendering at most every `ms` — for readouts
// that don't need to be frame-accurate (canvas drawing reads player
// directly inside its own rAF loop instead).
export function usePlayerTime(ms = 100) {
  const [t, setT] = useState(() => player.getTime())
  useEffect(() => onTick(ms, () => {
    const cur = player.getTime()
    setT((prev) => (Math.abs(prev - cur) > 0.001 ? cur : prev))
  }), [ms])
  return t
}

// Something derived from the playhead time (e.g. "which note is current"):
// re-renders only when the derived value changes, not every tick.
export function usePlayerDerived(compute, deps, ms = 150) {
  const [v, setV] = useState(() => compute(player.getTime()))
  useEffect(() => {
    setV(compute(player.getTime()))
    return onTick(ms, () => {
      const next = compute(player.getTime())
      setV((prev) => (prev === next ? prev : next))
    })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

export function usePlayerState() {
  const [st, setSt] = useState(() => ({ playing: player.playing, rate: player.rate, baseRate: player.baseRate, shuttling: player.shuttling, skimming: !!player.skim }))
  useEffect(() => player.on('state', setSt), [])
  return st
}

// Tiny event bus for UI-to-UI commands that don't belong in the store
// (e.g. keyboard shortcut → timeline zoom, flash an on-screen message).
const handlers = {}
export const bus = {
  on(evt, fn) {
    ;(handlers[evt] ||= new Set()).add(fn)
    return () => handlers[evt].delete(fn)
  },
  emit(evt, payload) {
    if (handlers[evt]) handlers[evt].forEach((fn) => fn(payload))
  }
}
