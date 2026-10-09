// Trimming an edge, the Premiere way:
//  - the cursor shows WHICH side you'll move: a red bracket on the clip's
//    start "[" (trim in) or end "]" (trim out), with a two-way arrow,
//  - the edge you're moving stays lit red while you drag,
//  - a small tip beside the cursor says how far you've moved it ("+0.8 s"
//    when it's longer, "−1.2 s" when shorter).
// The cursors are drawn here and handed to CSS as variables (--cur-trim-in /
// --cur-trim-out), so a stylesheet can use them on any edge.
import { fmtTime } from './time.js'

function cursor(side) {
  const bracket = side === 'in' ? 'M11 4H6.5V22H11' : 'M15 4H19.5V22H15'
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<path d='${bracket}' stroke='#000' stroke-opacity='.6' stroke-width='5.2'/>` +
    `<path d='M5.5 13h15M9.5 9.5L6 13l3.5 3.5M16.5 9.5L20 13l-3.5 3.5' stroke='#000' stroke-opacity='.6' stroke-width='4.4'/>` +
    `<path d='${bracket}' stroke='#ff4a58' stroke-width='2.4'/>` +
    `<path d='M5.5 13h15M9.5 9.5L6 13l3.5 3.5M16.5 9.5L20 13l-3.5 3.5' stroke='#fff' stroke-width='1.8'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 13 13, ew-resize`
}

if (typeof document !== 'undefined') {
  const root = document.documentElement
  root.style.setProperty('--cur-trim-in', cursor('in'))
  root.style.setProperty('--cur-trim-out', cursor('out'))
}

// seconds → "+0.8 s" / "−1:12" (a signed length)
export function fmtDelta(d) {
  const a = Math.abs(d)
  const txt = a < 60 ? a.toFixed(a < 10 ? 2 : 1) + ' s' : fmtTime(a, false)
  return (d < 0 ? '−' : '+') + txt
}

// The tip: a little label that follows the mouse while an edge is dragged.
export function trimTip() {
  const el = document.createElement('div')
  el.className = 'trim-tip'
  document.body.appendChild(el)
  return {
    set(x, y, d) {
      el.textContent = fmtDelta(d)
      el.classList.toggle('neg', d < 0)
      el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 30)}px)`
    },
    remove() {
      el.remove()
    }
  }
}
