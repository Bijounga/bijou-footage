// The edit (a section's cut) as data, and the operations on it. Pure
// functions: each takes the clip list and returns a new one, so undo is
// just keeping the old list.
//
// A section is a list of clips played back to back — a "magnetic" timeline
// with no gaps, so every delete and trim ripples (closes the gap), which
// is how a rough cut is made. A clip is a piece of a recording:
//   {id, key, in, out}   key = the recording, in/out = seconds in it.

export const MIN_CLIP = 1 / 30 // s — nothing shorter survives an edit

// Premiere's 16 clip label colours (names exactly as Premiere uses them, so
// they carry over in the exported XML as <label2>).
export const CLIP_LABELS = [
  ['Violet', '#a990dd'], ['Iris', '#6f82d8'], ['Caribbean', '#1fb3a0'], ['Lavender', '#d78ed5'],
  ['Cerulean', '#1e94d3'], ['Forest', '#5b9a3c'], ['Rose', '#e06b8b'], ['Mango', '#ef9f3a'],
  ['Purple', '#9053c4'], ['Blue', '#3d63cf'], ['Teal', '#1f9c9c'], ['Magenta', '#d33fa6'],
  ['Tan', '#c3a37f'], ['Green', '#48ad47'], ['Brown', '#8c5a34'], ['Yellow', '#e1cf3c']
]
export const CLIP_LABEL_HEX = Object.fromEntries(CLIP_LABELS)

// Colour clips (null = no colour).
export function colorClips(clips, ids, color) {
  const set = new Set(ids)
  return clips.map((c) => (set.has(c.id) ? { ...c, color: color || undefined } : c))
}

let n = 0
export const clipId = () => 'c' + Date.now().toString(36) + (n++).toString(36)

// Where each clip sits on the timeline.
export function layout(clips) {
  let t = 0
  const out = clips.map((c) => {
    const dur = c.out - c.in
    const e = { ...c, start: t, dur }
    t += dur
    return e
  })
  return { items: out, total: t }
}

export const totalDuration = (clips) => clips.reduce((a, c) => a + (c.out - c.in), 0)

// The clip under timeline time T (the later one exactly on a cut).
export function locate(clips, T) {
  let t = 0
  for (let i = 0; i < clips.length; i++) {
    const d = clips[i].out - clips[i].in
    if (T < t + d - 1e-6 || i === clips.length - 1) return { idx: i, clip: clips[i], start: t, offset: Math.max(0, Math.min(d, T - t)) }
    t += d
  }
  return null
}

// Cut points (clip boundaries) on the timeline, for snapping / Up-Down.
export function cutPoints(clips) {
  const pts = [0]
  let t = 0
  for (const c of clips) {
    t += c.out - c.in
    pts.push(t)
  }
  return pts
}

// F / cut tool: split the clip under T in two.
export function split(clips, T) {
  const at = locate(clips, T)
  if (!at) return null
  const { idx, clip, offset } = at
  if (offset < MIN_CLIP || clip.out - clip.in - offset < MIN_CLIP) return null
  const mid = clip.in + offset
  const next = clips.slice()
  next.splice(idx, 1, { ...clip, out: mid }, { ...clip, id: clipId(), in: mid })
  return next
}

// G / Delete: remove clips, closing the gaps.
export function rippleDelete(clips, ids) {
  const set = new Set(ids)
  const next = clips.filter((c) => !set.has(c.id))
  return next.length === clips.length ? null : next
}

// A: cut the clip under T at T and delete the part BEFORE it (from the
// clip's start up to the playhead). The playhead lands on the new cut.
export function trimBefore(clips, T) {
  const at = locate(clips, T)
  if (!at || at.offset < MIN_CLIP) return null
  const { idx, clip, offset, start } = at
  const next = clips.slice()
  if (clip.out - clip.in - offset < MIN_CLIP) next.splice(idx, 1)
  else next[idx] = { ...clip, in: clip.in + offset }
  return { clips: next, playhead: start }
}

// S: cut the clip under T at T and delete the part AFTER it (from the
// playhead to the clip's end). The playhead stays on the new cut.
export function trimAfter(clips, T) {
  const at = locate(clips, T)
  if (!at) return null
  const { idx, clip, offset, start } = at
  const rest = clip.out - clip.in - offset
  if (rest < MIN_CLIP) return null
  const next = clips.slice()
  if (offset < MIN_CLIP) next.splice(idx, 1)
  else next[idx] = { ...clip, out: clip.in + offset }
  return { clips: next, playhead: start + (offset < MIN_CLIP ? 0 : offset) }
}

// Move tool: drag clips to a new position (index in the list without them).
export function move(clips, ids, toIndex) {
  const set = new Set(ids)
  const moving = clips.filter((c) => set.has(c.id))
  if (!moving.length) return null
  const rest = clips.filter((c) => !set.has(c.id))
  const i = Math.max(0, Math.min(rest.length, toIndex))
  const next = [...rest.slice(0, i), ...moving, ...rest.slice(i)]
  return next.every((c, k) => c === clips[k]) ? null : next
}

// Add a recording (or a range of one) at the end, or at an index.
export function add(clips, key, inT, outT, atIndex = clips.length) {
  if (!(outT - inT >= MIN_CLIP)) return null
  const next = clips.slice()
  next.splice(Math.max(0, Math.min(clips.length, atIndex)), 0, { id: clipId(), key, in: inT, out: outT })
  return next
}

// Timeline time → (recording, time in it), and back for a given clip.
export function toSource(clips, T) {
  const at = locate(clips, T)
  return at ? { key: at.clip.key, t: at.clip.in + at.offset, idx: at.idx } : null
}

// Drag a clip's edge (ripple): side 'in' moves where the clip starts in its
// recording, 'out' where it ends; everything after shifts to close / open
// the gap. Limited to the recording (0 … maxOut) and a minimum length.
export function trimEdge(clips, id, side, t, maxOut = Infinity) {
  const i = clips.findIndex((c) => c.id === id)
  if (i < 0) return null
  const c = clips[i]
  const next = clips.slice()
  if (side === 'in') next[i] = { ...c, in: Math.max(0, Math.min(c.out - MIN_CLIP, t)) }
  else next[i] = { ...c, out: Math.min(maxOut, Math.max(c.in + MIN_CLIP, t)) }
  return next
}

// Cut by transcript: remove the timeline stretch a…b (ripple), splitting
// clips at the ends as needed.
export function removeRange(clips, a, b) {
  if (!(b - a > MIN_CLIP)) return null
  let next = clips
  for (const t of [b, a]) {
    const s = split(next, t)
    if (s) next = s
  }
  let t = 0
  const out = []
  for (const c of next) {
    const d = c.out - c.in
    const inside = t >= a - 1e-6 && t + d <= b + 1e-6
    if (!inside) out.push(c)
    t += d
  }
  return out.length === clips.length && out.every((c, i) => c === clips[i]) ? null : out
}

// Keep only these timeline stretches ([[a, b], …]); the rest goes.
export function keepRanges(clips, ranges) {
  const total = totalDuration(clips)
  const keep = ranges.map(([a, b]) => [Math.max(0, a), Math.min(total, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  if (!keep.length) return null
  const gaps = []
  let t = 0
  for (const [a, b] of keep) {
    if (a > t) gaps.push([t, a])
    t = Math.max(t, b)
  }
  if (t < total) gaps.push([t, total])
  let next = clips
  for (const [a, b] of gaps.reverse()) next = removeRange(next, a, b) || next // from the end, so earlier times stay valid
  return next === clips ? null : next
}
