// Wheel / trackpad input for the timelines.
//
// A mouse wheel scrolls up/down; a trackpad (a Mac's especially) sends a
// stream of small events on both axes — a sideways two-finger swipe is
// mostly deltaX with a little deltaY noise, and a pinch arrives as
// ctrlKey + deltaY. So:
//   panAmount(e)  the swipe's direction, picked at the start of a gesture
//                 and kept until it clearly changes (no flip-flopping on a
//                 slightly diagonal swipe), in pixels whatever the device.
//   onFrame(fn)   collects many events into one update per frame.
export const IS_MAC = typeof window !== 'undefined' && window.footage && window.footage.platform === 'darwin'

const px = (e, v) => v * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

export function makeWheelAxis() {
  let axis = null
  let last = 0
  return function panAmount(e) {
    const now = performance.now()
    if (now - last > 180) axis = null // a new gesture
    last = now
    const ax = Math.abs(e.deltaX)
    const ay = Math.abs(e.deltaY)
    if (!axis) axis = ax > ay ? 'x' : 'y'
    else if (axis === 'y' && ax > ay * 2 && ax > 3) axis = 'x'
    else if (axis === 'x' && ay > ax * 2 && ay > 3) axis = 'y'
    return px(e, axis === 'x' ? e.deltaX : e.deltaY)
  }
}

// A trackpad pinch (Mac): ctrlKey without the Ctrl key held — Chromium
// reports the pinch that way. Small, fractional deltas.
export const isPinch = (e) => IS_MAC && e.ctrlKey

// Sum of what arrived since the last frame, handed to fn once per frame.
export function onFrame(fn) {
  let sum = 0
  let at = null
  let raf = 0
  return (d, x) => {
    sum += d
    at = x
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const s = sum
      sum = 0
      fn(s, at)
    })
  }
}
