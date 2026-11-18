// Liquid Glass abstract wallpapers (original artwork): layered flowing bands,
// each lit along its crest and casting a soft shadow on the one below, in the
// spirit of the Mac's abstract wallpapers. SVG rendered with sharp at 1280x720,
// scaled to 2560x1440, with a ±1 dither so the gradients never band.
//   node gen-abstract.cjs [outDir] [only]
const sharp = require('sharp')
const OUT = process.argv[2] || './backgrounds/'
const ONLY = process.argv[3]
const W = 1280, H = 720

// A band: the region below a flowing crest. crest(t) -> [x, y] along t in 0..1.
function crestPath(pts) {
  // Catmull-Rom through pts -> cubic béziers
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
function wave(y0, amp, freq, phase, tilt, n = 9) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = -80 + t * (W + 160)
    pts.push([x, y0 + tilt * (t - 0.5) * H + amp * Math.sin(phase + t * Math.PI * 2 * freq)])
  }
  return pts
}

function art({ base, glows, bands, sheen }) {
  const defs = []
  const body = []
  defs.push(`<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>`)
  defs.push(`<filter id="shadow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>`)
  defs.push(`<filter id="lip" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>`)
  defs.push(`<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">${base.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`)
  body.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`)
  body.push(`<g filter="url(#glow)">${glows.map(([x, y, r, c, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`).join('')}</g>`)
  bands.forEach((b, i) => {
    const pts = wave(b.y, b.amp, b.freq, b.phase, b.tilt || 0)
    const crest = crestPath(pts)
    const area = `${crest} L${W + 80},${H + 80} L-80,${H + 80} Z`
    const gx = b.gdir || [0, 0, 1, 0.35]
    defs.push(`<linearGradient id="b${i}" x1="${gx[0]}" y1="${gx[1]}" x2="${gx[2]}" y2="${gx[3]}">${b.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`)
    // depth: darker toward the bottom of each band
    defs.push(`<linearGradient id="d${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${b.depth == null ? 0.35 : b.depth}"/></linearGradient>`)
    body.push(`<path d="${area}" transform="translate(0,-14)" fill="#000" opacity="${b.shadow == null ? 0.35 : b.shadow}" filter="url(#shadow)"/>`)
    body.push(`<path d="${area}" fill="url(#b${i})"/>`)
    body.push(`<path d="${area}" fill="url(#d${i})"/>`)
    body.push(`<path d="${crest}" fill="none" stroke="${b.lip || '#ffffff'}" stroke-opacity="${b.lipO == null ? 0.55 : b.lipO}" stroke-width="2.4" filter="url(#lip)"/>`)
  })
  if (sheen) body.push(`<rect width="${W}" height="${H}" fill="url(#sheen)"/>`), defs.push(`<radialGradient id="sheen" cx="${sheen[0]}" cy="${sheen[1]}" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="${sheen[2]}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`
}

const ARTS = {
  // Deep ocean blues rising to a bright cyan crest.
  'glass-abstract-tide': art({
    base: [[0, '#0b1d4a'], [1, '#04102c']],
    glows: [[980, 120, 260, '#3b6dff', 0.55], [260, 640, 300, '#00b4d8', 0.35]],
    bands: [
      { y: 250, amp: 60, freq: 0.8, phase: 0.3, tilt: -0.25, stops: [[0, '#1b3fae'], [0.5, '#2f6bff'], [1, '#6fb6ff']], depth: 0.4 },
      { y: 360, amp: 70, freq: 0.7, phase: 1.4, tilt: -0.2, stops: [[0, '#0f5fd0'], [0.6, '#16a3e8'], [1, '#7fe3ff']], depth: 0.4 },
      { y: 470, amp: 55, freq: 0.9, phase: 2.6, tilt: -0.15, stops: [[0, '#0a3f9c'], [0.5, '#1f7ae0'], [1, '#56c8ff']], depth: 0.45 },
      { y: 590, amp: 45, freq: 0.75, phase: 3.9, tilt: -0.1, stops: [[0, '#071f5c'], [0.6, '#1450b8'], [1, '#2c8cf0']], depth: 0.5 }
    ],
    sheen: [0.75, 0.15, 0.12]
  }),
  // Warm bloom: coral, tangerine and magenta.
  'glass-abstract-bloom': art({
    base: [[0, '#3a0d3f'], [1, '#14051c']],
    glows: [[300, 140, 280, '#ff7a3d', 0.5], [1050, 220, 260, '#ff3d8b', 0.45]],
    bands: [
      { y: 230, amp: 80, freq: 0.6, phase: 2.2, tilt: 0.25, stops: [[0, '#ff9a3d'], [0.5, '#ff5e62'], [1, '#c2185b']], depth: 0.35, lip: '#ffe2c4' },
      { y: 350, amp: 70, freq: 0.7, phase: 3.1, tilt: 0.2, stops: [[0, '#ff6f3c'], [0.5, '#e83e8c'], [1, '#8e24aa']], depth: 0.4, lip: '#ffd0e0' },
      { y: 470, amp: 60, freq: 0.8, phase: 4.0, tilt: 0.15, stops: [[0, '#d84315'], [0.5, '#c2185b'], [1, '#5e1a8f']], depth: 0.45, lip: '#ffc0d8' },
      { y: 590, amp: 45, freq: 0.7, phase: 5.0, tilt: 0.1, stops: [[0, '#8e1b3a'], [0.6, '#6a1b6f'], [1, '#2e0f4f']], depth: 0.5, lipO: 0.35 }
    ],
    sheen: [0.25, 0.1, 0.1]
  }),
  // Pearl: pale lilac, rose and mint silk, for the light glass.
  'glass-abstract-pearl': art({
    base: [[0, '#f3eefb'], [1, '#e2e6f4']],
    glows: [[250, 150, 280, '#ffd6e8', 0.8], [1080, 200, 300, '#cfe9ff', 0.8], [700, 650, 300, '#d6fff0', 0.6]],
    bands: [
      { y: 270, amp: 70, freq: 0.7, phase: 0.8, tilt: -0.2, stops: [[0, '#f9d9ec'], [0.5, '#e5d4ff'], [1, '#cfe6ff']], depth: 0.08, shadow: 0.12, lipO: 0.9 },
      { y: 390, amp: 65, freq: 0.8, phase: 2.0, tilt: -0.15, stops: [[0, '#d8ccff'], [0.5, '#f6cde4'], [1, '#c9f2e6']], depth: 0.1, shadow: 0.12, lipO: 0.9 },
      { y: 510, amp: 55, freq: 0.7, phase: 3.2, tilt: -0.1, stops: [[0, '#c5e4ff'], [0.5, '#dccfff'], [1, '#f7d3e6']], depth: 0.12, shadow: 0.14, lipO: 0.85 },
      { y: 620, amp: 40, freq: 0.9, phase: 4.3, tilt: -0.05, stops: [[0, '#bcd2f5'], [0.6, '#cfc3f2'], [1, '#e9c6e0']], depth: 0.14, shadow: 0.14, lipO: 0.8 }
    ],
    sheen: [0.5, 0.0, 0.35]
  }),
  // Aurora: green and violet light over a night sky.
  'glass-abstract-aurora': art({
    base: [[0, '#06121f'], [1, '#020810']],
    glows: [[420, 200, 280, '#22e3a5', 0.45], [950, 160, 260, '#7c4dff', 0.5], [700, 420, 240, '#00bcd4', 0.3]],
    bands: [
      { y: 300, amp: 90, freq: 0.6, phase: 1.1, tilt: 0.1, stops: [[0, '#0f9b7a'], [0.5, '#25d9a6'], [1, '#6a5cff']], depth: 0.55, lip: '#bfffe9', lipO: 0.5 },
      { y: 430, amp: 70, freq: 0.7, phase: 2.4, tilt: 0.05, stops: [[0, '#0b5e63'], [0.5, '#159f9a'], [1, '#4b37c8']], depth: 0.6, lip: '#a8fff0', lipO: 0.4 },
      { y: 560, amp: 55, freq: 0.8, phase: 3.6, tilt: 0, stops: [[0, '#06303f'], [0.5, '#0b5468'], [1, '#2a1f7a']], depth: 0.65, lipO: 0.3 }
    ]
  })
}

;(async () => {
  for (const [name, svg] of Object.entries(ARTS)) {
    if (ONLY && name !== ONLY) continue
    const { data, info } = await sharp(Buffer.from(svg)).resize(2560, 1440, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let s = 12345
    for (let i = 0; i < data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = ((s >> 16) & 3) - 1.5; data[i] = Math.max(0, Math.min(255, data[i] + Math.round(n * 0.7))) }
    await sharp(data, { raw: info }).webp({ quality: 90, effort: 5 }).toFile(OUT + name + '.webp')
    console.log(name)
  }
})()
