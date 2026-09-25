import { trackNamesFor } from '../state/store.js'
// Every keyboard action in the app, in one place: its label (what the
// shortcuts window lists, A–Z), its default key(s), and what it does.
// Users can rebind any of them (settings.keybinds overrides the defaults).
//
// Keys are stored as combos like "Shift+M", "Ctrl+Alt+M", "Space", "1",
// built from the physical key (e.code), so they don't depend on keyboard
// layout or on what Shift turns a key into ("Shift+1" not "!").
import { cycleType } from './beats.js'
import { speechStarts, hasWave } from './speech.js'

// Skip to the next/previous moment anyone on the ⇥ tracks starts talking —
// even if someone else is still talking at that point.
function skipSpeech(dir, { st, player, osd }) {
  const clip = st.clips.find((c) => c.key === st.currentKey)
  if (!clip || !hasWave(clip.key)) { osd('Speech markers still preparing…'); return }
  const audio = (clip.probe && clip.probe.audio) || []
  const skip = st.settings.speechSkip || []
  const tracks = audio.map((a, i) => i).filter((i) => skip[i] && !(audio[i] && audio[i].likelySilent))
  if (!tracks.length) { osd('No tracks set to ⇥ skip'); return }
  const segs = speechStarts(clip.key, tracks, st.settings.speechSensitivity ?? 0.5)
  const t = player.getTime()
  const target = dir > 0 ? segs.find((s) => s[0] > t + 0.25) : [...segs].reverse().find((s) => s[0] < t - 1)
  if (!target) { osd(dir > 0 ? 'No more speech' : 'No earlier speech'); return }
  player.seek(target[0], { exact: true })
  osd((dir > 0 ? '▶ ' : '◀ ') + target[1].map((i) => trackNamesFor(st, st.currentKey)[i]).join(' + '))
}

const CODE_NAMES = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*', NumpadDivide: 'Num/', NumpadDecimal: 'Num.'
}
const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

// null for a bare modifier press (still waiting for the real key).
export function comboFromEvent(e) {
  if (MODIFIER_CODES.has(e.code)) return null
  let key = CODE_NAMES[e.code]
  if (!key) {
    let m
    if ((m = /^Key([A-Z])$/.exec(e.code))) key = m[1]
    else if ((m = /^Digit(\d)$/.exec(e.code))) key = m[1]
    else if ((m = /^Numpad(\d)$/.exec(e.code))) key = 'Num' + m[1]
    else if (/^F\d{1,2}$/.test(e.code)) key = e.code
    else key = e.key && e.key.length === 1 ? e.key.toUpperCase() : e.code
  }
  const mods = []
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return [...mods, key].join('+')
}

const PRETTY = { Left: '←', Right: '→', Up: '↑', Down: '↓', Space: 'Space' }
// On a Mac, "Ctrl" in a binding is ⌘ (comboFromEvent counts either), and
// the modifiers show as the Mac symbols.
export const IS_MAC = typeof window !== 'undefined' && window.footage && window.footage.platform === 'darwin'
const MAC_MODS = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' }
export function prettyCombo(combo) {
  if (!combo) return ''
  const parts = combo.split('+').map((p, i, a) => (i === a.length - 1 ? PRETTY[p] || p : IS_MAC ? MAC_MODS[p] || p : p))
  return IS_MAC ? parts.join('') : parts.join(' + ')
}
// Shortcut text written into tooltips / hints ("Ctrl+Shift+\") → Mac symbols.
export function macText(s) {
  if (!IS_MAC || !s) return s
  return s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥')
}

// Short form for the little key hints on buttons ("⇧M").
export function shortCombo(combo) {
  if (!combo) return ''
  if (IS_MAC) return combo.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧').replace(/(Left|Right|Up|Down)$/, (m) => PRETTY[m])
  return combo.replace('Ctrl+', 'Ctrl ').replace('Alt+', 'Alt ').replace('Shift+', '⇧').replace(/(Left|Right|Up|Down)$/, (m) => PRETTY[m])
}

function selectedNote(st) {
  const r = st.currentKey && st.reviews[st.currentKey]
  return r && r.notes.find((n) => n.id === st.selectedNoteId)
}

