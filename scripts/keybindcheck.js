// Dev check for Phase 3 (keybinds). Uses a recording with no user notes and
// restores everything (bindings, notes, mixer, panels) at the end.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const S = window.__store
  const st = () => S.getState()
  const p = window.__player
  const key = (code, opts = {}, target = window) => target.dispatchEvent(new KeyboardEvent('keydown', { code, key: opts.key || code, bubbles: true, cancelable: true, ...opts }))
  const out = {}
  const before = { clip: st().currentKey, project: st().settings.currentProjectId, keybinds: JSON.parse(JSON.stringify(st().settings.keybinds || {})), mixer: JSON.parse(JSON.stringify(st().settings.mixer)), lib: st().settings.libraryHidden }
  const test = st().clips.find((c) => c.name === '2025-05-31 23-16-01.mp4')
  if ((st().reviews[test.key] || { notes: [] }).notes.length) return 'test clip has notes — abort'
  st().setCurrentProject(null)
  st().openClip(test.key, 600)
  await sleep(1500)
  const notes = () => st().reviews[test.key].notes

  // 1. defaults still work through the new dispatcher
  key('Space', { key: ' ' }); await sleep(400)
  const playing = p.playing
  key('Space', { key: ' ' }); await sleep(300)
  key('KeyM', { key: 'M', shiftKey: true }); await sleep(300)
  const marker = notes().some((n) => n.type === 'MARKER')
  st().finishEditing(false)
  key('Digit2', { key: '2' }); await sleep(100)
  const muted2 = st().effectiveMixer()[1].mute
  key('Digit2', { key: '2' }); await sleep(100)
  key('Digit3', { key: '#', shiftKey: true }); await sleep(100)
  const solo3 = st().solo.includes(2)
  key('Digit0', { key: '0' }); await sleep(100)
  const soloCleared = st().solo.length === 0
  const snapBefore = st().settings.snap
  key('KeyS', { key: 'S', shiftKey: true }); await sleep(100)
  const snapToggled = st().settings.snap !== snapBefore
  key('KeyS', { key: 'S', shiftKey: true }); await sleep(100)
  // global key while typing in the log box
  const ta = document.querySelector('.logbox-input'); ta.focus()
  key('Backslash', { key: '\\', ctrlKey: true }, ta); await sleep(200)
  const libToggledWhileTyping = st().settings.libraryHidden !== before.lib
  key('Backslash', { key: '\\', ctrlKey: true }, ta); await sleep(200)
  ta.blur()
  // delete marker at playhead
  const m = notes().find((n) => n.type === 'MARKER')
  p.seek(m.t + 0.2); await sleep(500)
  key('KeyM', { key: 'm', ctrlKey: true, altKey: true }); await sleep(200)
  const markerDeletedAtPlayhead = !notes().some((n) => n.id === m.id)
  out.defaults = { spacePlays: playing, shiftM_marker: marker, key2_mutes: muted2, shift3_solos: solo3, key0_clearsSolo: soloCleared, shiftS_snap: snapToggled, ctrlBackslash_whileTyping: libToggledWhileTyping, ctrlAltM_deletesMarker: markerDeletedAtPlayhead }

  // 2. shortcuts window: search, A–Z, rebind, conflict, hint follows
  key('Slash', { key: '?', shiftKey: true }); await sleep(300)
  out.window = { opened: st().modal === 'help', rows: document.querySelectorAll('.kb-row').length }
  const labels = [...document.querySelectorAll('.kb-label')].map((e) => e.firstChild.textContent)
  out.window.sortedAZ = labels.every((l, i) => i === 0 || labels[i - 1].localeCompare(l, undefined, { numeric: true }) <= 0)
  const search = document.querySelector('.kb-top .lib-search')
  search.focus(); document.execCommand('insertText', false, 'marker'); await sleep(200)
  out.window.searchMarker = [...document.querySelectorAll('.kb-label')].map((e) => e.firstChild.textContent)
  search.select(); document.execCommand('insertText', false, 'add beat'); await sleep(200)
  // rebind "Add beat" from M to G
  document.querySelector('.kb-row .kb-chip').click(); await sleep(150)
  key('KeyG', { key: 'g' }); await sleep(200)
  out.rebind = { addBeat: st().settings.keybinds.addBeat }
  // conflict: give "Add plain note" the G key → asks, then move it
  search.select(); document.execCommand('insertText', false, 'plain note'); await sleep(200)
  document.querySelector('.kb-row .kb-add').click(); await sleep(150)
  key('KeyG', { key: 'g' }); await sleep(200)
  out.conflict = { banner: (document.querySelector('.kb-conflict') || {}).textContent }
  document.querySelector('.kb-conflict .btn.primary').click(); await sleep(200)
  out.conflict.after = { addBeat: st().settings.keybinds.addBeat, addNote: st().settings.keybinds.addNote }
  key('Escape', { key: 'Escape' }); await sleep(200)
  out.escClosesWindow = st().modal === null
  const hint = [...document.querySelectorAll('.transport .btn')].find((b) => b.textContent.includes('Note'))
  out.buttonHintNowShows = hint && hint.querySelector('kbd') ? hint.querySelector('kbd').textContent : '(none)'
  // G now adds a plain note
  const n0 = notes().length
  key('KeyG', { key: 'g' }); await sleep(300)
  const added = notes()[notes().length - 1]
  out.newKeyWorks = notes().length === n0 + 1 && added && added.type === 'NOTE'
  st().finishEditing(false, true)

  // restore everything
  S.setState((s) => {
    s.settings.keybinds = before.keybinds
    s.settings.mixer = before.mixer
    s.reviews[test.key].notes = []
    s.reviews[test.key].watched = []
    s.reviews[test.key].lastPos = 0
    s.undo = []
    s.redo = []
    s.solo = []
  })
  st().pushMixer()
  if (st().settings.libraryHidden !== before.lib) st().toggleLibrary()
  st().setCurrentProject(before.project)
  if (before.clip) st().openClip(before.clip)
  st().flushSave()
  out.restored = { keybinds: JSON.stringify(st().settings.keybinds) === JSON.stringify(before.keybinds), notes: st().reviews[test.key].notes.length }
  return out
})()
