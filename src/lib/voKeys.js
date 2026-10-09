// Keyboard in the Voiceover tab — its own set, like Edit's, and rebindable
// the same way (Keyboard shortcuts → Voiceover keys; the overrides live in
// settings.voKeybinds). Same shape as editKeys.js: {id, label, cat, keys,
// run}. `rec: true` marks the few that still work while a take is being
// recorded — every other key waits until you stop.
import { useStore } from '../state/store.js'
import { useVo } from '../state/voStore.js'
import { voPlayer } from './voPlayer.js'
import { bus } from './hooks.js'

const st = () => useStore.getState()
const vo = () => useVo.getState()
const toast = (t) => st().showToast(t)

// Selected clips louder / quieter by 1 dB.
function levelStep(d) {
  const sec = vo().current()
  const sel = vo().sel
  if (!sec || !sel.length) return
  const c = sec.clips.find((x) => x.id === sel[0])
  const next = Math.max(-24, Math.min(12, ((c && c.gain) || 0) + d))
  vo().setClipGain(next)
  toast((next > 0 ? '+' : '') + next + ' dB')
}

export const VO_ACTIONS = [
  // Record
  { id: 'vo.record', label: 'Record a new clip at the playhead / stop recording', cat: 'Record', keys: ['R'], rec: true, run: () => vo().toggleRecord() },
  { id: 'vo.rerecord', label: 'Re-record the selected clip (or the one at the playhead) — the rest ripples', cat: 'Record', keys: ['Shift+R'], run: () => vo().rerecord() },
  { id: 'vo.punch', label: 'Punch in: record over the stretch you dragged on the waveform', cat: 'Record', keys: ['P'], run: () => vo().punchIn() },
  { id: 'vo.mistake', label: 'Mark a mistake while recording', cat: 'Record', keys: ['M'], rec: true, run: () => { if (vo().markMistake()) toast('Mistake marked') } },
  {
    id: 'vo.cancel',
    label: 'Cancel the count-in / clear the selection',
    cat: 'Record',
    keys: ['Escape'],
    rec: true,
    run: () => {
      const r = vo().rec
      if (r) {
        if (r.phase !== 'recording') vo().cancelRecord()
        return
      }
      vo().setSel([])
      vo().setRange(null)
    }
  },
  // Playback
  { id: 'vo.play', label: 'Play / pause (stops a recording too)', cat: 'Playback', keys: ['Space'], rec: true, run: () => (vo().rec ? vo().toggleRecord() : voPlayer.toggle()) },
  { id: 'vo.faster', label: 'Play, then faster each press — pausing returns to your speed', cat: 'Playback', keys: ['B', 'L'], run: () => (voPlayer.playing ? toast(voPlayer.shuttleStep(1) + '×') : voPlayer.play()) },
  { id: 'vo.slower', label: 'Slower (while playing)', cat: 'Playback', keys: ['J'], run: () => { if (voPlayer.playing) toast(voPlayer.shuttleStep(-1) + '×') } },
  { id: 'vo.stop', label: 'Stop (back to your speed)', cat: 'Playback', keys: ['K'], run: () => voPlayer.pause() },
  { id: 'vo.start', label: 'Go to the start', cat: 'Playback', keys: ['Home'], run: () => voPlayer.seek(0) },
  { id: 'vo.end', label: 'Go to the end', cat: 'Playback', keys: ['End'], run: () => voPlayer.seek(voPlayer.total) },
  { id: 'vo.skipBack', label: 'Skip back', cat: 'Playback', keys: ['Left'], run: () => voPlayer.seek(voPlayer.getTime() - (st().settings.skipSmall || 5)) },
  { id: 'vo.skipFwd', label: 'Skip forward', cat: 'Playback', keys: ['Right'], run: () => voPlayer.seek(voPlayer.getTime() + (st().settings.skipSmall || 5)) },
  // Edit
  { id: 'vo.cut', label: 'Cut at the playhead', cat: 'Edit', keys: ['F'], run: () => vo().splitAtPlayhead() },
  { id: 'vo.select', label: 'Select the clip at the playhead', cat: 'Edit', keys: ['D'], run: () => vo().selectAtPlayhead() },
  { id: 'vo.trimBefore', label: 'Cut away everything before the playhead (in this clip)', cat: 'Edit', keys: ['A'], run: () => vo().trimAroundPlayhead(true) },
  { id: 'vo.trimAfter', label: 'Cut away everything after the playhead (in this clip)', cat: 'Edit', keys: ['S'], run: () => vo().trimAroundPlayhead(false) },
  { id: 'vo.delete', label: 'Ripple delete the selection (a stretch, else the selected clips)', cat: 'Edit', keys: ['G', 'Delete', 'Backspace'], run: () => vo().deleteSelected() },
  { id: 'vo.copy', label: 'Copy the selected clips', cat: 'Edit', keys: ['Ctrl+C'], run: () => vo().copySelected(false) && toast('Copied') },
  { id: 'vo.cutClips', label: 'Cut the selected clips', cat: 'Edit', keys: ['Ctrl+X'], run: () => vo().copySelected(true) },
  { id: 'vo.paste', label: 'Paste at the playhead', cat: 'Edit', keys: ['Ctrl+V'], run: () => vo().paste() },
  { id: 'vo.undo', label: 'Undo', cat: 'Edit', keys: ['Ctrl+Z'], run: () => vo().undoRedo(false) },
  { id: 'vo.redo', label: 'Redo', cat: 'Edit', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: () => vo().undoRedo(true) },
  { id: 'vo.autoCutNormal', label: 'Auto-cut silences — Normal (selected clips, or all)', cat: 'Edit', keys: ['Shift+A'], run: () => vo().autoCut('normal') },
  { id: 'vo.autoCutLight', label: 'Auto-cut silences — Light (only long pauses)', cat: 'Edit', keys: [], run: () => vo().autoCut('light') },
  { id: 'vo.autoCutAggressive', label: 'Auto-cut silences — Aggressive (every short gap)', cat: 'Edit', keys: [], run: () => vo().autoCut('aggressive') },
  { id: 'vo.colorClear', label: 'Remove the colour from the selected clips', cat: 'Edit', keys: [], run: () => vo().colorSelected(null) },
  { id: 'vo.levelReset', label: 'Reset the volume of the selected clips to as recorded', cat: 'Edit', keys: [], run: () => vo().setClipGain(0) },
  { id: 'vo.levelDown', label: 'Selected clips 1 dB quieter', cat: 'Edit', keys: [], run: () => levelStep(-1) },
  { id: 'vo.levelUp', label: 'Selected clips 1 dB louder', cat: 'Edit', keys: [], run: () => levelStep(1) },
  // Tools & view
  { id: 'vo.autoRipple', label: 'Toggle "Cut out instantly" (a dragged stretch is gone when you let go)', cat: 'Tools', keys: ['Q'], run: () => { const on = !st().settings.voAutoRipple; st().updateSettings({ voAutoRipple: on }); toast(on ? 'Cut out instantly: on' : 'Cut out instantly: off') } },
  { id: 'vo.clickSeek', label: 'Toggle "Jump to clicks" (the playhead follows where you click)', cat: 'Tools', keys: ['E'], run: () => { const on = st().settings.voClickSeek === false; st().updateSettings({ voClickSeek: on }); toast(on ? 'Jump to clicks: on' : 'Jump to clicks: off') } },
  { id: 'vo.zoomIn', label: 'Zoom the timeline in', cat: 'Tools', keys: ['=', 'Shift+='], run: () => bus.emit('voZoom', 1) },
  { id: 'vo.zoomOut', label: 'Zoom the timeline out', cat: 'Tools', keys: ['-'], run: () => bus.emit('voZoom', -1) },
  { id: 'vo.zoomFit', label: 'Fit the whole section on screen', cat: 'Tools', keys: ['\\'], run: () => bus.emit('voZoom', 0) },
  { id: 'vo.search', label: 'Search the transcript', cat: 'View', keys: [], run: () => { st().updateSettings({ voTranscript: true }); setTimeout(() => bus.emit('voSearch'), 60) } },
  { id: 'vo.toolSelect', label: 'Move tool (select, drag a stretch, trim edges)', cat: 'Tools', keys: ['V'], run: () => st().updateSettings({ voTool: 'select' }) },
  { id: 'vo.toolCut', label: 'Cut tool (click a clip to cut it)', cat: 'Tools', keys: ['C'], run: () => st().updateSettings({ voTool: 'razor' }) },
  { id: 'vo.snap', label: 'Toggle snapping', cat: 'Tools', keys: ['W'], run: () => { const on = st().settings.voSnap === false; st().updateSettings({ voSnap: on }); toast(on ? 'Snapping on' : 'Snapping off') } },
  { id: 'vo.transcript', label: 'Show / hide the transcript', cat: 'View', keys: ['T'], run: () => st().updateSettings({ voTranscript: st().settings.voTranscript === false }) },
  { id: 'vo.notes', label: 'Show / hide the notes', cat: 'View', keys: ['N'], run: () => st().updateSettings({ voNotes: st().settings.voNotes === false }) }
]
export const VO_BY_ID = Object.fromEntries(VO_ACTIONS.map((a) => [a.id, a]))

// The user's keys for a Voiceover action (settings.voKeybinds overrides).
export function voBindingsFor(id, overrides) {
  if (overrides && Array.isArray(overrides[id])) return overrides[id]
  return (VO_BY_ID[id] && VO_BY_ID[id].keys) || []
}

// combo -> action, rebuilt only when the overrides change.
let cache = null
let cacheFor
export function voKeymap(overrides) {
  if (cache && cacheFor === overrides) return cache
  cache = new Map()
  cacheFor = overrides
  for (const a of VO_ACTIONS) for (const k of voBindingsFor(a.id, overrides)) if (!cache.has(k)) cache.set(k, a)
  return cache
}