// ctx: { st, player, bus, osd, e }
// global: also works while typing in a text box (only safe for Ctrl combos).
// needsClip: ignored when no recording is open.
export const ACTIONS = [
  // ---- playback ----
  { id: 'playPause', label: 'Play / pause', cat: 'Playback', keys: ['Space'], needsClip: true, run: ({ player }) => player.toggle() },
  { id: 'stop', label: 'Stop (back to watch speed)', cat: 'Playback', keys: ['K'], needsClip: true, run: ({ player }) => { player.pause(); player.endShuttle() } },
  {
    id: 'shuttleForward', label: 'Shuttle faster', cat: 'Playback', keys: ['B', 'L'], needsClip: true,
    run: ({ player, osd }) => { player.faster(); osd((player.rate < 0 ? '◀◀ ' : '▶ ') + Math.abs(player.rate) + '×') }
  },
  {
    id: 'shuttleBack', label: 'Shuttle slower / reverse', cat: 'Playback', keys: ['J'], needsClip: true,
    run: ({ player, osd }) => { player.slower(); osd((player.rate < 0 ? '◀◀ ' : '▶ ') + Math.abs(player.rate) + '×') }
  },
  {
    id: 'speed1x', label: 'Normal speed (1×)', cat: 'Playback', keys: ['Shift+K'], needsClip: true,
    run: ({ st, player, osd }) => {
      const wasPlaying = player.playing
      player.shuttling = false
      st.setWatchSpeed(1)
      player.setRate(1)
      if (wasPlaying && !player.playing) player.play()
      osd('1×')
    }
  },
  { id: 'skipBack', label: 'Skip back (small)', cat: 'Playback', keys: ['Left'], needsClip: true, run: ({ st, player, osd }) => { player.nudge(-st.settings.skipSmall); osd('−' + st.settings.skipSmall + 's') } },
  { id: 'skipForward', label: 'Skip forward (small)', cat: 'Playback', keys: ['Right'], needsClip: true, run: ({ st, player, osd }) => { player.nudge(st.settings.skipSmall); osd('+' + st.settings.skipSmall + 's') } },
  { id: 'skipBackBig', label: 'Skip back (big)', cat: 'Playback', keys: ['Shift+Left'], needsClip: true, run: ({ st, player, osd }) => { player.nudge(-st.settings.skipBig); osd('−' + st.settings.skipBig + 's') } },
  { id: 'skipForwardBig', label: 'Skip forward (big)', cat: 'Playback', keys: ['Shift+Right'], needsClip: true, run: ({ st, player, osd }) => { player.nudge(st.settings.skipBig); osd('+' + st.settings.skipBig + 's') } },
  { id: 'frameBack', label: 'Previous frame', cat: 'Playback', keys: [','], needsClip: true, run: ({ player }) => player.step(-1) },
  { id: 'frameForward', label: 'Next frame', cat: 'Playback', keys: ['.'], needsClip: true, run: ({ player }) => player.step(1) },
  { id: 'goStart', label: 'Go to start', cat: 'Playback', keys: ['Home'], needsClip: true, run: ({ player }) => player.seek(0) },
  { id: 'goEnd', label: 'Go to end', cat: 'Playback', keys: ['End'], needsClip: true, run: ({ player }) => player.seek(player.duration - 0.5) },
  { id: 'nextSpeech', label: 'Skip to next speech (⇥ tracks)', cat: 'Playback', keys: ['Ctrl+Right'], needsClip: true, run: (ctx) => skipSpeech(1, ctx) },
  { id: 'prevSpeech', label: 'Skip to previous speech (⇥ tracks)', cat: 'Playback', keys: ['Ctrl+Left'], needsClip: true, run: (ctx) => skipSpeech(-1, ctx) },
  { id: 'prevNote', label: 'Previous note / marker', cat: 'Playback', keys: ['['], needsClip: true, run: ({ bus }) => bus.emit('jumpNote', -1) },
  { id: 'nextNote', label: 'Next note / marker', cat: 'Playback', keys: [']'], needsClip: true, run: ({ bus }) => bus.emit('jumpNote', 1) },
  { id: 'prevMarker', label: 'Previous marker', cat: 'Playback', keys: ['Shift+['], needsClip: true, run: ({ bus }) => bus.emit('jumpNote', -1, 'MARKER') },
  { id: 'nextMarker', label: 'Next marker', cat: 'Playback', keys: ['Shift+]'], needsClip: true, run: ({ bus }) => bus.emit('jumpNote', 1, 'MARKER') },
  { id: 'toggleTranscript', label: 'Switch Notes / Transcript / Both', cat: 'View', keys: ['Shift+T'], run: ({ st }) => st.setSideTab({ notes: 'transcript', transcript: 'both', both: 'notes' }[st.settings.sideTab || 'notes'] || 'notes') },
  { id: 'searchTranscript', label: 'Search the transcripts', cat: 'View', keys: ['Ctrl+F'], global: true, run: ({ st, bus }) => { if (st.settings.sideTab !== 'both') st.setSideTab('transcript'); setTimeout(() => bus.emit('focusTranscriptSearch'), 0) } },
  { id: 'gotoTime', label: 'Go to a time (type it)', cat: 'Playback', keys: ['Ctrl+G'], needsClip: true, run: ({ bus }) => bus.emit('gotoTime') },
  { id: 'addToSection', label: 'Add to the open edit section (I … here, or the whole recording)', cat: 'Edit', keys: ['E'], needsClip: true, run: ({ st, player, osd }) => {
    const pin = st.inPoint && st.inPoint.key === st.currentKey && Math.abs(player.getTime() - st.inPoint.t) >= 0.5 ? st.inPoint.t : null
    const t = player.getTime()
    const name = pin != null ? st.addToSection(st.currentKey, Math.min(pin, t), Math.max(pin, t)) : st.addToSection(st.currentKey)
    if (name) {
      osd((pin != null ? 'Added the in → here range' : 'Added the whole recording') + ' to “' + name + '”')
      if (pin != null) st.clearInPoint()
    }
  } },
  { id: 'fullscreen', label: 'Fullscreen video', cat: 'View', keys: ['F'], needsClip: true, run: ({ bus }) => bus.emit('fullscreen') },
  { id: 'appFullscreen', label: 'Full screen (whole app, covers the taskbar)', cat: 'View', keys: ['F11'], global: true, run: () => window.footage.toggleFullscreen() },
  { id: 'prevRecording', label: 'Previous recording', cat: 'Library', keys: ['Ctrl+Up'], run: ({ bus }) => bus.emit('neighbourClip', -1) },
  { id: 'nextRecording', label: 'Next recording', cat: 'Library', keys: ['Ctrl+Down'], run: ({ bus }) => bus.emit('neighbourClip', 1) },

  // ---- notes & markers ----
  { id: 'addBeat', label: 'Add beat (Setup / But / Therefore)', cat: 'Notes', keys: ['M'], needsClip: true, run: ({ st }) => st.addNote('beat') },
  { id: 'addNote', label: 'Add plain note', cat: 'Notes', keys: ['N'], needsClip: true, run: ({ st }) => st.addNote('note') },
  { id: 'addMarker', label: 'Add marker (for Premiere) and name it', cat: 'Notes', keys: ['Shift+M'], needsClip: true, run: ({ st }) => st.addNote('marker') },
  { id: 'quickMarker', label: 'Quick marker (no typing, keeps playing)', cat: 'Notes', keys: ['Q'], needsClip: true, run: ({ st, osd }) => { st.addNote('marker', { quick: true }); osd('Marker') } },
  { id: 'sceneBreak', label: 'Add scene break', cat: 'Notes', keys: ['Shift+B'], needsClip: true, run: ({ st, osd }) => { st.addNote('break'); osd('Scene break') } },
  { id: 'inPoint', label: 'Set in point (for a range beat)', cat: 'Notes', keys: ['I'], needsClip: true, run: ({ st }) => st.setInPoint() },
  { id: 'rangeBeat', label: 'Add range beat (in point → here)', cat: 'Notes', keys: ['O'], needsClip: true, run: ({ st }) => st.addRange() },
  { id: 'logBox', label: 'Type in the log box', cat: 'Notes', keys: ['/'], needsClip: true, run: ({ st, bus }) => { if (st.settings.notesHidden) st.toggleNotesPanel(); setTimeout(() => bus.emit('focusLog'), 0) } },
  {
    id: 'editSelected', label: 'Edit selected note / marker', cat: 'Notes', keys: ['Enter'], needsClip: true,
    run: ({ st }) => { const n = selectedNote(st); if (n && n.type !== 'BREAK') st.selectNote(n.id, true) }
  },
  {
    id: 'deleteSelected', label: 'Delete selected note / marker', cat: 'Notes', keys: ['Delete', 'Backspace'], needsClip: true,
    run: ({ st }) => { const n = selectedNote(st); if (n) st.deleteNote(n.id) }
  },
  {
    id: 'deleteMarkerHere', label: 'Delete marker at playhead', cat: 'Notes', keys: ['Ctrl+Alt+M'], needsClip: true,
    run: ({ st, player, osd }) => {
      const r = st.reviews[st.currentKey]
      const t = player.getTime()
      const near = r && r.notes.filter((n) => n.type === 'MARKER' && Math.abs(n.t - t) <= 0.5).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]
      if (near) { st.deleteNote(near.id); osd('Marker deleted') } else osd('No marker at the playhead')
    }
  },
  { id: 'star', label: 'Star selected note', cat: 'Notes', keys: ['S'], needsClip: true, run: ({ st }) => { const n = selectedNote(st); if (n) st.editNote(n.id, { star: !n.star }) } },
  {
    id: 'cycleType', label: 'Change selected beat type', cat: 'Notes', keys: ['T'], needsClip: true,
    run: ({ st, e }) => { const n = selectedNote(st); if (n && n.type !== 'BREAK' && n.type !== 'MARKER') st.editNote(n.id, { type: cycleType(n.type, e.shiftKey ? -1 : 1) }) }
  },
  { id: 'deselect', label: 'Deselect note', cat: 'Notes', keys: ['Escape'], run: ({ st }) => { if (st.selectedNoteId) st.selectNote(null) } },
  { id: 'undo', label: 'Undo (notes)', cat: 'Notes', keys: ['Ctrl+Z'], run: ({ st }) => st.undoNotes() },
  { id: 'redo', label: 'Redo (notes)', cat: 'Notes', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: ({ st }) => st.redoNotes() },
  {
    id: 'markReviewed', label: 'Mark recording reviewed', cat: 'Library', keys: ['D'], needsClip: true,
    run: ({ st, osd }) => { st.toggleDone(); osd(st.reviews[st.currentKey] && !st.reviews[st.currentKey].done ? 'Marked reviewed' : 'Unmarked') }
  },
  { id: 'startReview', label: 'Start review (this recording)', cat: 'Library', keys: [], needsClip: true, run: ({ st, osd }) => { st.setStarted(st.currentKey, true); osd('Review started') } },

  // ---- timeline ----
  { id: 'zoomIn', label: 'Zoom timeline in', cat: 'Timeline', keys: ['=', 'Shift+='], needsClip: true, run: ({ bus }) => bus.emit('zoom', 1 / 1.6) },
  { id: 'zoomOut', label: 'Zoom timeline out', cat: 'Timeline', keys: ['-'], needsClip: true, run: ({ bus }) => bus.emit('zoom', 1.6) },
  { id: 'zoomFit', label: 'Fit whole recording', cat: 'Timeline', keys: ['\\'], needsClip: true, run: ({ bus }) => bus.emit('fit') },
  { id: 'toggleSkipSilence', label: 'Toggle skip silence (play only the talking)', cat: 'Playback', keys: ['Shift+X'], run: ({ st }) => st.toggleSkipSilence() },
  { id: 'toggleSnap', label: 'Toggle snapping', cat: 'Timeline', keys: ['Shift+S'], run: ({ st }) => st.toggleSnap() },

  // ---- view ----
  { id: 'toggleLibrary', label: 'Hide / show library', cat: 'View', keys: ['Ctrl+\\'], global: true, run: ({ st }) => st.toggleLibrary() },
  { id: 'toggleNotes', label: 'Hide / show notes panel', cat: 'View', keys: ['Ctrl+Shift+\\'], global: true, run: ({ st }) => st.toggleNotesPanel() },
  { id: 'shortcuts', label: 'Keyboard shortcuts', cat: 'View', keys: ['Shift+/'], run: ({ st }) => st.openModal('help') },

  // ---- audio ----
  { id: 'clearSolo', label: 'Clear solo', cat: 'Audio', keys: ['0'], needsClip: true, run: ({ st, osd }) => { st.clearSolo(); osd('Solo cleared') } },
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    {
      id: 'mute' + n, label: `Mute track ${n}`, cat: 'Audio', keys: [String(n)], needsClip: true, track: n - 1,
      run: ({ st, player, osd }) => {
        const i = n - 1
        if (i >= player.trackCount) return
        st.toggleMute(i)
        osd(`${trackNamesFor(st, st.currentKey)[i]} ${st.effectiveMixer()[i].mute ? 'muted' : 'on'}`)
      }
    },
    {
      id: 'solo' + n, label: `Solo track ${n}`, cat: 'Audio', keys: ['Shift+' + n], needsClip: true, track: n - 1,
      run: ({ st, player, osd, getState }) => {
        const i = n - 1
        if (i >= player.trackCount) return
        st.toggleSolo(i, true)
        osd(getState().solo.includes(i) ? `Solo ${trackNamesFor(st, st.currentKey)[i]}` : 'Solo off')
      }
    }
  ])
]

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]))

// Effective bindings: the user's overrides (settings.keybinds[id] = [...])
// where set, else the defaults.
export function bindingsFor(id, overrides) {
  if (overrides && Array.isArray(overrides[id])) return overrides[id]
  return (ACTION_BY_ID[id] && ACTION_BY_ID[id].keys) || []
}

// combo -> action, for dispatch. Later entries don't override earlier ones,
// but the UI prevents duplicates anyway.
export function buildKeymap(overrides) {
  const map = new Map()
  for (const a of ACTIONS) for (const c of bindingsFor(a.id, overrides)) if (!map.has(c)) map.set(c, a)
  return map
}
