// Lining up a POV with your recording by sound.
//
// Both recordings have their waveform peaks (50 a second per track, see
// electron/main/waveform.js). Something you both heard — the Discord call,
// a game sound — makes the same pattern of loud and quiet in both, just
// shifted by however much earlier or later the other person hit record.
// Cross-correlating the two patterns finds that shift.
//
// Their tracks are laid out differently from yours (their Discord may be
// mixed into their game track), so every one of their tracks is tried
// against every one of yours, and the clearest match wins.
//
//   1. coarse: every track at 10 a second, the whole range of shifts at once
//      (an FFT cross-correlation — hours of footage in a second or two)
//   2. fine: around the best shift, at the full 50 a second, then a
//      parabola through the peak — about a frame
//
// offset = their time − your time at the same moment (they started recording
// 2 minutes before you → +120).
// the cached waveform file (same layout as Timeline.jsx's parseWaveform):
// "BWF1" | u32 tracks | u32 peaks per second | u32 length, then the tracks
function parseWaveform(u8) {
  if (!u8 || u8.length < 16) return null
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const n = dv.getUint32(4, true)
  const pps = dv.getUint32(8, true)
  const len = dv.getUint32(12, true)
  const tracks = []
  for (let i = 0; i < n; i++) tracks.push(u8.subarray(16 + i * len, 16 + (i + 1) * len))
  return { n, pps, len, tracks }
}

const api = window.footage

// ---- a small radix-2 FFT (in place, re / im arrays) ----
function fft(re, im, inverse) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

// Peaks → the "shape" of the sound: each moment minus the average of the
// second around it (so a loud game track and a quiet voice track compare
// fairly, and steady noise counts for nothing), then zero mean, unit spread.
function shape(peaks, factor, win) {
  const n = Math.floor(peaks.length / factor)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += peaks[i * factor + k]
    x[i] = s / factor
  }
  // running mean over ±win
  const out = new Float64Array(n)
  let acc = 0
  let lo = 0
  let hi = -1
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n - 1, i + win)) acc += x[++hi]
    while (lo < i - win) acc -= x[lo++]
    out[i] = x[i] - acc / (hi - lo + 1)
  }
  let m = 0
  for (let i = 0; i < n; i++) m += out[i]
  m /= n || 1
  let v = 0
  for (let i = 0; i < n; i++) { out[i] -= m; v += out[i] * out[i] }
  const sd = Math.sqrt(v / (n || 1)) || 1
  for (let i = 0; i < n; i++) out[i] /= sd
  return out
}

// Is this track worth comparing (not silent / nearly empty)?
function active(peaks) {
  let loud = 0
  for (let i = 0; i < peaks.length; i += 5) if (peaks[i] > 40) loud++
  return loud > peaks.length / 5 / 200 // at least ~0.5% of the time
}

const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(2, n)))
const tick = () => new Promise((r) => setTimeout(r, 0))

// The waveform peaks of a recording, waiting for them to be built if need be.
// onProgress(0..1) while it's being prepared.
export async function loadPeaks(clip, onProgress, getStatus) {
  let u8 = await api.getWaveform(clip)
  if (u8) return parseWaveform(u8)
  await api.requestWaveform(clip, true)
  const t0 = Date.now()
  while (Date.now() - t0 < 30 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 500))
    const s = getStatus ? getStatus() : null
    if (s && onProgress) onProgress(s.progress || 0)
    if (s && s.status === 'error') throw new Error(s.error || 'Couldn’t read its audio')
    if (!s || s.status === 'ready') {
      u8 = await api.getWaveform(clip)
      if (u8) return parseWaveform(u8)
    }
  }
  throw new Error('Preparing its audio took too long')
}

