// Liquid Glass edge refraction (portable, from Bijou Footage v0.15.11).
// Each element matching the selector gets an SVG filter whose displacement map
// is drawn for its own size and corner radius: a band along the rim bends the
// picture behind it inward, like the edge of a lens; the middle is undistorted.
// It is applied as the element's backdrop-filter: url(#id) + the blur.
//
// CHROMIUM ONLY (Electron, Chrome, Edge). Safari/Firefox don't render
// url() in backdrop-filter, and an unsupported value voids the whole
// declaration — so startRefraction() does nothing outside Chromium.
//
// Usage:
//   import { startRefraction, stopRefraction } from './liquid-glass-refraction.js'
//   startRefraction()            // when the glass theme turns on  (default selector '.lg-refract')
//   stopRefraction()             // when it turns off
// Use it on 2–4 big panels, not on every button (each map is a canvas-drawn PNG).

const BAND = 34 // px of rim that bends
const SCALE = 70 // how far the rim bends the backdrop, px
const RES = 0.5 // map resolution (the filter scales it up smoothly)

let svg = null
let ro = null
let mo = null
let seq = 0
let done = new WeakMap() // element -> {id, w, h}
let scanTimer = 0
let selector = '.lg-refract'

const isChromium = () => typeof window !== 'undefined' && (!!window.chrome || /Electron|Chrome\//.test(navigator.userAgent)) && !/Firefox\//.test(navigator.userAgent)

function ensureSvg() {
  if (svg) return svg
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.appendChild(svg)
  return svg
}

// The displacement map: R/G = 128 ± how far to look sideways for each pixel.
function mapFor(w, h, radius) {
  const mw = Math.max(2, Math.round(w * RES))
  const mh = Math.max(2, Math.round(h * RES))
  const cv = document.createElement('canvas')
  cv.width = mw
  cv.height = mh
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(mw, mh)
  const d = img.data
  const hw = w / 2
  const hh = h / 2
  const r = Math.min(radius, hw, hh)
  // signed distance to the rounded rectangle's edge (negative inside)
  const sdf = (x, y) => {
    const qx = Math.abs(x - hw) - (hw - r)
    const qy = Math.abs(y - hh) - (hh - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const x = (i + 0.5) / RES
      const y = (j + 0.5) / RES
      const s = sdf(x, y)
      let dx = 0
      let dy = 0
      if (s > -BAND && s <= 0) {
        const gx = sdf(x + 1, y) - sdf(x - 1, y)
        const gy = sdf(x, y + 1) - sdf(x, y - 1)
        const gl = Math.hypot(gx, gy) || 1
        const t = 1 + s / BAND // 1 at the rim, 0 where the band ends
        const f = t * t * t // strongest at the edge, easing off inward
        dx = (-gx / gl) * f // look inward: the rim magnifies what's just inside it
        dy = (-gy / gl) * f
      }
      const k = (j * mw + i) * 4
      d[k] = Math.round(128 + dx * 127)
      d[k + 1] = Math.round(128 + dy * 127)
      d[k + 2] = 128
      d[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL('image/png')
}

function apply(el) {
  const rect = el.getBoundingClientRect()
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (w < 40 || h < 40) return
  const prev = done.get(el)
  if (prev && prev.w === w && prev.h === h) return
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  const id = (prev && prev.id) || 'lg-refract-' + ++seq
  const ns = 'http://www.w3.org/2000/svg'
  let f = ensureSvg().querySelector('#' + id)
  if (!f) {
    f = document.createElementNS(ns, 'filter')
    f.setAttribute('id', id)
    f.setAttribute('filterUnits', 'userSpaceOnUse')
    f.setAttribute('primitiveUnits', 'userSpaceOnUse')
    f.setAttribute('color-interpolation-filters', 'sRGB')
    const im = document.createElementNS(ns, 'feImage')
    im.setAttribute('result', 'map')
    im.setAttribute('preserveAspectRatio', 'none')
    const dm = document.createElementNS(ns, 'feDisplacementMap')
    dm.setAttribute('in', 'SourceGraphic')
    dm.setAttribute('in2', 'map')
    dm.setAttribute('xChannelSelector', 'R')
    dm.setAttribute('yChannelSelector', 'G')
    dm.setAttribute('scale', String(SCALE))
    f.append(im, dm)
    svg.appendChild(f)
  }
  for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) f.setAttribute(k, String(v))
  const im = f.querySelector('feImage')
  for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) im.setAttribute(k, String(v))
  im.setAttribute('href', mapFor(w, h, radius))
  done.set(el, { id, w, h })
  el.dataset.lgRefract = id
  el.style.setProperty('--lg-refract', 'url(#' + id + ')')
}

function scan() {
  scanTimer = 0
  if (!ro) return
  for (const el of document.querySelectorAll(selector)) {
    if (!done.has(el)) {
      done.set(el, { id: null, w: 0, h: 0 })
      ro.observe(el) // the first ResizeObserver report draws the map, later ones redraw it
    }
  }
}

export function startRefraction(sel = '.lg-refract') {
  if (ro || !isChromium()) return
  selector = sel
  ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)))
  // panels come and go: look again shortly after the DOM changes
  mo = new MutationObserver(() => { if (!scanTimer) scanTimer = setTimeout(scan, 300) })
  mo.observe(document.body, { childList: true, subtree: true })
  scan()
}

export function stopRefraction() {
  if (ro) ro.disconnect()
  if (mo) mo.disconnect()
  ro = null
  mo = null
  clearTimeout(scanTimer)
  scanTimer = 0
  done = new WeakMap()
  for (const el of document.querySelectorAll('[data-lg-refract]')) {
    el.style.removeProperty('--lg-refract')
    delete el.dataset.lgRefract
  }
  if (svg) svg.remove()
  svg = null
}
