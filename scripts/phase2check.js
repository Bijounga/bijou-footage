// Dev check for Phase 2 (projects, explicit status, notes viewer, log box).
// Creates a throwaway project + note and removes both at the end.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const S = window.__store
  const st = () => S.getState()
  const p = window.__player
  const out = {}

  // what the user already has, so we can prove we leave it alone
  const before = { projects: st().projects.length, current: st().settings.currentProjectId, startedCount: Object.values(st().reviews).filter((r) => r.started).length, libraryHidden: st().settings.libraryHidden, clip: st().currentKey }
  if (before.libraryHidden) st().toggleLibrary()
  await sleep(200)
  out.migratedStatus = { startedAfterMigration: before.startedCount, startedFilterRows: 'see below' }

  // 1. project with 3 recordings (added out of order)
  const picks = st().clips.filter((c) => c.probe && c.probe.duration > 600).sort((a, b) => a.recordedAt - b.recordedAt).slice(0, 3)
  const pid = st().createProject('__phase2 test__')
  st().addToProject(pid, [picks[2].key, picks[0].key, picks[1].key])
  await sleep(300)
  const rows = [...document.querySelectorAll('.lib-row')].map((r) => (r.querySelector('.lib-index') || {}).textContent + ' ' + r.querySelector('.lib-name').textContent)
  out.projectLibrary = { picker: document.querySelector('.project-label').textContent, rows }

  // 2. add-footage modal
  st().openModal('addFootage')
  await sleep(300)
  out.addFootageModal = { open: !!document.querySelector('.addf-list'), alreadyInProjectRows: document.querySelectorAll('.addf-row.has').length, totalRows: document.querySelectorAll('.addf-row').length }
  st().closeModal()

  // 3. explicit status: opening + watching doesn't start it; Start review does
  st().openClip(picks[1].key, 100)
  await sleep(1500)
  const statusAfterOpen = (st().reviews[picks[1].key] || {}).started
  await sleep(100)
  document.querySelector('.clip-header .btn.accent') && document.querySelector('.clip-header .btn.accent').click()
  await sleep(200)
  out.status = { afterOpening: !!statusAfterOpen, afterStartReview: st().reviews[picks[1].key].started, headerButtons: [...document.querySelectorAll('.clip-header .btn')].map((b) => b.textContent) }

  // 4. notes viewer groups + log box (stamp = when typing started)
  const groups = [...document.querySelectorAll('.ng-title')].map((e) => e.textContent)
  p.seek(200)
  await sleep(600)
  const ta = document.querySelector('.logbox-input')
  ta.focus()
  document.execCommand('insertText', false, 'Phase 2 test note')
  const stampShown = document.querySelector('.logbox-top .mono').textContent
  p.seek(260) // playhead moves on before Enter
  await sleep(400)
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(300)
  const notes = st().reviews[picks[1].key].notes
  const logged = notes.find((n) => n.text === 'Phase 2 test note')
  out.notesViewer = { groups, stampShown, loggedAt: logged && logged.t, loggedType: logged && logged.type, rowsInCurrentGroup: document.querySelectorAll('.ng.current .note').length, boxClearedAfter: ta.value === '' }

  // 5. hide / show notes panel
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true }))
  await sleep(200)
  const hidden = !document.querySelector('.notes-panel')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true, bubbles: true }))
  await sleep(200)
  out.notesToggle = { hidden, back: !!document.querySelector('.notes-panel') }

  // clean up: note, status, project, previous project selection
  if (logged) st().deleteNote(logged.id, picks[1].key)
  st().setStarted(picks[1].key, false)
  S.setState((s) => {
    const r = s.reviews[picks[1].key]
    if (r && !r.notes.length) { r.watched = []; r.lastPos = 0 }
    s.undo = []
    s.redo = []
  })
  st().deleteProject(pid)
  st().setCurrentProject(before.current)
  if (before.libraryHidden && !st().settings.libraryHidden) st().toggleLibrary()
  if (before.clip) st().openClip(before.clip)
  st().flushSave()
  out.cleanedUp = { projects: st().projects.length === before.projects }
  return out
})()
