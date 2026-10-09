// A voiceover section as data. Like BijouVoiceover (and an NLE): a clip is
// a window (in → out, seconds) into one of its takes — the recordings made
// for it — and the section plays its clips back to back, no gaps. Cutting,
// trimming, re-recording never touches the WAVs; they're only pointed into.
// Pure functions: each takes the clip list and returns a new one, so undo
// is just keeping the old list.
//
//   clip = { id, takes: [take], take: <selected take id>, in, out, gain?, color? }
//   take = { id, dur, pps, created, marks: [seconds into the take] }
//   (the take's audio: <project>/voiceover/audio/<take id>.wav)

export const MIN_CLIP = 1 / 30 // s — nothing shorter survives an edit

let n = 0
const uid = (p) => p + Date.now().toString(36) + (n++).toString(36)
export const takeId = () => uid('t')
export const clipId = () => uid('v')

export const takeOf = (c) => c.takes.find((t) => t.id === c.take) || c.takes[0]

// Where each clip sits: items {id, take, in, out, start, dur, gain, clip}.
export function layoutVo(clips) {
  let t = 0
  const items = clips.map((c) => {
    const dur = Math.max(0, c.out - c.in)
    const it = { id: c.id, take: c.take, in: c.in, out: c.out, start: t, dur, gain: c.gain, clip: c }
    t += dur
    return it
  })
  return { items, total: t }
}
export const totalVo = (clips) => clips.reduce((a, c) => a + Math.max(0, c.out - c.in), 0)

// The clip under timeline time t: {idx, item} or null.
export function locateVo(clips, t) {
  const { items } = layoutVo(clips)
  const idx = items.findIndex((it) => t < it.start + it.dur - 1e-6)
  return idx < 0 ? null : { idx, item: items[idx] }
}

// Where a new recording goes for the playhead at t: at the end if the
// playhead's at (or past) the end, else just after the clip it's in — so
// recording "here" never cuts into what's already there.
export function insertIndexAt(clips, t) {
  const { items, total } = layoutVo(clips)
  if (!items.length || t >= total - 1e-3) return items.length
  // exactly on a boundary: right there
  const on = items.findIndex((it) => Math.abs(it.start - t) < 1e-3)
  if (on >= 0) return on
  const idx = items.findIndex((it) => t < it.start + it.dur)
  return idx + 1
}

// A finished recording as a new clip, inserted at idx.
export function addRecording(clips, idx, take) {
  const clip = { id: clipId(), takes: [take], take: take.id, in: 0, out: take.dur }
  const next = clips.slice()
  next.splice(idx, 0, clip)
  return { clips: next, clip }
}

// Delete clips; the rest close up (it's a magnetic sequence).
export function removeClips(clips, ids) {
  const set = new Set(ids)
  return clips.filter((c) => !set.has(c.id))
}

// A take's mistake markers, as timeline times (only those inside the clip).
export function marksInCut(clips) {
  const out = []
  for (const it of layoutVo(clips).items) {
    const tk = takeOf(it.clip)
    for (const m of tk.marks || []) if (m >= it.in && m <= it.out) out.push(it.start + m - it.in)
  }
  return out
}

// Every place the timeline has an edge or a mark — what snapping snaps to.
export function snapPoints(clips) {
  const { items, total } = layoutVo(clips)
  const pts = [0, total]
  for (const it of items) pts.push(it.start, it.start + it.dur)
  return pts.concat(marksInCut(clips))
}

// F: cut at timeline time T (splits the clip there).
export function splitAt(clips, T) {
  const at = locateVo(clips, T)
  if (!at) return null
  const { idx, item } = at
  const off = T - item.start
  if (off < MIN_CLIP || item.dur - off < MIN_CLIP) return null
  const c = clips[idx]
  const next = clips.slice()
  next.splice(idx, 1, { ...c, out: c.in + off }, { ...c, id: clipId(), in: c.in + off })
  return next
}

// Cut out the timeline range [a, b): clips are split at its edges, what's
// inside is removed, and everything after closes up (ripple).
export function cutRange(clips, a, b) {
  const { items } = layoutVo(clips)
  const out = []
  for (const it of items) {
    const s = it.start
    const e = s + it.dur
    const c = it.clip
    if (e <= a + 1e-6 || s >= b - 1e-6) {
      out.push(c)
      continue
    }
    const left = a - s // kept at the clip's start
    const right = e - b // kept at its end
    let used = false
    if (left >= MIN_CLIP) {
      out.push({ ...c, out: c.in + left })
      used = true
    }
    if (right >= MIN_CLIP) out.push({ ...c, id: used ? clipId() : c.id, in: c.out - right })
  }
  return out
}

// A / S: ripple-delete everything before / after T within the clip at T.
export function trimBefore(clips, T) {
  const at = locateVo(clips, T)
  return at ? cutRange(clips, at.item.start, T) : null
}
export function trimAfter(clips, T) {
  const at = locateVo(clips, T)
  return at ? cutRange(clips, T, at.item.start + at.item.dur) : null
}

