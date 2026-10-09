// Keyboard in Edit mode — its own set, so letters can mean editing things
// here (D/F/G/A/S…) and reviewing things in Review. Same shape as the
// Review actions in keybinds.js; global actions (full screen etc.) still
// come from there.
import * as EM from './editModel.js'
import * as VL from './voLane.js'
import { editRecToggle, tapPlace } from './editRecord.js'
import { seqPlayer } from './seqPlayer.js'
import { toggleViewer } from './viewer.js'
import { speechStarts, hasWave } from './speech.js'

// Every place someone on the ⇥ tracks starts talking, in timeline time.
function speechInCut(st) {
  const s = sec(st)
  if (!s) return []
  const skip = st.settings.speechSkip || []
  const sens = st.settings.speechSensitivity ?? 0.5
  const out = []
  for (const it of EM.layout(s.clips).items) {
    if (!hasWave(it.key)) continue
    const clip = st.clips.find((c) => c.key === it.key)
    const audio = (clip && clip.probe && clip.probe.audio) || []
    const tracks = audio.map((a, i) => i).filter((i) => skip[i] && !audio[i].likelySilent)
    for (const [t] of speechStarts(it.key, tracks, sens)) if (t >= it.in && t < it.out) out.push(it.start + t - it.in)
  }
  return out.sort((a, b) => a - b)
}

const sec = (st) => st.currentSection()
const clearSel = (st) => { st.setEditSel([]); st.setVoSel([]) }
const T = () => seqPlayer.getTime()

// The clip under the playhead (id), for D / G.
function clipAtPlayhead(st) {
  const s = sec(st)
  const at = s && EM.locate(s.clips, T())
  return at ? at.clip : null
}

// Zoom presets (Settings → Editing): the selected clips, or the one under
// the playhead. Bind them to mouse gestures (they're just keys).
export const DEFAULT_ZOOM_PRESETS = [175, 225, 325]
function framingTargets(st) {
  if (st.editSel.length) return st.editSel
  const c = clipAtPlayhead(st)
  return c ? [c.id] : []
}
function zoomPreset({ st, osd }, i) {
  const pct = (st.settings.zoomPresets || DEFAULT_ZOOM_PRESETS)[i]
  if (!pct || !st.setClipMotion(framingTargets(st), (m) => ({ ...m, scale: pct }))) return
  osd(pct + '%')
}
function shuttleLabel() {
  const r = seqPlayer.shuttleRate
  return r < 0 ? '◀◀ ' + Math.abs(r) + '×' : r === 0 ? '❚❚' : '▶ ' + r + '×'
}

function nudge(dt) {
  seqPlayer.seek(Math.max(0, Math.min(seqPlayer.total, T() + dt)))
}

// Timeline markers, then the recordings' markers/notes inside the cut.
export function markersInCut(st) {
  const s = sec(st)
  if (!s) return []
  const out = (s.markers || []).map((m) => m.t)
  for (const it of EM.layout(s.clips).items) {
    const notes = (st.reviews[it.key] && st.reviews[it.key].notes) || []
    for (const n of notes) if (n.type === 'MARKER' && n.t >= it.in && n.t < it.out) out.push(it.start + n.t - it.in)
  }
  return out.sort((a, b) => a - b)
}
function jumpMarker(st, dir) {
  const t = T()
  const all = markersInCut(st)
  const target = dir > 0 ? all.find((x) => x > t + 0.05) : [...all].reverse().find((x) => x < t - 0.3)
  if (target != null) seqPlayer.seek(target)
}

// Jump to the previous / next cut point.
function jumpCut(st, dir) {
  const s = sec(st)
  if (!s) return
  const pts = EM.cutPoints(s.clips)
  const t = T()
  const target = dir > 0 ? pts.find((p) => p > t + 1e-3) : [...pts].reverse().find((p) => p < t - 1e-3)
  if (target != null) seqPlayer.seek(target)
}

