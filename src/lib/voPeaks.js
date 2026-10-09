// Waveform peaks of the recorded takes (200 per second, one byte each — the
// square root of the slice's peak), loaded from the project folder once
// and kept. peaksOf() is for code that needs them right now (drawing,
// auto-cut); ensurePeaks() loads what's missing first.
const api = window.footage
const cache = new Map() // take id -> Uint8Array | null (none) | 'loading'
const waiters = new Set()

export const peaksOf = (take) => {
  const p = cache.get(take)
  return p instanceof Uint8Array ? p : null
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
      const buf = await api.voReadPeaks(folder, t).catch(() => null)
      cache.set(t, buf ? new Uint8Array(buf) : null)
      waiters.forEach((fn) => fn())
    })
  )
}
// A take that was just recorded: its peaks are known already.
export function putPeaks(take, bytes) {
  cache.set(take, bytes)
  waiters.forEach((fn) => fn())
}
