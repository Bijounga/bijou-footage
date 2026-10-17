// The Stream Deck, from the app's side (the plugin is streamdeck/; the
// socket it talks to is electron/main/deckBridge.js). Two jobs:
//   - tell the keys what to show: recording (and for how long), the POVs
//     and which view is big, the workspace — pushed when it changes, and
//     every quarter second while recording so the timer on the key runs
//   - do what a key asks: record / stop, watch a POV big, drop a marker in
//     a colour, run any action from the keybinds lists
import { useStore } from '../state/store.js'
import { useVo } from '../state/voStore.js'
import { player } from './player.js'
import { seqPlayer } from './seqPlayer.js'
import { voRec } from './voRecorder.js'
import { bus } from './hooks.js'
import { editRecToggle } from './editRecord.js'
import { ACTIONS as REVIEW_ACTIONS } from './keybinds.js'
import { EDIT_ACTIONS } from './editKeys.js'
import { VO_ACTIONS } from './voKeys.js'
import { MARKER_COLORS } from './beats.js'
import { POV_COLORS } from '../components/Timeline.jsx'

const api = window.footage
const WS_LABEL = { review: 'Review', edit: 'Edit', voiceover: 'Voiceover' }

// The ones worth a key of their own, offered first in the key's settings.
const IMPORTANT = [
  ['review', 'playPause'], ['review', 'addBeat'], ['review', 'addNote'], ['review', 'sceneBreak'], ['review', 'markReviewed'],
  ['review', 'toggleSkipSilence'], ['review', 'nextSpeech'], ['review', 'prevSpeech'], ['review', 'nextMarker'], ['review', 'prevMarker'], ['review', 'sketch'],
  ['edit', 'e.play'], ['edit', 'e.cut'], ['edit', 'e.rippleDelete'], ['edit', 'e.trimBefore'], ['edit', 'e.trimAfter'], ['edit', 'e.undo'], ['edit', 'e.redo'],
  ['edit', 'e.voTap'], ['edit', 'e.marker'], ['edit', 'e.export'],
  ['voiceover', 'vo.rerecord'], ['voiceover', 'vo.punch'], ['voiceover', 'vo.mistake'], ['voiceover', 'vo.cut'], ['voiceover', 'vo.delete']
]
const LISTS = { review: REVIEW_ACTIONS, edit: EDIT_ACTIONS, voiceover: VO_ACTIONS }

function find(ws, id) {
  return (LISTS[ws] || []).find((a) => a.id === id) || null
}

// Every action, for the key's settings: the important ones, then each
// workspace's whole list.
function catalog() {
  const item = (ws, a) => ({ ws, id: a.id, label: a.label, wsLabel: WS_LABEL[ws] })
  const important = IMPORTANT.map(([ws, id]) => find(ws, id)).map((a, i) => a && item(IMPORTANT[i][0], a)).filter(Boolean)
  const all = []
  for (const ws of ['review', 'edit', 'voiceover']) for (const a of LISTS[ws]) if (!a.global) all.push(item(ws, a))
  return { important, all, workspaces: Object.entries(WS_LABEL).map(([id, label]) => ({ id, label })), markerColors: Object.entries(MARKER_COLORS).map(([id, c]) => ({ id, label: c.label, hex: c.hex })) }
}

// Run an action the way its key would (switching to its workspace first).
function runAction(ws, id) {
  const a = find(ws, id)
  if (!a) return { error: 'Unknown action' }
  const st = useStore.getState()
  if (a.needsClip && !st.currentKey) return { error: 'Open a recording first' }
  if (st.settings.workspace !== ws) st.setWorkspace(ws)
  const e = { preventDefault() {}, stopPropagation() {}, shiftKey: false, ctrlKey: false, altKey: false }
  if (ws === 'voiceover') a.run()
  else a.run({ st: useStore.getState(), player, bus, e, osd: (t) => bus.emit('osd', t), getState: useStore.getState })
  return { ok: true }
}

// ---- what the keys show ----
function recState() {
  const st = useStore.getState()
  const ws = st.settings.workspace
  if (ws === 'edit' && st.editRec) {
    const r = st.editRec
    const t = seqPlayer.getTime()
    return { where: 'edit', phase: r.phase === 'recording' ? 'recording' : r.phase === 'saving' ? 'saving' : 'countdown', seconds: r.phase === 'recording' ? Math.max(0, t - r.start) : 0, countdown: r.phase === 'preroll' ? Math.max(0, r.at - t) : 0 }
  }
  const v = useVo.getState().rec
  if (v) return { where: 'voiceover', phase: v.phase === 'recording' ? 'recording' : 'countdown', seconds: v.phase === 'recording' ? voRec.dur : 0, countdown: v.phase === 'countdown' ? v.count || 0 : 0 }
  return null
}

