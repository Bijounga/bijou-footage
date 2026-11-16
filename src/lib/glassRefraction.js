// Liquid Glass: edge refraction for the big glass panels. Each panel gets an
// SVG filter whose displacement map is drawn for its own size and corner
// radius: a band along the rim bends the picture behind it toward the middle,
// like the edge of a lens, and the middle stays undistorted. It's applied as
// the panel's backdrop-filter (url(#…) then the blur), which Chromium renders.
// The technique is the one liquid-glass-react / kube.io use; the map here is a
// signed-distance field of the rounded rectangle, so corners bend correctly.
const SELECTORS = ['.app > .library', '.app > .center > .upper > .notes-panel', '.app > .notes-panel']
const BAND = 34 // px of rim that bends
const SCALE = 70 // how far the rim bends the backdrop, px
const RES = 0.5 // map resolution (the filter scales it up smoothly)

let svg = null
let ro = null
let mo = null
let seq = 0
let done = new WeakMap() // element -> {id, w, h}
let scanTimer = 0

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
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
  }
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const x = (i + 0.5) / RES
      const y = (j + 0.5) / RES
      const s = sdf(x, y)
      let dx = 0
      let dy = 0
      if (s > -BAND && s <= 0) {
        // outward normal from the field's gradient
        const gx = sdf(x + 1, y) - sdf(x - 1, y)
        const gy = sdf(x, y + 1) - sdf(x, y - 1)
        const gl = Math.hypot(gx, gy) || 1
        const t = 1 + s / BAND // 1 at the rim, 0 where the band ends
        const f = t * t * t // strongest right at the edge, easing off inward
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

// New panels get watched; the ResizeObserver's first report draws their map (and redraws it when they resize).
function scan() {
  scanTimer = 0
  if (!ro) return
  for (const sel of SELECTORS) for (const el of document.querySelectorAll(sel)) if (!done.has(el)) { done.set(el, { id: null, w: 0, h: 0 }); ro.observe(el) }
}

export function startRefraction() {
  if (ro) return
  ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)))
  // Panels come and go (a hidden sidebar, another workspace): look again shortly after the page changes.
  mo = new MutationObserver(() => { if (!scanTimer) scanTimer = setTimeout(scan, 300) })
  mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
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
