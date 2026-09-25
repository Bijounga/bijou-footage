// Speech (activity) detection per audio track, from the waveform peaks the
// app already builds (50 peaks/sec per track, sqrt-curved 0–255 — see
// electron/main/waveform.js). No extra processing pass: it's a noise gate
// over those peaks, which is exactly right for isolated voice tracks like
// OBS's mic and Discord tracks.
//
//   1. Estimate the track's noise floor (a low percentile of its peaks).
//   2. "Talking" = peaks above floor + a margin (the sensitivity setting).
//   3. Bridge short pauses between words, drop tiny blips, pad the edges a
//      little so a skip lands just before the first word.

const cache = new Map() // `${key}|${track}|${sens}` -> segments
const waves = new Map() // clipKey -> parsed waveform {n, pps, len, tracks}

export function setWave(key, wave) {
  if (wave) waves.set(key, wave)
  else waves.delete(key)
  for (const k of cache.keys()) if (k.startsWith(key + '|')) cache.delete(k)
}

export function hasWave(key) {
  return waves.has(key)
}

const GAP_BRIDGE = 0.45 // s — pauses shorter than this stay one segment
const MIN_LEN = 0.2 // s — blips shorter than this are ignored
const PAD_START = 0.12 // s
const PAD_END = 0.2 // s

// sensitivity 0..1 (higher = catches quieter talking). Returns [[start, end], ...] in seconds.
export function speechSegments(key, track, sensitivity = 0.5) {
  const wave = waves.get(key)
  if (!wave || !wave.tracks[track]) return []
  const ck = `${key}|${track}|${sensitivity}`
  if (cache.has(ck)) return cache.get(ck)
  const data = wave.tracks[track]
  const len = wave.len
  const pps = wave.pps

  // Noise floor: 20th percentile of the peaks (histogram — values are bytes).
  const hist = new Uint32Array(256)
  for (let i = 0; i < len; i++) hist[data[i]]++
  let acc = 0
  let floor = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= len * 0.2) { floor = v; break }
  }
  const margin = 50 - 36 * Math.max(0, Math.min(1, sensitivity)) // 50 (strict) … 14 (sensitive)
  const thr = Math.max(22, floor + margin)

  const segs = []
  const bridge = Math.round(GAP_BRIDGE * pps)
  let start = -1
  let lastOn = -1
  for (let i = 0; i < len; i++) {
    if (data[i] >= thr) {
      if (start < 0) start = i
      else if (i - lastOn > bridge) {
        segs.push([start, lastOn])
        start = i
      }
      lastOn = i
    }
  }
  if (start >= 0) segs.push([start, lastOn])
  const out = []
  const dur = len / pps
  for (const [a, b] of segs) {
    if ((b - a + 1) / pps < MIN_LEN) continue
    out.push([Math.max(0, a / pps - PAD_START), Math.min(dur, (b + 1) / pps + PAD_END)])
  }
  cache.set(ck, out)
  return out
}

// Union of several tracks' segments, sorted and merged.
export function mergedSpeech(key, tracks, sensitivity) {
  const all = tracks.flatMap((t) => speechSegments(key, t, sensitivity).map(([a, b]) => [a, b, t]))
  all.sort((x, y) => x[0] - y[0])
  const out = []
  for (const s of all) {
    const last = out[out.length - 1]
    if (last && s[0] <= last[1]) {
      last[1] = Math.max(last[1], s[1])
      if (!last[2].includes(s[2])) last[2].push(s[2])
    } else out.push([s[0], s[1], [s[2]]])
  }
  return out
}

// Every place someone on these tracks STARTS talking, sorted — including a
// start that overlaps someone else still talking (mergedSpeech would fold
// that into one span). Starts within 0.3 s of each other are one stop.
// Returns [[t, [track, ...]], ...].
export function speechStarts(key, tracks, sensitivity) {
  const all = tracks.flatMap((t) => speechSegments(key, t, sensitivity).map(([a]) => [a, t]))
  all.sort((x, y) => x[0] - y[0])
  const out = []
  for (const [a, t] of all) {
    const last = out[out.length - 1]
    if (last && a - last[0] < 0.3) {
      if (!last[1].includes(t)) last[1].push(t)
    } else out.push([a, [t]])
  }
  return out
}