export const EDIT_ACTIONS = [
  // Playback
  { id: 'e.play', label: 'Play / pause', cat: 'Playback', keys: ['Space'], run: () => seqPlayer.toggle() },
  { id: 'e.stop', label: 'Stop (back to 1×)', cat: 'Playback', keys: ['K'], run: () => seqPlayer.stop() },
  { id: 'e.faster', label: 'Shuttle faster (B / L) — play, then 1.5×, 2× … 10×, then skim', cat: 'Playback', keys: ['B', 'L'], run: ({ osd }) => { seqPlayer.faster(); osd(shuttleLabel()) } },
  { id: 'e.slower', label: 'Shuttle slower / reverse (J)', cat: 'Playback', keys: ['J'], run: ({ osd }) => { seqPlayer.slower(); osd(shuttleLabel()) } },
  { id: 'e.skipBack', label: 'Skip back (small)', cat: 'Playback', keys: ['Left'], run: ({ st, osd }) => { nudge(-(st.settings.skipSmall || 5)); osd('−' + (st.settings.skipSmall || 5) + 's') } },
  { id: 'e.skipFwd', label: 'Skip forward (small)', cat: 'Playback', keys: ['Right'], run: ({ st, osd }) => { nudge(st.settings.skipSmall || 5); osd('+' + (st.settings.skipSmall || 5) + 's') } },
  { id: 'e.skipBackBig', label: 'Skip back (big)', cat: 'Playback', keys: ['Shift+Left'], run: ({ st, osd }) => { nudge(-(st.settings.skipBig || 30)); osd('−' + (st.settings.skipBig || 30) + 's') } },
  { id: 'e.skipFwdBig', label: 'Skip forward (big)', cat: 'Playback', keys: ['Shift+Right'], run: ({ st, osd }) => { nudge(st.settings.skipBig || 30); osd('+' + (st.settings.skipBig || 30) + 's') } },
  { id: 'e.frameBack', label: 'Previous frame', cat: 'Playback', keys: [','], run: () => { seqPlayer.stop(); nudge(-1 / 60) } },
  { id: 'e.frameFwd', label: 'Next frame', cat: 'Playback', keys: ['.'], run: () => { seqPlayer.stop(); nudge(1 / 60) } },
  { id: 'e.prevCut', label: 'Previous cut', cat: 'Playback', keys: ['Up'], run: ({ st }) => jumpCut(st, -1) },
  { id: 'e.nextCut', label: 'Next cut', cat: 'Playback', keys: ['Down'], run: ({ st }) => jumpCut(st, 1) },
  { id: 'e.nextSpeech', label: 'Next speech (⇥ tracks)', cat: 'Playback', keys: ['Ctrl+Right'], run: ({ st, osd }) => {
    const t = T()
    const n = speechInCut(st).find((x) => x > t + 0.25)
    n != null ? seqPlayer.seek(n) : osd('No more speech')
  } },
  { id: 'e.prevSpeech', label: 'Previous speech (⇥ tracks)', cat: 'Playback', keys: ['Ctrl+Left'], run: ({ st, osd }) => {
    const t = T()
    const n = [...speechInCut(st)].reverse().find((x) => x < t - 1)
    n != null ? seqPlayer.seek(n) : osd('No earlier speech')
  } },
  { id: 'e.goto', label: 'Go to a time (type it)', cat: 'Playback', keys: ['Ctrl+G'], run: ({ bus }) => bus.emit('editGotoTime') },
  { id: 'e.start', label: 'Go to start', cat: 'Playback', keys: ['Home'], run: () => seqPlayer.seek(0) },
  { id: 'e.end', label: 'Go to end', cat: 'Playback', keys: ['End'], run: () => seqPlayer.seek(seqPlayer.total) },

  // Editing
  { id: 'e.select', label: 'Select the clip at the playhead', cat: 'Edit', keys: ['D'], run: ({ st, e }) => {
    const c = clipAtPlayhead(st)
    if (!c) return
    st.setEditSel(e && e.shiftKey ? [...new Set([...st.editSel, c.id])] : [c.id])
  } },
  { id: 'e.cut', label: 'Add a cut at the playhead (on the voiceover track too when a voiceover clip there is selected)', cat: 'Edit', keys: ['F'], run: ({ st, osd }) => {
    const s = sec(st)
    if (!s) return
    const t = T()
    // a picked voiceover clip under the playhead is cut too; the picture is
    // cut unless only voiceover is picked
    const v = (s.vo || []).find((x) => st.voSel.includes(x.id) && t > x.at && t < VL.endOf(x))
    const voNext = v && VL.splitAt([v], t) && VL.splitAt(s.vo, t)
    if (voNext && !st.editSel.length) {
      if (st.applyVo(voNext)) osd('Cut voiceover')
      return
    }
    if (st.voSel.length && !st.editSel.length) return osd('No picked voiceover clip at the playhead')
    if (voNext) {
      st.applySection({ clips: EM.split(s.clips, t) || s.clips, vo: voNext }, {})
      st.syncVoLane()
      return osd('Cut')
    }
    if (st.applyEdit(EM.split(s.clips, t))) osd('Cut')
  } },
  { id: 'e.voCopy', label: 'Copy the selected voiceover clips', cat: 'Edit', keys: ['Ctrl+C'], run: ({ st, osd }) => {
    const s = sec(st)
    const picked = ((s && s.vo) || []).filter((x) => st.voSel.includes(x.id))
    if (!picked.length) return osd('Select voiceover clips to copy')
    VL.voClipboard.set(picked)
    osd(picked.length > 1 ? `Copied ${picked.length} voiceover clips` : 'Copied voiceover clip')
  } },
  { id: 'e.voPaste', label: 'Paste voiceover clips at the playhead', cat: 'Edit', keys: ['Ctrl+V'], run: ({ st, osd }) => {
    const s = sec(st)
    const r = s && VL.pasteClips(s.vo || [], VL.voClipboard.get(), T())
    if (!r) return osd('Nothing copied')
    st.setEditSel([])
    if (st.applyVo(r.vo, { select: r.ids })) osd('Pasted')
  } },
  { id: 'e.voDelete', label: 'Voiceover lane: take the selected clips off and close up the gap', cat: 'Edit', keys: ['Shift+Delete', 'Shift+Backspace'], run: ({ st, osd }) => {
    const s = sec(st)
    if (s && st.voSel.length && st.applyVo(VL.rippleRemove(s.vo || [], st.voSel), { select: [] })) osd('Voiceover removed — closed up')
  } },
  { id: 'e.rippleDelete', label: 'Ripple delete the selected clip (or the one at the playhead) — on the voiceover lane it takes the clip off and leaves a gap', cat: 'Edit', keys: ['G', 'Delete', 'Backspace'], run: ({ st, osd }) => {
    const s = sec(st)
    if (!s) return
    if (st.voSel.length && !st.editSel.length) {
      if (st.applyVo(VL.removeClips(s.vo || [], st.voSel), { select: [] })) osd('Voiceover removed')
      return
    }
    // picture AND voiceover picked (a box across both): both go, one undo step
    if (st.voSel.length && st.editSel.length) {
      const items = EM.layout(s.clips).items.filter((c) => st.editSel.includes(c.id))
      st.applySection({ clips: EM.rippleDelete(s.clips, st.editSel), vo: VL.removeClips(s.vo || [], st.voSel) }, { playhead: items.length ? items[0].start : null, select: [] })
      clearSel(st)
      st.syncVoLane()
      return osd('Deleted')
    }
    const ids = st.editSel.length ? st.editSel : [clipAtPlayhead(st)].filter(Boolean).map((c) => c.id)
    if (!ids.length) return
    const first = EM.layout(s.clips).items.find((c) => ids.includes(c.id))
    if (st.applyEdit(EM.rippleDelete(s.clips, ids), { playhead: first ? first.start : null, select: [] })) osd(ids.length === 1 ? 'Deleted clip' : `Deleted ${ids.length} clips`)
  } },
  { id: 'e.trimBefore', label: 'Cut + ripple delete everything BEFORE the playhead (in this clip)', cat: 'Edit', keys: ['A'], run: ({ st }) => {
    const s = sec(st)
    const r = s && EM.trimBefore(s.clips, T())
    if (r) st.applyEdit(r.clips, { playhead: r.playhead })
  } },
  { id: 'e.trimAfter', label: 'Cut + ripple delete everything AFTER the playhead (in this clip)', cat: 'Edit', keys: ['S'], run: ({ st }) => {
    const s = sec(st)
    const r = s && EM.trimAfter(s.clips, T())
    if (r) st.applyEdit(r.clips, { playhead: r.playhead })
  } },
  { id: 'e.snap', label: 'Toggle snapping', cat: 'Edit', keys: ['W'], run: ({ st }) => st.toggleEditSnap() },
  { id: 'e.razor', label: 'Cut tool (click a clip to cut it)', cat: 'Edit', keys: ['C'], run: ({ st }) => st.setEditTool('razor') },
  { id: 'e.zoomPreset1', label: 'Zoom preset 1 on the selected clip (or the one at the playhead) — % in Settings', cat: 'Framing', keys: ['Alt+1'], run: (c) => zoomPreset(c, 0) },
  { id: 'e.zoomPreset2', label: 'Zoom preset 2 — % in Settings', cat: 'Framing', keys: ['Alt+2'], run: (c) => zoomPreset(c, 1) },
  { id: 'e.zoomPreset3', label: 'Zoom preset 3 — % in Settings', cat: 'Framing', keys: ['Alt+3'], run: (c) => zoomPreset(c, 2) },
  { id: 'e.framingReset', label: 'Reset framing (100%, centred) on the selected clip (or the one at the playhead)', cat: 'Framing', keys: ['Alt+0'], run: ({ st, osd }) => { if (st.setClipMotion(framingTargets(st), () => ({ scale: 100, x: 0, y: 0 }))) osd('100%') } },
  { id: 'e.selectTool', label: 'Move tool (select / drag clips)', cat: 'Edit', keys: ['V'], run: ({ st }) => st.setEditTool('select') },
  { id: 'e.deselect', label: 'Clear selection / back to the move tool (stops a voiceover recording)', cat: 'Edit', keys: ['Escape'], run: ({ st }) => {
    if (st.editRec) return editRecToggle()
    st.setEditSel([]); st.setVoSel([]); st.setEditTool('select')
  } },
  { id: 'e.voRecord', label: 'Record voiceover over the cut (from the playhead, after the pre-roll) / stop', cat: 'Voiceover', keys: ['R'], run: () => editRecToggle() },
  { id: 'e.voTap', label: 'Tap to place: the next voiceover line from the strip, at the playhead', cat: 'Voiceover', keys: ['T'], run: () => tapPlace() },
  { id: 'e.selectAll', label: 'Select all clips', cat: 'Edit', keys: ['Ctrl+A'], run: ({ st }) => { const s = sec(st); if (s) st.setEditSel(s.clips.map((c) => c.id)) } },
  { id: 'e.undo', label: 'Undo', cat: 'Edit', keys: ['Ctrl+Z'], run: ({ st }) => st.editUndoRedo(false) },
  { id: 'e.redo', label: 'Redo', cat: 'Edit', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: ({ st }) => st.editUndoRedo(true) },
  { id: 'e.marker', label: 'Marker at the playhead (on the timeline)', cat: 'Edit', keys: ['Q'], run: ({ st, osd }) => {
    if (st.addSeqMarker(T())) osd('Marker')
  } },
  { id: 'e.prevMarker', label: 'Previous marker', cat: 'Playback', keys: ['Shift+['], run: ({ st }) => jumpMarker(st, -1) },
  { id: 'e.nextMarker', label: 'Next marker', cat: 'Playback', keys: ['Shift+]'], run: ({ st }) => jumpMarker(st, 1) },
  { id: 'e.skipSilence', label: 'Toggle skip silence (play only the talking)', cat: 'Playback', keys: ['Shift+X'], run: ({ st }) => st.toggleEditSkipSilence() },
  { id: 'e.sidebar', label: 'Show / hide the left sidebar', cat: 'View', keys: ['Ctrl+\\'], run: ({ st }) => st.toggleEditSidebar() },
  { id: 'e.panel', label: 'Show / hide the Notes / Transcript panel', cat: 'View', keys: ['Ctrl+Shift+\\'], run: ({ st }) => st.toggleEditPanel() },
  { id: 'e.sketch', label: 'Sketch note — draw on the frame', cat: 'View', keys: ['P'], run: ({ st }) => st.openSketch() },
  { id: 'e.viewer', label: 'Viewer window (for a second monitor)', cat: 'View', keys: ['Ctrl+Shift+V'], run: () => toggleViewer() },
  { id: 'e.zoomIn', label: 'Zoom in', cat: 'Timeline', keys: ['=', 'Shift+='], run: ({ bus }) => bus.emit('editZoom', 1) },
  { id: 'e.zoomOut', label: 'Zoom out', cat: 'Timeline', keys: ['-'], run: ({ bus }) => bus.emit('editZoom', -1) },
  { id: 'e.zoomFit', label: 'Fit the whole section', cat: 'Timeline', keys: ['\\'], run: ({ bus }) => bus.emit('editZoom', 0) },
  { id: 'e.export', label: 'Export this section to Premiere', cat: 'Edit', keys: ['Ctrl+E'], run: ({ bus }) => bus.emit('exportSection') }
]

export const EDIT_BY_ID = Object.fromEntries(EDIT_ACTIONS.map((a) => [a.id, a]))

// The user's keys for an Edit action (settings.editKeybinds overrides).
export function editBindingsFor(id, overrides) {
  if (overrides && Array.isArray(overrides[id])) return overrides[id]
  return (EDIT_BY_ID[id] && EDIT_BY_ID[id].keys) || []
}

// combo -> action, rebuilt only when the overrides change.
let cache = null
let cacheFor = undefined
export function editKeymap(overrides) {
  if (cache && cacheFor === overrides) return cache
  cache = new Map()
  cacheFor = overrides
  for (const a of EDIT_ACTIONS) for (const k of editBindingsFor(a.id, overrides)) if (!cache.has(k)) cache.set(k, a)
  return cache
}
