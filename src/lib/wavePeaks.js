// Fast "loudest sample in this stretch" for drawing waveforms at any zoom.
//
// Zoomed out, one pixel can cover minutes of a recording — thousands of the
// 50-per-second peaks. Scanning them all on every pan/zoom made panning a
// long timeline hitch. Instead each track gets a pyramid of maxima (level k
// holds the max of every 2^k peaks, built once, ~2× the data) and a range
// query touches only ~2 values per level: a handful per pixel at any zoom.

const pyramids = new WeakMap() // Uint8Array -> [level0, level1, …]

function levels(data) {
  let L = pyramids.get(data)
  if (L) return L
  L = [data]
  let cur = data
  while (cur.length > 1) {
    const n = (cur.length + 1) >> 1
    const next = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const a = cur[2 * i]
      const b = 2 * i + 1 < cur.length ? cur[2 * i + 1] : 0
      next[i] = a > b ? a : b
    }
    L.push(next)
    cur = next
  }
  pyramids.set(data, L)
  return L
}

// max(data[i0 … i1-1]); always covers at least one sample.
export function peakBetween(data, i0, i1) {
  let a = Math.max(0, i0 | 0)
  let b = Math.min(data.length, i1 | 0)
  if (b <= a) b = Math.min(data.length, a + 1)
  if (a >= b) return 0
  const L = levels(data)
  let m = 0
  for (let lv = 0; a < b && lv < L.length; lv++) {
    const arr = L[lv]
    if (a & 1) { const v = arr[a++]; if (v > m) m = v }
    if (b & 1) { const v = arr[--b]; if (v > m) m = v }
    a >>= 1
    b >>= 1
  }
  return m
}

// Speech spans ([[a, b], …] sorted, in seconds) → pixel runs to paint,
// only the ones in [t0, t1], with neighbours that touch at this zoom merged
// (zoomed out, thousands of spans collapse into a few dozen rects).
export function speechRuns(segs, t0, t1, toX) {
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (segs[m][1] < t0) lo = m + 1
    else hi = m
  }
  const runs = []
  for (let i = lo; i < segs.length && segs[i][0] <= t1; i++) {
    const a = Math.max(segs[i][0], t0)
    const b = Math.min(segs[i][1], t1)
    const x0 = Math.floor(toX(a))
    const x1 = Math.max(x0 + 1, Math.ceil(toX(b)))
    const last = runs[runs.length - 1]
    if (last && x0 <= last[1] + 1) last[1] = Math.max(last[1], x1)
    else runs.push([x0, x1])
  }
  return runs
}
