// Builds build/icon.png + build/icon.ico from a picture (default
// build/seruisu.png): trims its transparent margin, centres it on a square
// transparent canvas, and writes the sizes Windows uses. Uses sharp +
// png-to-ico from the main BijouDocs project's devDependencies.
//   node scripts/icon-from-png.mjs [source.png]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'build')
const src = process.argv[2] || path.join(out, 'seruisu.png')

const trimmed = await sharp(src).trim({ threshold: 1 }).png().toBuffer()
const { width, height } = await sharp(trimmed).metadata()
const side = Math.round(Math.max(width, height) * 1.04) // a hair of breathing room
const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: trimmed, left: Math.round((side - width) / 2), top: Math.round((side - height) / 2) }])
  .png()
  .toBuffer()

const at = (s) => sharp(square).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer()
fs.writeFileSync(path.join(out, 'icon.png'), await at(512))
const sizes = [256, 128, 64, 48, 32, 24, 16]
fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(await Promise.all(sizes.map(at))))
console.log(`icon from ${path.basename(src)}: trimmed ${width}x${height} → ${side}px square → icon.png + icon.ico (${sizes.join(', ')})`)
