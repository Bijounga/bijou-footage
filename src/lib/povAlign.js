// Lining a POV up by hand from the timeline (a POV big in Review): slide their
// footage, start a new stretch where the alignment changes, merge it back —
// each a step you can undo. (The alignment itself: lib/povSync.js, offsetAt.)
import { useStore } from '../state/store.js'
import { offsetAt, gapAt } from './povSync.js'

const hist = { undo: [], redo: [], tick: 0 }
const subs = new Set()
export const onAlignHistory = (f) => { subs.add(f); return () => subs.delete(f) }
const changed = () => { hist.tick++; subs.forEach((f) => f()) }
export const alignHistoryInfo = () => ({ canUndo: hist.undo.length > 0, canRedo: hist.redo.length > 0, tick: hist.tick })

const st = () => useStore.getState()
const povOf = (rec, key) => {
  const r = st().reviews[rec]
  return r && (r.povs || []).find((p) => p.key === key)
}
const copyPts = (pts) => (pts ? pts.map((p) => ({ ...p })) : undefined)
const stateOf = (rec, key) => {
  const p = povOf(rec, key)
  return p ? { rec, key, off: p.off || 0, gap: p.gap, pts: copyPts(p.pts) } : null
}

// Call before a change: remembers how the POV is now.
export function pushAlign(key) {
  const e = stateOf(st().currentKey, key)
  if (!e) return
  hist.undo.push(e)
  if (hist.undo.length > 100) hist.undo.shift()
  hist.redo = []
  changed()
}

function apply(e) {
  if (e.rec !== st().currentKey) return false // another recording is open now
  st().updatePov(e.key, { off: e.off, gap: e.gap, pts: copyPts(e.pts), synced: true })
  return true
}
export function undoAlign() {
  const e = hist.undo.pop()
  if (!e) return false
  const now = stateOf(e.rec, e.key)
  if (now) hist.redo.push(now)
  const ok = apply(e)
  changed()
  return ok
}
export function redoAlign() {
  const e = hist.redo.pop()
  if (!e) return false
  const now = stateOf(e.rec, e.key)
  if (now) hist.undo.push(now)
  const ok = apply(e)
  changed()
  return ok
}

// Which stretch of your recording a moment is in: -1 = from the start, else the index of the point.
export function stretchAt(p, t) {
  let k = -1
  const pts = (p && p.pts) || []
  for (let i = 0; i < pts.length; i++) if (pts[i].at <= t + 0.01) k = i
  return k
}

// Slide the stretch that holds moment `t` by dOff seconds (their time under yours), starting from `base`.
// Used live while dragging: pass the same `base` (the stretch's offset at the start of the drag) each time.
export function setStretchOffset(key, t, k, off) {
  const p = povOf(st().currentKey, key)
  if (!p) return
  const o = Math.round(off * 1000) / 1000
  if (k < 0) st().updatePov(key, { off: o, synced: true })
  else st().updatePov(key, { pts: (p.pts || []).map((x, i) => (i === k ? { ...x, off: o } : x)), synced: true })
}

// From moment t on, a new stretch (it starts with the alignment that held there).
export function splitAt(key, t) {
  const p = povOf(st().currentKey, key)
  if (!p) return false
  const at = Math.floor(t * 100) / 100
  if (at <= 0.05) return false
  pushAlign(key)
  const kept = (p.pts || []).filter((x) => Math.abs(x.at - at) > 0.5)
  const next = [...kept, { at, off: offsetAt(p, at), ...(gapAt(p, at) ? { gap: true } : {}) }].sort((a, b) => a.at - b.at)
  st().updatePov(key, { pts: next, synced: true })
  return true
}

// Take the stretch holding moment t away: the one before it carries on.
export function mergeAt(key, t) {
  const p = povOf(st().currentKey, key)
  if (!p) return false
  const k = stretchAt(p, t)
  if (k < 0) return false
  pushAlign(key)
  const next = p.pts.filter((_, i) => i !== k)
  st().updatePov(key, { pts: next.length ? next : undefined, synced: true })
  return true
}

// Cut out (or bring back) their footage for the stretch that holds moment t.
export function cutAt(key, t, on) {
  const p = povOf(st().currentKey, key)
  if (!p) return false
  const k = stretchAt(p, t)
  pushAlign(key)
  if (k < 0) st().updatePov(key, { gap: on ? true : undefined, synced: true })
  else st().updatePov(key, { pts: p.pts.map((x, i) => (i === k ? { ...x, gap: on ? true : undefined } : x)), synced: true })
  return true
}

// Close the gap a cut leaves (a ripple delete in THEIR footage): the stretch after the cut moves up to where the cut
// began, and its offset grows by the cut's length — so their footage carries straight on from what came before the
// cut, with nothing missing in between. Check it by sound afterwards (Shift+drag to fine-tune).
export function closeGapAt(key, t) {
  const p = povOf(st().currentKey, key)
  if (!p) return false
  const k = stretchAt(p, t)
  if (!gapAt(p, t)) return false
  const pts = p.pts || []
  const next = pts[k + 1]
  if (!next) return false // nothing after it to move up
  const from = k < 0 ? 0 : pts[k].at
  const len = next.at - from
  pushAlign(key)
  const moved = { ...next, at: from, off: Math.round((next.off + len) * 1000) / 1000 }
  const rest = pts.filter((_, i) => i !== k && i !== k + 1)
  if (k < 0) {
    // the cut was the first stretch: what follows becomes the first stretch
    st().updatePov(key, { off: moved.off, gap: moved.gap ? true : undefined, pts: rest.length ? rest : undefined, synced: true })
  } else {
    st().updatePov(key, { pts: [...rest, moved].sort((a, b) => a.at - b.at), synced: true })
  }
  return true
}