function snapshot() {
  const st = useStore.getState()
  const ws = st.settings.workspace
  const key = st.currentKey
  const povs = (key && st.reviews[key] && st.reviews[key].povs) || []
  const you = { name: 'You', color: '#e5e7eb', ...(st.settings.povYou || {}) }
  return {
    ready: true,
    workspace: ws,
    canRecord: ws === 'edit' || ws === 'voiceover',
    rec: recState(),
    // POVs only mean something in Review (on the open recording)
    you: { ...you, big: !st.povFocus },
    povs: ws === 'review' ? povs.map((p, i) => ({ slot: i + 1, key: p.key, name: p.name, color: p.color || POV_COLORS[i % POV_COLORS.length], big: st.povFocus === p.key })) : [],
    canMarker: ws === 'review' ? !!key : ws === 'edit' ? !!st.currentSection() : false
  }
}

let lastJson = ''
function push() {
  const s = snapshot()
  const json = JSON.stringify(s)
  if (json === lastJson) return
  lastJson = json
  api.deckState(s)
}

// ---- what the keys ask for ----
async function command(msg) {
  const st = useStore.getState()
  const ws = st.settings.workspace
  switch (msg.type) {
    case 'catalog':
      return catalog()
    case 'action':
      return runAction(msg.ws, msg.action)
    case 'record': {
      if (ws === 'edit') { editRecToggle(); return { ok: true } }
      if (ws === 'voiceover') { useVo.getState().toggleRecord(); return { ok: true } }
      return { error: 'Open Edit or Voiceover to record' }
    }
    case 'pov': {
      if (ws !== 'review') return { error: 'POVs are in Review' }
      if (!msg.slot) { st.setPovFocus(null); return { ok: true } }
      const povs = (st.currentKey && st.reviews[st.currentKey] && st.reviews[st.currentKey].povs) || []
      const p = povs[msg.slot - 1]
      if (!p) return { error: 'No POV ' + msg.slot }
      // pressing the one that's already big goes back to yours
      st.setPovFocus(st.povFocus === p.key ? null : p.key)
      return { ok: true }
    }
    case 'marker': {
      const color = MARKER_COLORS[msg.color] ? msg.color : 'yellow'
      if (ws === 'review' && st.currentKey) {
        st.addNote('marker', { quick: true, color })
        bus.emit('osd', (MARKER_COLORS[color].label || 'Marker') + ' marker')
        return { ok: true }
      }
      if (ws === 'edit' && st.currentSection()) {
        st.addSeqMarker(seqPlayer.getTime(), color)
        bus.emit('osd', (MARKER_COLORS[color].label || 'Marker') + ' marker')
        return { ok: true }
      }
      return { error: 'Open a recording or a section first' }
    }
    case 'workspace':
      if (WS_LABEL[msg.ws]) st.setWorkspace(msg.ws)
      return { ok: true }
    // BijouDocs' Footage tab: open a recording at a note (Review).
    case 'open': {
      // Until startup has reopened the last recording, that reopen would
      // land on top of this one (at its saved position).
      if (!st.libraryReady) return { error: 'not-ready' }
      // An edit section: Edit, that project and section, at the cut's time.
      if (msg.sectionId) {
        if (!st.projects.some((p) => p.id === msg.projectId)) return { error: 'That project isn’t in Bijou Footage' }
        if (st.settings.currentProjectId !== msg.projectId) st.setCurrentProject(msg.projectId)
        if (st.settings.workspace !== 'edit') st.setWorkspace('edit')
        await useStore.getState().loadSections()
        if (!useStore.getState().sections.some((x) => x.id === msg.sectionId)) return { error: 'That section isn’t in Bijou Footage anymore' }
        useStore.getState().setCurrentSection(msg.sectionId)
        if (typeof msg.t === 'number') seqPlayer.seek(msg.t)
        return { ok: true }
      }
      if (!st.clips.length) return { error: 'No recordings in the library' }
      const clip = st.clips.find((c) => c.key === msg.key)
      if (!clip) return { error: 'That recording isn’t in Bijou Footage’s library' }
      if (ws !== 'review') st.setWorkspace('review')
      const t = typeof msg.t === 'number' ? msg.t : undefined
      if (st.currentKey === msg.key && t != null) player.seek(t)
      else st.openClip(msg.key, t)
      if (msg.noteId) {
        useStore.setState((s) => {
          s.selectedNoteId = msg.noteId
          s.settings.notesHidden = false
        })
      }
      return { ok: true }
    }
    default:
      return { error: 'Unknown request' }
  }
}

let started = false
export function startDeck() {
  if (started || !api || !api.deckState) return
  started = true
  api.onDeckCommand(async (msg) => {
    let res
    try {
      res = await command(msg)
    } catch (e) {
      res = { error: String((e && e.message) || e) }
    }
    api.deckReply(msg.cid, res)
    push()
  })
  // when anything a key shows may have changed
  let t = 0
  const soon = () => { clearTimeout(t); t = setTimeout(push, 60) }
  useStore.subscribe(soon)
  useVo.subscribe(soon)
  // the recording timer on the key
  setInterval(() => { if (recState()) push() }, 250)
  push()
}
