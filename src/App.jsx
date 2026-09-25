import React, { useEffect } from 'react'
import { useStore } from './state/store.js'
import { player } from './lib/player.js'
import { bus } from './lib/hooks.js'
import { comboFromEvent, buildKeymap } from './lib/keybinds.js'
import Library from './components/Library.jsx'
import PlayerView from './components/PlayerView.jsx'
import Timeline from './components/Timeline.jsx'
import NotesPanel from './components/NotesPanel.jsx'
import { ExportModal, SettingsModal } from './components/Modals.jsx'
import KeybindsModal from './components/Keybinds.jsx'
import AddFootageModal from './components/AddFootage.jsx'
import ColorMenu from './components/ColorMenu.jsx'
import CacheReminder from './components/CacheReminder.jsx'
import { UpdateBanner } from './components/Updates.jsx'
import { startSkipSilence } from './lib/skipSilence.js'
import EditWorkspace from './components/EditWorkspace.jsx'
import { editKeymap } from './lib/editKeys.js'

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
  if (tag === 'INPUT') return !['range', 'checkbox', 'button', 'radio'].includes(el.type)
  return false
}

// Library order as shown in the project (oldest first) or the whole
// library (newest first) — for the Previous / Next recording keys.
function neighbourClip(dir) {
  const st = useStore.getState()
  const project = st.currentProject()
  const pool = project ? project.clipKeys.map((k) => st.clips.find((c) => c.key === k)).filter(Boolean) : st.clips
  const sorted = [...pool].sort((a, b) => (project ? a.recordedAt - b.recordedAt : b.recordedAt - a.recordedAt))
  const i = sorted.findIndex((c) => c.key === st.currentKey)
  return sorted[i + dir] || null
}
bus.on('neighbourClip', (dir) => {
  const c = neighbourClip(dir)
  if (c) useStore.getState().openClip(c.key)
})

// Keymap cache, rebuilt only when the user's bindings change.
let keymapFor = null
let keymap = new Map()
function currentKeymap() {
  const overrides = useStore.getState().settings.keybinds
  if (overrides !== keymapFor) {
    keymap = buildKeymap(overrides)
    keymapFor = overrides
  }
  return keymap
}

function runAction(action, e) {
  e.preventDefault()
  const st = useStore.getState()
  action.run({ st, player, bus, e, osd: (t) => bus.emit('osd', t), getState: useStore.getState })
}

// Global actions (panel toggles) work everywhere, even while typing in a
// note — so they're caught in the capture phase, before a text box can
// swallow the key.
function onGlobalKeys(e) {
  if (useStore.getState().modal) return
  const combo = comboFromEvent(e)
  const action = combo && currentKeymap().get(combo)
  if (action && action.global) {
    e.stopPropagation()
    runAction(action, e)
  }
}

function onKeyDown(e) {
  const st = useStore.getState()
  if (st.modal) {
    if (e.key === 'Escape' && !st.capturingKey) st.closeModal()
    return
  }
  if (isTyping(document.activeElement)) return
  // Range sliders keep focus after a drag; don't let them eat arrow keys.
  if (document.activeElement && document.activeElement.type === 'range') document.activeElement.blur()
  const combo = comboFromEvent(e)
  if (!combo) return
  // Edit mode has its own keys (D/F/G/A/S/…); global ones still work.
  if (st.settings.workspace === 'edit') {
    const ea = editKeymap(st.settings.editKeybinds).get(combo)
    if (ea) runAction(ea, e)
    return
  }
  const action = currentKeymap().get(combo)
  if (!action || action.global) return
  if (action.needsClip && !st.currentKey) return
  runAction(action, e)
}

// The bar between the viewer and the timeline: drag to trade space between
// them (the video shrinks as the timeline grows). Double-click resets.
function Splitter() {
  const setTimelineHeight = useStore((s) => s.setTimelineHeight)
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const center = e.currentTarget.parentElement.getBoundingClientRect()
    const move = (ev) => {
      const h = center.bottom - ev.clientY
      setTimelineHeight(Math.max(110, Math.min(center.height - 140, h)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="splitter" onMouseDown={down} onDoubleClick={() => setTimelineHeight(300)} title="Drag to resize the timeline · double-click to reset" />
}

export default function App() {
  useEffect(() => startSkipSilence(), [])
  const loaded = useStore((s) => s.loaded)
  const modal = useStore((s) => s.modal)
  const toast = useStore((s) => s.toast)
  const hasClip = useStore((s) => !!s.currentKey)
  const libraryHidden = useStore((s) => s.settings.libraryHidden)
  const notesHidden = useStore((s) => s.settings.notesHidden)
  const notesWidth = useStore((s) => s.settings.notesWidth || 360)
  const frameless = useStore((s) => s.frameless)
  const workspace = useStore((s) => s.settings.workspace || 'review')
  // No title bar: the app's top strips become the window's drag handle.
  useEffect(() => { document.body.classList.toggle('frameless', frameless) }, [frameless])

  useEffect(() => {
    useStore.getState().init()
    window.addEventListener('keydown', onGlobalKeys, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onGlobalKeys, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!loaded) return <div className="boot">Loading…</div>
  if (workspace === 'edit') {
    return (
      <>
        <EditWorkspace />
        {modal === 'settings' && <SettingsModal />}
        {modal === 'help' && <KeybindsModal />}
        <CacheReminder />
        <UpdateBanner />
        {toast && <div className={'toast ' + toast.kind} key={toast.id}>{toast.text}</div>}
      </>
    )
  }
  return (
    <div className={'app' + (libraryHidden ? ' lib-hidden' : '') + (notesHidden ? ' notes-hidden' : '')} style={{ '--notes-w': notesWidth + 'px' }}>
      {!libraryHidden && <Library />}
      <section className={'center' + (hasClip ? '' : ' no-clip')}>
        {/* Video and notes side by side on top; the timeline spans the full width under both. */}
        <div className="upper">
          <PlayerView />
          {!notesHidden && <NotesPanel />}
        </div>
        {hasClip && <Splitter />}
        <Timeline />
      </section>
      {modal === 'export' && <ExportModal />}
      {modal === 'addFootage' && <AddFootageModal />}
      <ColorMenu />
      <CacheReminder />
      <UpdateBanner />
      {modal === 'settings' && <SettingsModal />}
      {modal === 'help' && <KeybindsModal />}
      {toast && <div className={'toast ' + toast.kind} key={toast.id}>{toast.text}</div>}
    </div>
  )
}
