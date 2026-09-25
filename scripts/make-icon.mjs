// Builds build/icon.png + build/icon.ico for Bijou Footage from an inline
// SVG (deliberately a clean graphic, so it's easy to tell apart from
// BijouDocs' painted icon in the taskbar). Uses sharp + png-to-ico from the
// main BijouDocs project's devDependencies.
//   node scripts/make-icon.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'build')
fs.mkdirSync(out, { recursive: true })

const bars = [18, 34, 26, 48, 30, 56, 40, 22, 44, 30, 52, 24, 36, 20]
const barW = 14
const gap = 8
const x0 = 256 - (bars.length * (barW + gap) - gap) / 2
const wave = bars
  .map((h, i) => `<rect x="${x0 + i * (barW + gap)}" y="${382 - h / 2}" width="${barW}" height="${h}" rx="4" fill="#4fd1c5" opacity="${0.55 + (i % 3) * 0.15}"/>`)
  .join('')
const holes = (y) =>
  Array.from({ length: 7 }, (_, i) => `<rect x="${92 + i * 50}" y="${y}" width="28" height="18" rx="4" fill="#0b0c10"/>`).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f2530"/>
      <stop offset="1" stop-color="#0c0e13"/>
    </linearGradient>
    <linearGradient id="play" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7ff0e4"/>
      <stop offset="1" stop-color="#2fb3a8"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="#4fd1c5" stroke-opacity="0.35" stroke-width="6"/>
  <!-- film frame -->
  <rect x="76" y="92" width="360" height="238" rx="30" fill="#2a303c"/>
  ${holes(106)}
  ${holes(298)}
  <rect x="96" y="136" width="320" height="150" rx="16" fill="#151920"/>
  <!-- play -->
  <path d="M232 168 L232 256 L304 212 Z" fill="url(#play)" stroke="url(#play)" stroke-width="14" stroke-linejoin="round"/>
  <!-- waveform -->
  ${wave}
  <!-- Premiere-style marker -->
  <path d="M340 52 H412 V116 L376 146 L340 116 Z" fill="#f2c230" stroke="#0c0e13" stroke-width="8" stroke-linejoin="round"/>
</svg>`

const png = await sharp(Buffer.from(svg)).png().toBuffer()
fs.writeFileSync(path.join(out, 'icon.png'), png)
const sizes = [256, 128, 64, 48, 32, 16]
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer()))
fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(pngs))
console.log('wrote', path.join(out, 'icon.png'), 'and icon.ico')
