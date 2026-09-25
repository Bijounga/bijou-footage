import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import TranscriptPanel from './TranscriptPanel.jsx'
import ProjectPad from './ProjectPad.jsx'
import { player } from '../lib/player.js'
import { usePlayerDerived, bus } from '../lib/hooks.js'
import { fmtTime, fmtDay } from '../lib/time.js'
import { TYPES, LABEL, DEFAULT_COLORS, MARKER_COLORS, DEFAULT_MARKER_COLOR, cycleType, pickDefaultType, noteHex } from '../lib/beats.js'
import { clipTitle } from './Library.jsx'

export function useBeatColor() {
  const colors = useStore((s) => s.beatColors)
  return (type) => (colors && colors[type]) || DEFAULT_COLORS[type] || '#888'
}

// Color for a whole note (markers have their own color).
function useNoteColor() {
  const colors = useStore((s) => s.beatColors)
  return (n) => noteHex(n, colors)
}

export function markerLabel(n) {
  return (MARKER_COLORS[n.color] || MARKER_COLORS[DEFAULT_MARKER_COLOR]).label
}

// Marker color picker: the 8 Premiere marker colors.
function MarkerColorButton({ n, clipKey }) {
  const setMarkerColor = useStore((s) => s.setMarkerColor)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <span className="mk-wrap" ref={ref}>
      <button className="type-pill marker-pill" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} title="Marker color">
        <span className="mk-shield" /> {markerLabel(n)}
      </button>
      {open && (
        <div className="mk-palette" onMouseDown={(e) => e.stopPropagation()}>
          {Object.entries(MARKER_COLORS).map(([k, c]) => (
            <button
              key={k}
              className={'mk-swatch' + ((n.color || DEFAULT_MARKER_COLOR) === k ? ' on' : '')}
              style={{ '--c': c.hex }}
              title={c.label}
              onClick={(e) => { e.stopPropagation(); setMarkerColor(n.id, k, clipKey); setOpen(false) }}
            />
          ))}
        </div>
      )}
    </span>
  )
}

function autosize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => useStore.getState().showToast('Copied'),
    () => useStore.getState().showToast('Copy failed', 'error')
  )
}

function noteLine(n) {
  const at = fmtTime(n.t) + (n.end != null ? '–' + fmtTime(n.end) : '')
  const label = n.type === 'MARKER' ? markerLabel(n) + ' marker' : LABEL[n.type]
  return `${at}  ${label}${n.star ? ' ★' : ''} — ${n.text || ''}`.trimEnd()
}