// Drag an edge: the clip's in or out moves to `t` (a time in its take),
// clamped to the recording and never closer than MIN_CLIP to the other edge.
export function trimEdge(clips, id, side, t) {
  return clips.map((c) => {
    if (c.id !== id) return c
    const dur = takeOf(c).dur
    if (side === 'in') return { ...c, in: Math.max(0, Math.min(c.out - MIN_CLIP, t)) }
    return { ...c, out: Math.min(dur, Math.max(c.in + MIN_CLIP, t)) }
  })
}

// Colour clips (a Premiere label name; null = none).
export function colorClips(clips, ids, color) {
  const set = new Set(ids)
  return clips.map((c) => (set.has(c.id) ? { ...c, color: color || undefined } : c))
}

// The level of clips, in dB (0 = as recorded: no gain field).
export function gainClips(clips, ids, db) {
  const set = new Set(ids)
  return clips.map((c) => {
    if (!set.has(c.id)) return c
    const next = { ...c }
    if (Math.abs(db) < 0.05) delete next.gain
    else next.gain = Math.round(db * 10) / 10
    return next
  })
}

// Paste copies (same recordings, new ids) at index idx.
export function pasteClips(clips, idx, copies) {
  const fresh = copies.map((c) => ({ ...c, id: clipId() }))
  const next = clips.slice()
  next.splice(idx, 0, ...fresh)
  return { clips: next, ids: fresh.map((c) => c.id) }
}

// ---- auto-cut silence ----
// BijouVoiceover's presets: below thresholdDb for at least minSilenceMs is
// a gap; paddingMs of the gap is kept around the speech.
export const CUT_PRESETS = {
  aggressive: { label: 'Aggressive', thresholdDb: -38, minSilenceMs: 250, paddingMs: 60 },
  normal: { label: 'Normal', thresholdDb: -45, minSilenceMs: 400, paddingMs: 120 },
  light: { label: 'Light', thresholdDb: -55, minSilenceMs: 600, paddingMs: 200 }
}
const MIN_KEEP = 0.15 // s — a "clip" of speech shorter than this is a click or breath, not a sliver to keep

// The stretches of take-time in [from, to] that hold speech. `pk` are the
// take's peaks: one byte per 1/pps s, the square root of the slice's peak.
export function speechRanges(pk, pps, from, to, o) {
  const thr = Math.pow(10, o.thresholdDb / 20)
  const i0 = Math.max(0, Math.floor(from * pps))
  const i1 = Math.min(pk.length, Math.ceil(to * pps))
  const runs = []
  let start = -1
  for (let i = i0; i < i1; i++) {
    const loud = (pk[i] / 255) ** 2 > thr
    if (loud && start < 0) start = i
    else if (!loud && start >= 0) {
      runs.push([start / pps, i / pps])
      start = -1
    }
  }
  if (start >= 0) runs.push([start / pps, i1 / pps])
  const gap = o.minSilenceMs / 1000
  const pad = o.paddingMs / 1000
  const out = []
  for (const r of runs) {
    const a = Math.max(from, r[0] - pad)
    const b = Math.min(to, r[1] + pad)
    const last = out[out.length - 1]
    // gaps shorter than the minimum (before padding) stay inside the speech
    if (last && r[0] - last.rawEnd < gap) {
      last[1] = b
      last.rawEnd = r[1]
    } else if (last && a <= last[1]) {
      last[1] = b
      last.rawEnd = r[1]
    } else {
      const x = [a, b]
      x.rawEnd = r[1]
      out.push(x)
    }
  }
  return out.filter((r) => r[1] - r[0] >= MIN_KEEP).map((r) => [r[0], r[1]])
}

// Auto-cut the clips in `ids` (all if empty): each is replaced by its
// speech, the silences between are gone. peaksOf(take id) → Uint8Array|null.
export function autoCut(clips, ids, peaksOf, preset) {
  const o = CUT_PRESETS[preset] || CUT_PRESETS.normal
  const set = new Set(ids && ids.length ? ids : clips.map((c) => c.id))
  let removed = 0
  const out = []
  for (const c of clips) {
    const pk = set.has(c.id) ? peaksOf(c.take) : null
    if (!pk) {
      out.push(c)
      continue
    }
    const pps = takeOf(c).pps || 200
    const ranges = speechRanges(pk, pps, c.in, c.out, o)
    if (!ranges.length || (ranges.length === 1 && ranges[0][0] <= c.in + 0.005 && ranges[0][1] >= c.out - 0.005)) {
      out.push(c)
      continue
    }
    ranges.forEach((r, i) => out.push({ ...c, id: i === 0 ? c.id : clipId(), in: r[0], out: r[1] }))
    removed += c.out - c.in - ranges.reduce((a, r) => a + (r[1] - r[0]), 0)
  }
  return { clips: out, removed }
}