// main, pov: parsed waveforms ({pps, tracks: [Uint8Array]}).
// guess: the expected offset (seconds) from the recording times, or null.
// Returns {offset, confidence (0..1), pair: [mainTrack, povTrack], agree}
// or null if nothing matched at all.
export async function findOffset(main, pov, { onProgress, near = null, range = 180 } = {}) {
  const pps = main.pps
  const F = 5 // coarse: 50 → 10 a second
  const cps = pps / F
  const mains = main.tracks.map((t, i) => ({ i, t })).filter((x) => active(x.t))
  const povs = pov.tracks.map((t, i) => ({ i, t })).filter((x) => active(x.t))
  if (!mains.length || !povs.length) return null
  const A = mains.map((x) => shape(x.t, F, cps))
  const B = povs.map((x) => shape(x.t, F, cps))
  const la = A[0].length
  const lb = B[0].length
  const N = nextPow2(la + lb)
  // their spectra, once each
  const spec = (sig) => {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    re.set(sig)
    fft(re, im, false)
    return { re, im }
  }
  const SA = []
  for (const a of A) { SA.push(spec(a)); await tick() }
  const SB = []
  for (const b of B) { SB.push(spec(b)); await tick() }
  // shifts with at least a minute of overlap (or half the shorter one)
  const minOv = Math.min(60 * cps, Math.floor(Math.min(la, lb) / 2))
  let lagMin = -(la - minOv) // negative = they started later than you
  let lagMax = lb - minOv
  // the start times say roughly where: only look around there
  if (near != null) {
    const lo = Math.max(lagMin, Math.floor((near - range) * cps))
    const hi = Math.min(lagMax, Math.ceil((near + range) * cps))
    if (hi - lo > 10) { lagMin = lo; lagMax = hi }
  }
  const total = SA.length * SB.length
  let done = 0
  const results = []
  for (let ai = 0; ai < SA.length; ai++) {
    for (let bi = 0; bi < SB.length; bi++) {
      const a = SA[ai]
      const b = SB[bi]
      const re = new Float64Array(N)
      const im = new Float64Array(N)
      // conj(A) · B → r[k] = Σ a[n] b[n + k]
      for (let k = 0; k < N; k++) {
        re[k] = a.re[k] * b.re[k] + a.im[k] * b.im[k]
        im[k] = a.re[k] * b.im[k] - a.im[k] * b.re[k]
      }
      fft(re, im, true)
      // read lags lagMin..lagMax, normalised by the overlap
      let best = -Infinity
      let bestLag = 0
      let sum = 0
      let sum2 = 0
      let cnt = 0
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const ov = Math.min(la, lb - lag) - Math.max(0, -lag)
        if (ov < minOv) continue
        const v = re[(lag + N) % N] / Math.sqrt(ov)
        sum += v
        sum2 += v * v
        cnt++
        if (v > best) { best = v; bestLag = lag }
      }
      const mean = sum / cnt
      const sd = Math.sqrt(Math.max(1e-12, sum2 / cnt - mean * mean))
      results.push({ z: (best - mean) / sd, lag: bestLag, ai, bi })
      done++
      if (onProgress) onProgress(done / total)
      await tick()
    }
  }
  results.sort((x, y) => y.z - x.z)
  const top = results[0]
  // how many other track pairs point at (about) the same shift
  const agree = results.filter((r) => r !== top && Math.abs(r.lag - top.lag) <= 2 && r.z > 6).length
  // fine: full rate, ±0.6 s around the coarse answer
  const a = shape(mains[top.ai].t, 1, pps)
  const b = shape(povs[top.bi].t, 1, pps)
  const c0 = top.lag * F
  const R = Math.ceil(0.6 * pps)
  const score = (lag) => {
    const s0 = Math.max(0, -lag)
    const s1 = Math.min(a.length, b.length - lag)
    let s = 0
    for (let n = s0; n < s1; n++) s += a[n] * b[n + lag]
    return s / Math.max(1, s1 - s0)
  }
  let bl = c0
  let bv = -Infinity
  const vals = new Map()
  for (let lag = c0 - R; lag <= c0 + R; lag++) {
    const v = score(lag)
    vals.set(lag, v)
    if (v > bv) { bv = v; bl = lag }
  }
  // a parabola through the peak and its neighbours → between samples
  const y0 = vals.get(bl - 1)
  const y2 = vals.get(bl + 1)
  let frac = 0
  if (y0 != null && y2 != null) {
    const d = y0 - 2 * bv + y2
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d))
  }
  // z of ~8+ is a clear match; 20+ unmistakable
  const confidence = Math.max(0, Math.min(1, (top.z - 6) / 14))
  return { offset: (bl + frac) / pps, confidence, z: top.z, pair: [mains[top.ai].i, povs[top.bi].i], agree, all: results.slice(0, 8).map((r) => ({ z: Math.round(r.z * 10) / 10, off: Math.round((r.lag / cps) * 10) / 10, pair: [mains[r.ai].i, povs[r.bi].i] })) }
}

