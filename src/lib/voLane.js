// The voiceover lane in Edit: voiceover clips placed on the cut's timeline.
// They are NOT tied to the cuts' lengths — a clip sits wherever you put it
// (`at`, seconds on the section's timeline) and can run across several cuts,
// or several clips can sit under one cut. Pure functions on the list
// (a section's `vo`), so undo is just keeping the old list.
//
//   item = { id, take, in, out, at, gain?, color?, src? }
//          the same window (in → out) into a recorded take as in the
//          Voiceover tab; `src` = the voiceover section it came from (to
//          tint it there once it's placed, and to lay it in again).
import { layoutVo, takeOf, MIN_CLIP } from './voModel.js'

// What a voiceover clip / sentence dragged from the Voiceover panel carries.
export const VO_MIME = 'application/x-bijou-vo'

let n = 0
export const voId = () => 'p' + Date.now().toString(36) + (n++).toString(36)

// For the player: items with start / dur.
export function layoutLane(vo) {
  return vo
    .map((v) => ({ id: v.id, take: v.take, in: v.in, out: v.out, gain: v.gain, start: v.at, dur: Math.max(0, v.out - v.in), item: v }))
    .sort((a, b) => a.start - b.start)
}
export const endOf = (v) => v.at + (v.out - v.in)
export const laneEnd = (vo) => vo.reduce((a, v) => Math.max(a, endOf(v)), 0)

// A whole voiceover section, back to back from \`at\`: the cleaned-up take
// as one run, in order, ready to slide into place.
export function layIn(vo, vs, at) {
  const { items } = layoutVo(vs.clips)
  const fresh = items.map((it) => ({
    id: voId(),
    take: it.take,
    in: it.in,
    out: it.out,
    at: at + it.start,
    gain: it.gain,
    color: it.clip.color,
    src: vs.id,
    srcClip: it.id
  }))
  return { vo: [...vo, ...fresh], ids: fresh.map((f) => f.id) }
}

// One clip of a voiceover section, put at `at`.
// span {a, b} (seconds into the take): only that line of the clip.
export function placeClip(vo, vs, clipId, at, span) {
  const it = layoutVo(vs.clips).items.find((x) => x.id === clipId)
  if (!it) return null
  let inT = it.in
  let outT = it.out
  if (span) {
    // a hair of room either side, so the first / last sound isn't clipped
    inT = Math.max(it.in, span.a - 0.08)
    outT = Math.min(it.out, span.b + 0.12)
    if (outT - inT < 0.05) return null
  }
  const item = { id: voId(), take: it.take, in: inT, out: outT, at: Math.max(0, at), gain: it.gain, color: it.clip.color, src: vs.id, srcClip: it.id }
  return { vo: [...vo, item], id: item.id }
}

// Move clips by dt seconds. ripple: everything that starts at or after the
// first moved clip moves with it (so a run of lines stays in order and keeps
// its spacing); otherwise just the picked ones. Never before 0.
export function moveClips(vo, ids, dt, ripple) {
  const set = new Set(ids)
  const first = Math.min(...vo.filter((v) => set.has(v.id)).map((v) => v.at))
  const dtc = Math.max(dt, -Math.min(...vo.filter((v) => set.has(v.id) || (ripple && v.at >= first - 1e-6)).map((v) => v.at)))
  return vo.map((v) => (set.has(v.id) || (ripple && v.at >= first - 1e-6) ? { ...v, at: v.at + dtc } : v))
}

export function removeClips(vo, ids) {
  const set = new Set(ids)
  return vo.filter((v) => !set.has(v.id))
}

// Delete and close up: what comes after the removed clips moves back by
// their lengths (a ripple delete).
export function rippleRemove(vo, ids) {
  const set = new Set(ids)
  const gone = vo.filter((v) => set.has(v.id)).sort((a, b) => a.at - b.at)
  return vo
    .filter((v) => !set.has(v.id))
    .map((v) => {
      let back = 0
      for (const g of gone) if (g.at < v.at - 1e-6) back += g.out - g.in
      return back ? { ...v, at: Math.max(0, v.at - back) } : v
    })
}