function NoteRow({ n, clipKey, isCurrentClip, active, color, checked, onPick, onAnchor }) {
  const selected = useStore((s) => s.selectedNoteId === n.id)
  const editing = useStore((s) => s.editingNoteId === n.id)
  const selectNote = useStore((s) => s.selectNote)
  const updateNote = useStore((s) => s.updateNote)
  const editNote = useStore((s) => s.editNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const finishEditing = useStore((s) => s.finishEditing)
  const openClip = useStore((s) => s.openClip)
  const ref = useRef(null)
  const taRef = useRef(null)

  useEffect(() => {
    if (selected && ref.current) ref.current.scrollIntoView({ block: 'nearest' })
  }, [selected])
  useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      autosize(ta)
    }
  }, [editing])

  const jump = () => {
    if (isCurrentClip) player.seek(n.t)
    else openClip(clipKey, n.t)
    selectNote(n.id)
  }

  if (n.type === 'BREAK') {
    return (
      <div ref={ref} className={'note-break' + (selected ? ' selected' : '')} onClick={jump}>
        <span>Scene break · {fmtTime(n.t)}</span>
        <button className="x-btn" onClick={(e) => { e.stopPropagation(); deleteNote(n.id, clipKey) }} title="Delete">×</button>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={'note' + (selected ? ' selected' : '') + (active ? ' active' : '') + (checked ? ' checked' : '')}
      style={{ '--c': color(n) }}
      onMouseDown={(e) => {
        if (e.button !== 0 || e.target.closest('button, textarea, input')) return
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault()
          onPick(e)
          return
        }
        onAnchor() // a plain click is the starting point for Shift+click
        jump()
      }}
      onDoubleClick={(e) => {
        if (e.target.closest('button, textarea, input')) return
        if (!isCurrentClip) openClip(clipKey, n.t)
        selectNote(n.id, true)
      }}
      onContextMenu={(e) => {
        if (n.type !== 'MARKER' || e.target.closest('textarea')) return
        e.preventDefault()
        useStore.getState().openColorMenu({ x: e.clientX, y: e.clientY, noteId: n.id, clipKey })
      }}
    >
      <div className="note-top">
        <input
          type="checkbox"
          className="note-check"
          checked={checked}
          readOnly
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(e) }}
          title="Select · Shift+click to select a range · Ctrl+click to toggle"
        />
        <button className="tc" onClick={(e) => { e.stopPropagation(); jump() }} title="Jump here">
          {fmtTime(n.t)}{n.end != null ? '–' + fmtTime(n.end) : ''}
        </button>
        {n.type === 'MARKER' ? (
          <MarkerColorButton n={n} clipKey={clipKey} />
        ) : (
          <button
            className="type-pill"
            onClick={(e) => { e.stopPropagation(); editNote(n.id, { type: cycleType(n.type, e.shiftKey ? -1 : 1) }, clipKey) }}
            onContextMenu={(e) => { e.preventDefault(); editNote(n.id, { type: cycleType(n.type, -1) }, clipKey) }}
            title="Click to cycle type"
          >
            {LABEL[n.type]}
          </button>
        )}
        {n.exportedAt && <span className="sent" title={'Sent to BijouDocs ' + new Date(n.exportedAt).toLocaleString()}>↗</span>}
        <span className="grow" />
        <span className="note-actions">
          <button className={'star' + (n.star ? ' on' : '')} onClick={(e) => { e.stopPropagation(); editNote(n.id, { star: !n.star }, clipKey) }} title="Star (S)">★</button>
          <button className="act" onClick={(e) => { e.stopPropagation(); copy(noteLine(n)) }} title="Copy">⧉</button>
          <button className="act" onClick={(e) => { e.stopPropagation(); if (!isCurrentClip) openClip(clipKey, n.t); selectNote(n.id, true) }} title="Edit">✎</button>
          <button className="act x" onClick={(e) => { e.stopPropagation(); deleteNote(n.id, clipKey) }} title="Delete (Del)">×</button>
        </span>
      </div>
      {editing ? (
        <textarea
          ref={taRef}
          className="note-input"
          rows={1}
          value={n.text}
          placeholder={n.type === 'MARKER' ? 'Marker name (optional) — Enter to save' : 'What happens here? (Enter to save, Tab to change type)'}
          onChange={(e) => { updateNote(n.id, { text: e.target.value }, clipKey); autosize(e.target) }}
          onBlur={() => finishEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEditing(true) }
            else if (e.key === 'Escape') { e.preventDefault(); finishEditing(true, true) }
            else if (e.key === 'Tab') { e.preventDefault(); if (n.type !== 'MARKER') editNote(n.id, { type: cycleType(n.type, e.shiftKey ? -1 : 1) }, clipKey) }
            e.stopPropagation()
          }}
        />
      ) : (
        n.text && <div className="note-text">{n.text}</div>
      )}
    </div>
  )
}

// "Type what happened": timestamp is taken when you START typing, so a
// slow typist still lands the note on the moment itself. Doesn't pause.
function LogBox({ clipKey }) {
  const logNote = useStore((s) => s.logNote)
  const color = useBeatColor()
  const [text, setText] = useState('')
  const [stamp, setStamp] = useState(null)
  const [type, setType] = useState(null) // null = auto (Setup / But / Therefore)
  const ref = useRef(null)
  useEffect(() => { setText(''); setStamp(null); setType(null) }, [clipKey])
  useEffect(() => bus.on('focusLog', () => ref.current && ref.current.focus()), [])

  const autoType = () => {
    const st = useStore.getState()
    const r = st.reviews[clipKey]
    const t = stamp != null ? stamp : player.getTime()
    return pickDefaultType(r ? r.notes.filter((n) => n.t <= t) : [])
  }
  const shownType = type || autoType()

  return (
    <div className={'logbox' + (text ? ' typing' : '')} style={{ '--c': color(shownType) }}>
      <button
        className="type-pill logbox-type"
        onClick={(e) => setType(cycleType(shownType, e.shiftKey ? -1 : 1))}
        title={(type ? 'Beat type — click or Tab to change' : 'Auto beat type (like M) — click or Tab to choose') + ' · the note is stamped at the moment you start typing'}
      >
        {LABEL[shownType]}
      </button>
      <textarea
        ref={ref}
        className="logbox-input"
        rows={1}
        value={text}
        disabled={!clipKey}
        placeholder={clipKey ? 'Type what happened…' : 'Open a recording first'}
        onChange={(e) => {
          if (stamp == null && e.target.value.trim()) setStamp(player.getTime())
          if (!e.target.value.trim()) setStamp(null)
          setText(e.target.value)
          autosize(e.target)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (text.trim()) {
              logNote({ t: stamp != null ? stamp : player.getTime(), type, text })
              setText('')
              setStamp(null)
              setType(null)
              e.target.style.height = ''
            }
          } else if (e.key === 'Tab') {
            e.preventDefault()
            setType(cycleType(shownType, e.shiftKey ? -1 : 1))
          } else if (e.key === 'Escape') {
            setText('')
            setStamp(null)
            e.target.style.height = ''
            e.target.blur()
          }
        }}
      />
    </div>
  )
}

