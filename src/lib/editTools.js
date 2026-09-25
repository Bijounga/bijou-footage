// Automatic cuts for Edit (Phase 2): "Remove silence" and "Cut around".
// Both work the same way: for each clip, work out which parts of its
// recording to KEEP (in source time), then replace the clip with those
// parts. Pure functions — the dialogs preview the result, and applying it
// is one undo step.
import * as EM from './editModel.js'
import { mergedSpeech, hasWave } from './speech.js'

// Sort + merge ranges; ranges closer than joinGap become one.
function merge(ranges, joinGap = 0) {
  const sorted = ranges.filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + joinGap) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

// Replace each targeted clip (ids = Set, or null = every clip) with the
// parts of it that keepFor(clip) returns; a clip with nothing to keep goes.
function applyKeep(clips, ids, keepFor) {
  const out = []
  for (const c of clips) {
    if (ids && !ids.has(c.id)) {
      out.push(c)
      continue
    }
    const keep = keepFor(c)
    if (keep === null) {
      out.push(c) // leave as is (e.g. no waveform yet)
      continue
    }
    const parts = merge(keep)
      .map(([a, b]) => [Math.max(a, c.in), Math.min(b, c.out)])
      .filter(([a, b]) => b - a >= EM.MIN_CLIP)
    parts.forEach(([a, b], k) => out.push({ ...c, id: k === 0 && Math.abs(a - c.in) < 1e-6 && Math.abs(b - c.out) < 1e-6 ? c.id : EM.clipId(), in: a, out: b }))
  }
  return out
}

// Timeline markers sit at a time in the cut. After an automatic cut, move
// each to where its moment of the recording ended up (or the nearest kept
// part of that recording, if its moment was cut).
export function remapMarkers(oldClips, newClips, markers) {
  if (!markers || !markers.length) return markers || []
  const items = EM.layout(newClips).items
  return markers
    .map((m) => {
      const src = EM.toSource(oldClips, m.t)
      if (!src) return null
      let best = null
      let bestD = Infinity
      for (const it of items) {
        if (it.key !== src.key) continue
        const d = src.t < it.in ? it.in - src.t : src.t > it.out ? src.t - it.out : 0
        if (d < bestD) {
          bestD = d
          best = it.start + Math.max(0, Math.min(it.dur, src.t - it.in))
        }
      }
      return best == null ? null : { ...m, t: Math.round(best * 1000) / 1000 }
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t)
}

function stats(before, after) {
  const d0 = EM.totalDuration(before)
  const d1 = EM.totalDuration(after)
  return { before: d0, after: d1, removed: d0 - d1, clipsBefore: before.length, clipsAfter: after.length }
}

// ---- Remove silence ----
// opts: {ids, tracks, padBefore, padAfter, minSilence, sens}
// Keeps where anyone on `tracks` is talking, padded; pauses shorter than
// minSilence stay in (so conversation still breathes).
export function planRemoveSilence(st, clips, opts) {
  let missing = 0
  const next = applyKeep(clips, opts.ids, (c) => {
    if (!hasWave(c.key)) {
      missing++
      return null
    }
    const clip = st.clips.find((x) => x.key === c.key)
    const audio = (clip && clip.probe && clip.probe.audio) || []
    const tracks = opts.tracks.filter((i) => audio[i] && !audio[i].likelySilent)
    if (!tracks.length) return null
    const speech = mergedSpeech(c.key, tracks, opts.sens).filter(([a, b]) => b > c.in - opts.padBefore && a < c.out + opts.padAfter)
    return merge(
      speech.map(([a, b]) => [a - opts.padBefore, b + opts.padAfter]),
      opts.minSilence
    )
  })
  return { clips: next, missing, ...stats(clips, next) }
}

// ---- Cut around markers / beats ----
// opts: {ids, colors: Set (marker colours), types: Set (beat/note types),
//        timeline: bool (timeline markers too), before, after}
export function planCutAround(st, clips, seqMarkers, opts) {
  // Timeline markers → the clip + recording time they sit on.
  const fromTimeline = new Map() // clip id -> [source t]
  if (opts.timeline) {
    for (const m of seqMarkers || []) {
      if (!opts.colors.has(m.color || 'yellow')) continue
      const at = EM.locate(clips, m.t)
      if (!at) continue
      const list = fromTimeline.get(at.clip.id) || []
      list.push(at.clip.in + at.offset)
      fromTimeline.set(at.clip.id, list)
    }
  }
  let hits = 0
  const next = applyKeep(clips, opts.ids, (c) => {
    const notes = (st.reviews[c.key] && st.reviews[c.key].notes) || []
    const ranges = []
    for (const n of notes) {
      const wanted = n.type === 'MARKER' ? opts.colors.has(n.color || 'yellow') : opts.types.has(n.type)
      if (!wanted) continue
      const end = n.end != null ? n.end : n.t
      if (end < c.in || n.t >= c.out) continue
      ranges.push([n.t - opts.before, end + opts.after])
    }
    for (const t of fromTimeline.get(c.id) || []) ranges.push([t - opts.before, t + opts.after])
    hits += ranges.length
    return ranges
  })
  return { clips: next, hits, ...stats(clips, next) }
}

// What's in the cut to choose from: counts per marker colour and beat type.
export function markerCounts(st, clips, seqMarkers) {
  const colors = {}
  const types = {}
  for (const c of clips) {
    for (const n of (st.reviews[c.key] && st.reviews[c.key].notes) || []) {
      if (n.type === 'BREAK' || n.t < c.in || n.t >= c.out) continue
      if (n.type === 'MARKER') colors[n.color || 'yellow'] = (colors[n.color || 'yellow'] || 0) + 1
      else types[n.type] = (types[n.type] || 0) + 1
    }
  }
  const timeline = {}
  for (const m of seqMarkers || []) timeline[m.color || 'yellow'] = (timeline[m.color || 'yellow'] || 0) + 1
  return { colors, types, timeline }
}