// A first guess from the recording times (OBS names files by when recording
// started), so the POV is roughly in place before any syncing.
// Prefers the start times written inside both files (OBS stamps them, to the
// second, and they survive copying); else the names / file dates.
export function startOf(c) {
  return (c && c.probe && c.probe.created) || (c && c.recordedAt) || 0
}
export function guessOffset(main, pov) {
  const a = startOf(main)
  const b = startOf(pov)
  if (!a || !b) return 0
  const d = (a - b) / 1000
  return Math.abs(d) < 12 * 3600 ? d : 0
}
// Is the guess trustworthy (both files carry their own start time)?
export const preciseGuess = (main, pov) => !!(main && main.probe && main.probe.created && pov && pov.probe && pov.probe.created)
// How much two recordings overlap in time (seconds; ≤ 0 = not at all).
export function overlap(a, b) {
  const a0 = startOf(a)
  const b0 = startOf(b)
  if (!a0 || !b0) return 0
  const a1 = a0 + ((a.probe && a.probe.duration) || 0) * 1000
  const b1 = b0 + ((b.probe && b.probe.duration) || 0) * 1000
  return (Math.min(a1, b1) - Math.max(a0, b0)) / 1000
}

// ---- sync points: an alignment that changes along the way ----
// A POV normally has one offset (their time − yours). When one of you pauses or
// stops recording while the other keeps going (or one of you splits the recording
// into files), the offset changes at that moment. So a POV can also carry
// pts = [{at, off}] (at: a moment in YOUR recording): from there on, that offset
// holds, until the next point. Before the first point, the POV's own `off`.
// Points are set by hand in the POV sync window ("Start a new part here").
export function offsetAt(p, t) {
  let o = (p && p.off) || 0
  const pts = p && p.pts
  if (pts) for (let i = 0; i < pts.length; i++) { if (pts[i].at <= t) o = pts[i].off; else break }
  return o
}

// A stretch can be cut out: their footage is left out there (gap: true on the point, or on the POV for the first stretch).
export function gapAt(p, t) {
  let g = !!(p && p.gap)
  const pts = p && p.pts
  if (pts) for (let i = 0; i < pts.length; i++) { if (pts[i].at <= t) g = !!pts[i].gap; else break }
  return g
}

// Where in your recording (a..b, seconds) they have footage, one piece per part.
export function coverage(p, mainDur, povDur) {
  const pts = (p && p.pts) || []
  const out = []
  const edges = [0, ...pts.map((x) => x.at), mainDur]
  const offs = [(p && p.off) || 0, ...pts.map((x) => x.off)]
  const gaps = [!!(p && p.gap), ...pts.map((x) => !!x.gap)]
  for (let i = 0; i < offs.length; i++) {
    if (gaps[i]) continue
    const a = Math.max(edges[i], -offs[i])
    const b = Math.min(edges[i + 1], povDur - offs[i])
    if (b > a) out.push({ a, b })
  }
  return out
}
