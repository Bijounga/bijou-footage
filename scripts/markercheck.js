// Dev check: markers, bulk delete + undo, timeline click/alt-drag/dblclick,
// notes panel resize. Uses a recording with no user notes and cleans up.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const S = window.__store
  const st = () => S.getState()
  const p = window.__player
  const out = {}
  const before = { clip: st().currentKey, project: st().settings.currentProjectId, notesW: st().settings.notesWidth, markerColor: st().settings.markerColor, libHidden: st().settings.libraryHidden, notesHidden: st().settings.notesHidden }
  const test = st().clips.find((c) => c.name === '2025-05-31 23-16-01.mp4')
  const hadNotes = (st().reviews[test.key] || { notes: [] }).notes.length
  if (hadNotes) return 'test recording has notes — aborting to be safe'
  st().setCurrentProject(null)
  if (st().settings.notesHidden) st().toggleNotesPanel()
  st().openClip(test.key, 600)
  await sleep(1500)
  const notes = () => st().reviews[test.key].notes

  // 1. Shift+M while playing: instant marker, no pause, no editor
  p.play()
  await sleep(500)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', shiftKey: true, bubbles: true }))
  await sleep(300)
  const mk = notes().find((n) => n.type === 'MARKER')
  out.marker = { created: !!mk, color: mk && mk.color, stillPlaying: p.playing, editorOpen: st().editingNoteId === (mk && mk.id) }
  p.pause()
  await sleep(200)

  // 2. color change remembered for the next marker
  st().setMarkerColor(mk.id, 'red', test.key)
  st().addNote('marker', { t: 640 })
  await sleep(200)
  out.markerColors = notes().filter((n) => n.type === 'MARKER').map((n) => n.color)

  // 3. timeline: click on a marker jumps (doesn't move it); alt+drag moves; dblclick edits
  window.__tl.view.current = { start: 590, end: 660 }
  await sleep(300)
  const ov = document.querySelector('.tl-overlay')
  const r = ov.getBoundingClientRect()
  const xOf = (t) => r.left + ((t - 590) / 70) * r.width
  const m1 = notes().find((n) => n.type === 'MARKER')
  const t0 = m1.t
  ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: xOf(t0), clientY: r.top + 8 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(t0) + 60, clientY: r.top + 8 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(400)
  const afterPlainDrag = notes().find((n) => n.id === m1.id).t
  ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, altKey: true, clientX: xOf(t0), clientY: r.top + 8 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOf(t0) + 60, clientY: r.top + 8, altKey: true }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(300)
  const afterAltDrag = notes().find((n) => n.id === m1.id).t
  const m1now = notes().find((n) => n.id === m1.id)
  ov.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: xOf(m1now.t), clientY: r.top + 8 }))
  await sleep(300)
  out.timeline = {
    plainDragMovedIt: afterPlainDrag !== t0,
    selectedAfterClick: st().selectedNoteId === m1.id,
    altDragMovedBy: +(afterAltDrag - t0).toFixed(1),
    dblclickOpensEditor: st().editingNoteId === m1.id && !!document.querySelector('.note.selected .note-input')
  }
  st().finishEditing(false)

  // 4. bulk delete two notes, then one Ctrl+Z restores both
  st().logNote({ t: 650, text: 'bulk test A' })
  st().logNote({ t: 655, text: 'bulk test B' })
  await sleep(200)
  const ids = notes().filter((n) => n.text.startsWith('bulk test')).map((n) => n.id)
  const countBefore = notes().length
  const deleted = st().deleteNotes(ids)
  const countAfterDelete = notes().length
  st().undoNotes()
  out.bulkDelete = { deleted, countBefore, countAfterDelete, afterOneUndo: notes().length }

  // 5. notes panel resize
  const h = document.querySelector('.np-resize')
  const hr = h.getBoundingClientRect()
  h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: hr.left + 3, clientY: hr.top + 100 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: hr.left - 120, clientY: hr.top + 100 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(200)
  out.resize = { widthBefore: before.notesW, widthAfter: st().settings.notesWidth, panelPx: Math.round(document.querySelector('.notes-panel').getBoundingClientRect().width) }

  window.__markercheck = { key: test.key, before }
  return out
})()