export function splitAt(vo, T) {
  const i = vo.findIndex((v) => T > v.at + MIN_CLIP && T < endOf(v) - MIN_CLIP)
  if (i < 0) return null
  const v = vo[i]
  const off = T - v.at
  const next = vo.slice()
  next.splice(i, 1, { ...v, out: v.in + off }, { ...v, id: voId(), in: v.in + off, at: T })
  return next
}

// Overwrite [a, b): whatever was on the lane there is trimmed away (a clip
// across a or b keeps its outside part; one inside goes), like recording or
// dropping over existing audio in Premiere.
export function clearRange(vo, a, b) {
  const out = []
  for (const v of vo) {
    const s = v.at
    const e = endOf(v)
    if (e <= a + 1e-6 || s >= b - 1e-6) { out.push(v); continue }
    if (s < a - MIN_CLIP) out.push({ ...v, out: v.in + (a - s) })
    if (e > b + MIN_CLIP) out.push({ ...v, id: s < a - MIN_CLIP ? voId() : v.id, in: v.in + (b - s), at: b })
  }
  return out
}

export function colorClips(vo, ids, color) {
  const set = new Set(ids)
  return vo.map((v) => (set.has(v.id) ? { ...v, color: color || undefined } : v))
}
export function gainClips(vo, ids, db) {
  const set = new Set(ids)
  return vo.map((v) => {
    if (!set.has(v.id)) return v
    const x = { ...v }
    if (Math.abs(db) < 0.05) delete x.gain
    else x.gain = Math.round(db * 10) / 10
    return x
  })
}

// Drag one clip's edge to `T` (timeline seconds), like trimming a clip on an
// audio track in Premiere: the other end stays put. It stops at the ends of
// the recorded take (takeDur, if known) and at the clips either side (it
// never runs over a neighbour), and never shorter than MIN_CLIP.
export function trimEdge(vo, id, side, T, takeDur = Infinity) {
  const v = vo.find((x) => x.id === id)
  if (!v) return null
  const others = vo.filter((x) => x.id !== id)
  const end = endOf(v)
  let nv
  if (side === 'in') {
    const prevEnd = others.reduce((a, x) => (endOf(x) <= v.at + 1e-6 ? Math.max(a, endOf(x)) : a), 0)
    const lo = Math.max(prevEnd, v.at - v.in) // can't start before the take does
    const t = Math.max(lo, Math.min(end - MIN_CLIP, T))
    nv = { ...v, at: t, in: v.in + (t - v.at) }
  } else {
    const nextStart = others.reduce((a, x) => (x.at >= end - 1e-6 ? Math.min(a, x.at) : a), Infinity)
    const hi = Math.min(nextStart, v.at + (takeDur - v.in))
    const t = Math.min(hi, Math.max(v.at + MIN_CLIP, T))
    nv = { ...v, out: v.in + (t - v.at) }
  }
  return vo.map((x) => (x.id === id ? nv : x))
}

// Copies of clips (Ctrl+C), put back at `at` (Ctrl+V) keeping their spacing.
export function pasteClips(vo, copied, at) {
  if (!copied || !copied.length) return null
  const first = Math.min(...copied.map((c) => c.at))
  const fresh = copied.map((c) => ({ ...c, id: voId(), at: Math.max(0, at + (c.at - first)) }))
  return { vo: [...vo, ...fresh], ids: fresh.map((f) => f.id) }
}

// Edges (for snapping): every clip's start and end.
export function edges(vo, exceptIds = []) {
  const skip = new Set(exceptIds)
  const out = []
  for (const v of vo) if (!skip.has(v.id)) out.push(v.at, endOf(v))
  return out
}
export { takeOf }

// Ctrl+C / Ctrl+V on the voiceover track (lib/editKeys.js, the clip menu).
let copied = []
export const voClipboard = {
  set(clips) { copied = clips.map((c) => ({ ...c })) },
  get() { return copied }
}