export default function NotesPanel() {
  const clips = useStore((s) => s.clips)
  const reviews = useStore((s) => s.reviews)
  const currentKey = useStore((s) => s.currentKey)
  const project = useStore((s) => s.currentProject())
  const openModal = useStore((s) => s.openModal)
  const setExportSelection = useStore((s) => s.setExportSelection)
  const toggleNotesPanel = useStore((s) => s.toggleNotesPanel)
  const openClip = useStore((s) => s.openClip)
  const deleteNotes = useStore((s) => s.deleteNotes)
  const setNotesWidth = useStore((s) => s.setNotesWidth)
  const sideTab = useStore((s) => s.settings.sideTab || 'notes')
  const setSideTab = useStore((s) => s.setSideTab)
  const both = sideTab === 'both'
  const pad = sideTab === 'pad'
  const showNotes = sideTab === 'notes' || both
  const showTx = sideTab === 'transcript' || both
  const split = useStore((s) => s.settings.sideSplit ?? 0.5) // notes' share of the width, side by side
  const swap = useStore((s) => !!s.settings.sideSwap) // transcript on the left
  const bodyRef = useRef(null)
  function dragSplit(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const box = bodyRef.current.getBoundingClientRect()
    const move = (ev) => {
      let f = (ev.clientX - box.left) / box.width
      if (swap) f = 1 - f
      useStore.getState().updateSettings({ sideSplit: Math.max(0.15, Math.min(0.85, f)) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew')
    }
    document.body.classList.add('resizing-ew')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const color = useBeatColor()
  const noteColor = useNoteColor()
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [types, setTypes] = useState(() => new Set([...TYPES, 'MARKER']))
  const [starred, setStarred] = useState(false)
  const [unsent, setUnsent] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const currentGroupRef = useRef(null)
  const zoom = useStore((s) => s.settings.notesZoom || 1)
  const colorBars = useStore((s) => !!s.settings.noteColorBars)
  const setNotesZoom = useStore((s) => s.setNotesZoom)
  const listRef = useRef(null)
  // Ctrl+scroll over the notes zooms the text (native listener: React's
  // wheel handler is passive and couldn't stop the page from zooming).
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const z = useStore.getState().settings.notesZoom || 1
      useStore.getState().setNotesZoom(z + (e.deltaY < 0 ? 0.1 : -0.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef(null)
  useEffect(() => {
    if (!exportOpen) return
    const close = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [exportOpen])

  // Groups: the project's recordings in story order (with "n/N"), or in
  // All footage, every recording that has notes plus the one that's open.
  const groups = useMemo(() => {
    const scope = project
      ? project.clipKeys.map((k) => clips.find((c) => c.key === k)).filter(Boolean)
      : clips.filter((c) => c.key === currentKey || (reviews[c.key] && reviews[c.key].notes.length))
    const sorted = scope.slice().sort((a, b) => a.recordedAt - b.recordedAt)
    const text = q.trim().toLowerCase()
    const filtering = text || starred || unsent || types.size !== TYPES.length + 1
    return sorted.map((c, i) => {
      const all = (reviews[c.key] && reviews[c.key].notes) || []
      const notes = all.filter(
        (n) =>
          (n.type === 'BREAK' && !filtering) ||
          (n.type !== 'BREAK' && types.has(n.type) && (!starred || n.star) && (!unsent || !n.exportedAt) && (!text || (n.text || '').toLowerCase().includes(text)))
      )
      return { c, index: i + 1, total: sorted.length, notes, count: all.filter((n) => n.type !== 'BREAK').length }
    })
  }, [clips, reviews, project, currentKey, q, starred, unsent, types])

  useEffect(() => {
    if (currentGroupRef.current) currentGroupRef.current.scrollIntoView({ block: 'nearest' })
  }, [currentKey])

  const visibleIds = groups.flatMap((g) => g.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id))
  const chosen = visibleIds.filter((id) => sel.has(id))
  // What exports: the ticked notes if any; otherwise just the recording
  // that's open. "Select all" is how you export the whole project.
  const currentGroup = groups.find((g) => g.c.key === currentKey)
  const currentIds = currentGroup ? currentGroup.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id) : []
  const target = chosen.length ? chosen : currentIds
  const allSelected = visibleIds.length > 0 && chosen.length === visibleIds.length
  const targetRecordings = new Set(groups.filter((g) => g.notes.some((n) => target.includes(n.id))).map((g) => g.c.key)).size
  // Click = toggle one; Shift+click = tick everything between the last
  // clicked note and this one, in the order they're shown (collapsed
  // recordings are skipped). Works across recordings.
  const anchorRef = useRef(null)
  const shownIds = groups.filter((g) => !collapsed.has(g.c.key)).flatMap((g) => g.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id))
  function pick(id, e) {
    const a = anchorRef.current
    if (e.shiftKey && a && a !== id && shownIds.includes(a) && shownIds.includes(id)) {
      const [i, j] = [shownIds.indexOf(a), shownIds.indexOf(id)].sort((x, y) => x - y)
      toggleSel(shownIds.slice(i, j + 1), true)
    } else {
      toggleSel([id], !sel.has(id))
      anchorRef.current = id
    }
  }
  const toggleSel = (ids, on) =>
    setSel((s) => {
      const n = new Set(s)
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
      return n
    })

  // The note under the playhead: re-renders the list only when it changes,
  // not several times a second while playing.
  const curNotes = currentKey && reviews[currentKey] ? reviews[currentKey].notes : null
  const activeId = usePlayerDerived(
    (t) => {
      let id = null
      if (curNotes) for (const n of curNotes) if (n.t <= t + 0.05) id = n.id
      return id
    },
    [curNotes],
    200
  )

  async function exportPremiere(kind) {
    const ids = new Set(target)
    const payload = groups
      .map((g) => ({ path: g.c.path, name: g.c.name, probe: g.c.probe, notes: g.notes.filter((n) => ids.has(n.id)).map((n) => ({ t: n.t, end: n.end, type: n.type, text: n.text, star: n.star, color: n.color })) }))
      .filter((g) => g.notes.length)
    const file = await window.footage.exportPremiere(payload, kind, project ? project.name : 'Footage notes')
    if (file) useStore.getState().showToast((kind === 'csv' ? 'CSV' : 'Premiere XML') + ' saved: ' + file)
  }

  const totalNotes = groups.reduce((a, g) => a + g.count, 0)

  return (
    <aside className={'notes-panel' + (colorBars ? ' color-bars' : '')}>
      <div
        className="np-resize"
        title="Drag to resize the notes panel · double-click to reset"
        onDoubleClick={() => setNotesWidth(360)}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          const move = (ev) => setNotesWidth(window.innerWidth - ev.clientX)
          const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            document.body.classList.remove('resizing-ew')
          }
          document.body.classList.add('resizing-ew')
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      />
      <div className="np-head">
        <div className="np-title">
          <div className="np-tabs">
            <button className={sideTab === 'notes' ? 'on' : ''} onClick={() => setSideTab('notes')} title="Notes (Shift+T switches)">
              Notes <span className="count">{totalNotes}</span>
            </button>
            <button className={sideTab === 'transcript' ? 'on' : ''} onClick={() => setSideTab('transcript')} title="Transcript + search (Shift+T switches · Ctrl+F searches)">
              Transcript
            </button>
            <button className={both ? 'on' : ''} onClick={() => setSideTab('both')} title="Notes and transcript side by side — drag the line between them to resize">
              ◫ Both
            </button>
            <button className={'np-pad-tab' + (pad ? ' on' : '')} onClick={() => setSideTab('pad')} title="Project notes — checklists and notes for the whole project, shared with Edit">
              ☑ Project
            </button>
          </div>
          {both && <button className="icon-btn small np-swap" onClick={() => useStore.getState().updateSettings({ sideSwap: !swap })} title="Swap sides">⇄</button>}
          {sideTab === 'notes' && <span className="dim small np-scope">{project ? project.name : 'All footage'}</span>}
        </div>
        {!pad && <div className="np-zoom" title="Note text size · Ctrl+scroll over the notes also zooms">
          <button onClick={() => setNotesZoom((useStore.getState().settings.notesZoom || 1) - 0.1)} disabled={zoom <= 0.7}>−</button>
          <button className="np-zoom-pct" onClick={() => setNotesZoom(1)} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setNotesZoom((useStore.getState().settings.notesZoom || 1) + 0.1)} disabled={zoom >= 2}>+</button>
        </div>}
        {showNotes && <div className="np-export" ref={exportRef}>
          <button className={'np-export-btn' + (exportOpen ? ' on' : '')} onClick={() => setExportOpen(!exportOpen)} title="Send to BijouDocs, or export for Premiere / CSV">
            Export ▾
          </button>
          {exportOpen && (
            <div className="menu np-export-menu">
              <div className="menu-title dim small">
                {chosen.length
                  ? `${chosen.length} selected note${chosen.length === 1 ? '' : 's'} · ${targetRecordings} recording${targetRecordings === 1 ? '' : 's'}`
                  : currentKey
                    ? `This recording · ${currentIds.length} note${currentIds.length === 1 ? '' : 's'}`
                    : 'Open a recording or tick notes first'}
              </div>
              <button disabled={!target.length} onClick={() => { setExportOpen(false); setExportSelection(target); openModal('export') }}>
                <span>Send to BijouDocs mind map…</span>
              </button>
              <button disabled={!target.length} onClick={() => { setExportOpen(false); exportPremiere('xml') }} title="Final Cut XML — in Premiere, File › Import. Notes come in as markers.">
                <span>Premiere XML…</span>{targetRecordings > 1 && <span className="dim small">{targetRecordings} recordings</span>}
              </button>
              <button disabled={!target.length} onClick={() => { setExportOpen(false); exportPremiere('csv') }}>
                <span>CSV…</span>
              </button>
              <div className="menu-sep" />
              <button disabled={!visibleIds.length} onClick={() => { setExportOpen(false); setSel(allSelected ? new Set() : new Set(visibleIds)) }}>
                <span>{allSelected ? 'Clear selection' : 'Select all notes (every recording)'}</span>
              </button>
            </div>
          )}
        </div>}
        {showNotes && <button className={'icon-btn small' + (showFilters ? ' on' : '')} onClick={() => setShowFilters(!showFilters)} title="Filter notes">⚲</button>}
        <button className="icon-btn small" onClick={toggleNotesPanel} title="Hide notes (Ctrl+Shift+\)">»</button>
      </div>
      {pad && <div className="np-body"><ProjectPad /></div>}
      <div className={'np-body' + (both ? ' both' : '') + (swap ? ' swap' : '')} ref={bodyRef} style={pad ? { display: 'none' } : undefined}>
      <div className="np-col np-notes-col" style={{ display: showNotes ? undefined : 'none', flexBasis: both ? split * 100 + '%' : undefined }}>
      {showFilters && (
        <div className="all-filters">
          <input className="lib-search" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            {[...TYPES, 'MARKER'].map((ty) => (
              <button key={ty} className={'chip' + (types.has(ty) ? ' on' : '')} style={{ '--c': ty === 'MARKER' ? MARKER_COLORS[DEFAULT_MARKER_COLOR].hex : color(ty) }} onClick={() => setTypes((s) => { const n = new Set(s); n.has(ty) ? n.delete(ty) : n.add(ty); return n })}>
                {LABEL[ty]}
              </button>
            ))}
            <button className={'chip' + (starred ? ' on' : '')} style={{ '--c': '#f5c542' }} onClick={() => setStarred(!starred)}>★ only</button>
            <button className={'chip' + (unsent ? ' on' : '')} style={{ '--c': '#4fd1c5' }} onClick={() => setUnsent(!unsent)}>Not sent yet</button>
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="np-selbar">
          <span className="grow">{chosen.length} selected{targetRecordings > 1 ? ` · ${targetRecordings} recordings` : ''}</span>
          <button className="link-btn" onClick={() => setSel(allSelected ? new Set() : new Set(visibleIds))}>{allSelected ? 'Clear' : 'Select all'}</button>
          {!allSelected && <button className="link-btn" onClick={() => setSel(new Set())}>Clear</button>}
          <button
            className="link-btn danger"
            onClick={() => {
              const n = deleteNotes(chosen)
              setSel(new Set())
              useStore.getState().showToast('Deleted ' + n + ' note' + (n === 1 ? '' : 's') + ' — Ctrl+Z to undo')
            }}
            title="Delete the ticked notes (Ctrl+Z brings them back)"
          >
            Delete
          </button>
        </div>
      )}

      <div className="notes-list grouped" ref={listRef} style={{ zoom }}>
        {!groups.length && (
          <div className="notes-empty">
            {project ? <p>Add footage to this project, then press <kbd>M</kbd> while watching to drop a beat.</p> : <p>Open a recording and press <kbd>M</kbd> while watching to drop a beat, or type in the box below.</p>}
          </div>
        )}
        {groups.map((g) => {
          const isCur = g.c.key === currentKey
          const open = !collapsed.has(g.c.key)
          const ids = g.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id)
          const allOn = ids.length > 0 && ids.every((id) => sel.has(id))
          return (
            <div key={g.c.key} className={'ng' + (isCur ? ' current' : '') + (g.count ? '' : ' empty')} ref={isCur ? currentGroupRef : null}>
              <div className="ng-head">
                <button className="ng-caret" onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.c.key) ? n.delete(g.c.key) : n.add(g.c.key); return n })}>
                  {open ? '▼' : '▶'}
                </button>
                <span className="ng-title" onClick={() => !isCur && openClip(g.c.key)} title={g.c.path}>
                  {fmtDay(g.c.recordedAt)} · {clipTitle(g.c)}
                  {project && <span className="dim"> ({g.index}/{g.total})</span>}
                </span>
                <span className="dim small">{g.count || ''}</span>
                <input type="checkbox" disabled={!ids.length} checked={allOn} onChange={(e) => toggleSel(ids, e.target.checked)} title="Select this recording's notes" />
                <button className="ng-copy" disabled={!g.notes.length} onClick={() => copy(g.c.name.replace(/\.[^.]+$/, '') + '\n' + g.notes.filter((n) => n.type !== 'BREAK').map(noteLine).join('\n'))} title="Copy this recording's notes">⧉ Copy</button>
              </div>
              {open && g.notes.map((n) => (
                <NoteRow
                  key={n.id}
                  n={n}
                  clipKey={g.c.key}
                  isCurrentClip={isCur}
                  active={isCur && n.id === activeId}
                  color={noteColor}
                  checked={sel.has(n.id)}
                  onPick={(e) => pick(n.id, e)}
                  onAnchor={() => (anchorRef.current = n.id)}
                />
              ))}
              {open && isCur && !g.notes.length && <div className="ng-empty dim small">No notes yet — press <kbd>M</kbd> or type below.</div>}
            </div>
          )
        })}
      </div>

      <LogBox clipKey={currentKey} />
      </div>
      {both && <div className="np-split" onMouseDown={dragSplit} onDoubleClick={() => useStore.getState().updateSettings({ sideSplit: 0.5 })} title="Drag to resize · double-click to split evenly" />}
      {showTx && (
        <div className="np-col np-tx-col">
          <TranscriptPanel />
        </div>
      )}
      </div>

    </aside>
  )
}

// [ / ] jump between notes in the open recording.
// type: only jump between notes of that type (e.g. 'MARKER').
bus.on('jumpNote', (dir, type) => {
  const st = useStore.getState()
  const r = st.currentKey && st.reviews[st.currentKey]
  if (!r || !r.notes.length) return
  const notes = type ? r.notes.filter((n) => n.type === type) : r.notes
  const t = player.getTime()
  const target = dir > 0 ? notes.find((n) => n.t > t + 0.25) : [...notes].reverse().find((n) => n.t < t - 0.75)
  if (target) {
    player.seek(target.t, { exact: !!type }) // markers land on the exact frame, even while playing
    st.selectNote(target.id)
  }
})
