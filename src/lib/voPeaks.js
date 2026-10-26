// Waveform peaks of the recorded takes (200 per second, one byte each — the
// square root of the slice's peak), loaded from the project folder once
// and kept. peaksOf() is for code that needs them right now (drawing,
// auto-cut); ensurePeaks() loads what's missing first.
//
// Voice enhance (voEnhance.js): with it on, the waveform is the one you hear —
// the original's and the enhanced copy's peaks blended with the same gains the
// player uses, so noise between the words shrinks and the voice grows as you
// slide the strength up.
import { config, gainsFor, isReady, subscribe, onReady } from './voEnhance.js'

const api = window.footage
const cache = new Map() // take id -> Uint8Array | null (none) | 'loading'
const enhCache = new Map() // take id -> the enhanced copy's peaks | null | 'loading'
const blended = new Map() // `${take}|${strength}` -> Uint8Array
const waiters = new Set()
let folderNow = null

const lin = (b) => (b / 255) * (b / 255) // a stored byte (sqrt of the peak) back to an amplitude

export const peaksOf = (take) => {
  const p = cache.get(take)
  if (!(p instanceof Uint8Array)) return null
  if (!config().on) return p
  const w = enhCache.get(take)
  if (!(w instanceof Uint8Array)) return p
  const a = Math.round(config().amount * 100) / 100
  const key = take + '|' + a
  let out = blended.get(key)
  if (!out) {
    const g = gainsFor(take)
    const n = Math.min(p.length, w.length)
    out = new Uint8Array(p.length)
    for (let i = 0; i < n; i++) out[i] = Math.min(255, Math.round(Math.sqrt(Math.min(1, lin(p[i]) * g.dry + lin(w[i]) * g.wet)) * 255))
    for (let i = n; i < p.length; i++) out[i] = p[i]
    blended.set(key, out)
    if (blended.size > 400) blended.delete(blended.keys().next().value)
  }
  return out
}
export function onPeaks(fn) {
  waiters.add(fn)
  return () => waiters.delete(fn)
}
export async function ensurePeaks(folder, takes) {
  await Promise.all(
    [...new Set(takes)].map(async (t) => {
      if (cache.has(t) && cache.get(t) !== 'loading') return
      if (cache.get(t) === 'loading') {
        while (cache.get(t) === 'loading') await new Promise((r) => setTimeout(r, 30))
        return
      }
      cache.set(t, 'loading')
      folderNow = folder
      const buf = await api.voReadPeaks(folder, t).catch(() => null)
      cache.set(t, buf ? new Uint8Array(buf) : null)
      waiters.forEach((fn) => fn())
      loadEnh(folder, t)
    })
  )
}
// The enhanced copy's peaks, once it exists.
async function loadEnh(folder, t) {
  if (!isReady(t) || enhCache.has(t)) return
  enhCache.set(t, 'loading')
  const buf = await api.voReadPeaks(folder, t, true).catch(() => null)
  enhCache.set(t, buf ? new Uint8Array(buf) : null)
  for (const k of [...blended.keys()]) if (k.startsWith(t + '|')) blended.delete(k)
  waiters.forEach((fn) => fn())
}
// An enhanced copy was just made (or found): load its peaks.
onReady((folder, take) => { if (cache.has(take) || folder) loadEnh(folder || folderNow, take) })
// The strength moved / enhance was switched: what's drawn changes.
let was = ''
subscribe(() => {
  const c = config()
  const now = c.on + '|' + Math.round(c.amount * 100)
  if (now === was) return
  was = now
  waiters.forEach((fn) => fn())
})
// A take that was just recorded: its peaks are known already.
export function putPeaks(take, bytes) {
  cache.set(take, bytes)
  waiters.forEach((fn) => fn())
}
