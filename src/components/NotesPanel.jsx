import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import TranscriptPanel from './TranscriptPanel.jsx'
import ProjectPad from './ProjectPad.jsx'
import { PanelFullButton } from './LayoutToggles.jsx'
import { player, mediaUrl } from '../lib/player.js'
import { usePlayerDerived, bus } from '../lib/hooks.js'
import { fmtTime, fmtDay } from '../lib/time.js'
import { TYPES, LABEL, DEFAULT_COLORS, MARKER_COLORS, DEFAULT_MARKER_COLOR, cycleType, pickDefaultType, noteHex } from '../lib/beats.js'
import { clipTitle } from './Library.jsx'
import { POV_COLORS } from './Timeline.jsx'

const YOU = 'You'

// Small drawn icons for the list tools (one stroke weight, like the layout toggles).
const ICON_PATHS = {
  search: <><circle cx="6" cy="6" r="3.6" /><path d="M8.8 8.8L12 12" /></>,
  filter: <path d="M2 3h10L8.2 7.4V11.5L5.8 10.3V7.4z" />,
  x: <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />,
  top: <path d="M3 2.5h8M7 12V5.2M4.2 7.8L7 5l2.8 2.8" />,
  bottom: <path d="M3 11.5h8M7 2v6.8M4.2 6.2L7 9l2.8-2.8" />,
  now: <><circle cx="7" cy="7" r="2.1" /><path d="M7 1.5v2.2M7 10.3v2.2M1.5 7h2.2M10.3 7h2.2" /></>,
  fold: <path d="M3.5 2.5L7 5.8l3.5-3.3M3.5 11.5L7 8.2l3.5 3.3" />,
  unfold: <path d="M3.5 5.5L7 2.2l3.5 3.3M3.5 8.5L7 11.8l3.5-3.3" />
}
function Ico({ name }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}

// The text with what you searched for lit up.
function Hl({ text, q }) {
  if (!q) return text
  const low = text.toLowerCase()
  const parts = []
  let at = 0
  for (let i = low.indexOf(q); i !== -1; i = low.indexOf(q, at)) {
    if (i > at) parts.push(text.slice(at, i))
    parts.push(<mark key={i} className="hl">{text.slice(i, i + q.length)}</mark>)
    at = i + q.length
  }
  parts.push(text.slice(at))
  return parts
}

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

// Whose footage a note is about. On a recording that has POVs it's a button: click to move the note to
// the next person (you → each POV → you). Notes on someone's own recordings show their name, fixed.
function WhoTag({ name, color, choices, onPick }) {
  const you = !name || name === YOU
  if (you && !choices) return null
  const cls = 'who-tag' + (you ? ' you' : '')
  const style = { '--w': color || '#888' }
  if (!choices) return <span className={cls} style={style} title={name + '’s recording'}>{name}</span>
  return (
    <button className={cls} style={style} onClick={(e) => { e.stopPropagation(); onPick() }} title={'About ' + (you ? 'your own footage' : name + '’s POV') + ' — click to change whose it is'}>
      {you ? YOU : name}
    </button>
  )
}

function NoteRow({ n, clipKey, isCurrentClip, active, color, checked, onPick, onAnchor, q, who }) {
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
        {who && <WhoTag name={who.name} color={who.color} choices={who.choices} onPick={() => {
          const list = ['', ...who.choices]
          const next = list[(list.indexOf(n.pov || '') + 1) % list.length]
          editNote(n.id, { pov: next || undefined }, clipKey)
        }} />}
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
        n.text && <div className="note-text"><Hl text={n.text} q={q} /></div>
      )}
      {n.sketch && (
        <img
          className="note-sketch"
          src={mediaUrl(n.sketch) + '?v=' + (n.sketchV || 0)}
          alt="Sketch"
          title="Your sketch — click to keep drawing on it"
          onClick={(e) => { e.stopPropagation(); useStore.getState().editSketch(clipKey, n.id) }}
        />
      )}
    </div>
  )
}

// "Type what happened": the note is stamped when you START typing, so a slow typist still lands on the
// moment itself. Doesn't pause. Shows where it will land, and whose footage it is about.
const NONE = []
function LogBox({ clipKey }) {
  const logNote = useStore((s) => s.logNote)
  const color = useBeatColor()
  const povs = useStore((s) => (clipKey && s.reviews[clipKey] && s.reviews[clipKey].povs) || NONE)
  const bigPov = useStore((s) => s.povFocus)
  const [text, setText] = useState('')
  const [stamp, setStamp] = useState(null)
  const [type, setType] = useState(null) // null = auto (Setup / But / Therefore)
  const [who, setWho] = useState(null) // null = whoever is big right now (you, or the POV on screen)
  const ref = useRef(null)
  const live = usePlayerDerived((t) => Math.floor(t), [clipKey], 500)
  useEffect(() => { setText(''); setStamp(null); setType(null); setWho(null) }, [clipKey])
  useEffect(() => { setWho(null) }, [bigPov]) // switching POV switches whose note it is
  useEffect(() => bus.on('focusLog', () => ref.current && ref.current.focus()), [])

  const autoType = () => {
    const st = useStore.getState()
    const r = st.reviews[clipKey]
    const t = stamp != null ? stamp : player.getTime()
    return pickDefaultType(r ? r.notes.filter((n) => n.t <= t) : [])
  }
  const shownType = type || autoType()
  const big = povs.find((p) => p.key === bigPov)
  const shownWho = who !== null ? who : big ? big.name : ''
  const names = ['', ...povs.map((p) => p.name)]
  const whoColor = (name) => {
    const i = povs.findIndex((p) => p.name === name)
    return i < 0 ? '#888' : povs[i].color || POV_COLORS[i % POV_COLORS.length]
  }

  return (
    <div className={'logbox' + (text ? ' typing' : '')} style={{ '--c': color(shownType) }}>
      <div className="logbox-meta">
        <button
          className="type-pill logbox-type"
          onClick={(e) => setType(cycleType(shownType, e.shiftKey ? -1 : 1))}
          title={type ? 'Beat type — click or Tab to change' : 'Auto beat type (like M) — click or Tab to choose'}
        >
          {LABEL[shownType]}
        </button>
        <span className="logbox-at" title="The note lands on this moment — it is stamped when you start typing">at {fmtTime(stamp != null ? stamp : live)}</span>
        {povs.length > 0 && (
          <button
            className={'who-tag' + (shownWho ? '' : ' you')}
            style={{ '--w': shownWho ? whoColor(shownWho) : '#888' }}
            onClick={() => setWho(names[(Math.max(0, names.indexOf(shownWho)) + 1) % names.length])}
            title={'This note is about ' + (shownWho ? shownWho + '’s POV' : 'your own footage') + ' — click to change whose it is'}
          >
            {shownWho || YOU}
          </button>
        )}
        <span className="logbox-hint">{text ? 'Enter adds it · Shift+Enter new line' : 'Press / to type here'}</span>
      </div>
      <textarea
        ref={ref}
        className="logbox-input"
        rows={1}
        value={text}
        disabled={!clipKey}
        placeholder={clipKey ? (shownWho ? 'What happens on ' + shownWho + '’s POV?' : 'Type what happened…') : 'Open a recording first'}
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
              logNote({ t: stamp != null ? stamp : player.getTime(), type, text, pov: shownWho })
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
  const selectNote = useStore((s) => s.selectNote)
  const deleteNotes = useStore((s) => s.deleteNotes)
  const setNotesWidth = useStore((s) => s.setNotesWidth)
  const sideTab = useStore((s) => s.settings.sideTab || 'notes')
  const setSideTab = useStore((s) => s.setSideTab)
  const both = sideTab === 'both'
  const pad = sideTab === 'pad'
  const showNotes = sideTab === 'notes' || both
  const showTx = sideTab === 'transcript' || both
  const split = useStore((s) => s.settings.sideSplit ?? 0.5) // notes' share of the width, side by side
  const swap = useStore((s) => !!s.settings.sideSwap) // transcript first (left / top)
  const stack = useStore((s) => !!s.settings.sideStack) // notes above the transcript, not beside it
  const follow = useStore((s) => !!s.settings.notesFollow)
  const bodyRef = useRef(null)
  function dragSplit(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const box = bodyRef.current.getBoundingClientRect()
    const move = (ev) => {
      let f = stack ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width
      if (swap) f = 1 - f
      useStore.getState().updateSettings({ sideSplit: Math.max(0.15, Math.min(0.85, f)) })
    }
    const cls = stack ? 'resizing-ns' : 'resizing-ew'
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove(cls)
    }
    document.body.classList.add(cls)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const color = useBeatColor()
  const noteColor = useNoteColor()
  // which recordings' note groups are folded — remembered between runs
  const foldedKeys = useStore((s) => s.settings.notesCollapsed)
  const collapsed = React.useMemo(() => new Set(foldedKeys || []), [foldedKeys])
  const setCollapsed = (fn) => {
    const next = fn(new Set(collapsed))
    useStore.getState().updateSettings({ notesCollapsed: [...next] })
  }
  const [showFilters, setShowFilters] = useState(false)
  const [types, setTypes] = useState(() => new Set([...TYPES, 'MARKER']))
  const [starred, setStarred] = useState(false)
  const [unsent, setUnsent] = useState(false)
  const [hidden, setHidden] = useState(() => new Set()) // people whose notes are switched off
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [pos, setPos] = useState(-1) // which search match Enter last went to
  const [edge, setEdge] = useState({ top: true, bottom: true })
  const currentGroupRef = useRef(null)
  const searchRef = useRef(null)
  const userScroll = useRef(0)
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
  useEffect(() => bus.on('focusNotesSearch', () => { const el = searchRef.current; if (el) { el.focus(); el.select() } }), [])

  // What's in the list: your recordings in story order (with "n/N"), then — when the project has POV
  // sources — their recordings that have notes (or are open). In All footage, every recording with notes
  // plus the open one. Also who each note is about, and a colour for each person.
  const scope = useMemo(() => {
    const byKey = new Map(clips.map((c) => [c.key, c]))
    const sources = (project && project.sources) || []
    const srcOf = new Map()
    const rank = new Map()
    sources.forEach((s, i) => (s.clipKeys || []).forEach((k) => { srcOf.set(k, { name: s.name, color: POV_COLORS[i % POV_COLORS.length] }); rank.set(k, i) }))
    const has = (k) => reviews[k] && reviews[k].notes.length
    const byTime = (a, b) => a.recordedAt - b.recordedAt
    let yours
    const others = []
    if (project) {
      yours = project.clipKeys.map((k) => byKey.get(k)).filter(Boolean)
      const seen = new Set(yours.map((c) => c.key))
      sources.forEach((s) => (s.clipKeys || []).forEach((k) => {
        const c = byKey.get(k)
        if (c && !seen.has(k) && (k === currentKey || has(k))) { seen.add(k); others.push(c) }
      }))
      const cur = currentKey && byKey.get(currentKey)
      if (cur && !seen.has(currentKey)) others.push(cur)
    } else {
      yours = clips.filter((c) => c.key === currentKey || has(c.key))
    }
    yours = yours.slice().sort(byTime)
    others.sort((a, b) => (rank.has(a.key) ? rank.get(a.key) : 99) - (rank.has(b.key) ? rank.get(b.key) : 99) || byTime(a, b))
    const personOf = (n, key) => n.pov || (srcOf.get(key) || {}).name || YOU

    const palette = new Map([[YOU, null]])
    sources.forEach((s, i) => palette.set(s.name, POV_COLORS[i % POV_COLORS.length]))
    let next = sources.length
    const paint = (name, hint) => { if (!palette.has(name)) palette.set(name, hint || POV_COLORS[next++ % POV_COLORS.length]) }
    const facets = { types: {}, star: 0, unsent: 0, total: 0, people: new Map() }
    for (const c of [...yours, ...others]) {
      const r = reviews[c.key]
      if (!r) continue
      ;(r.povs || []).forEach((p, i) => paint(p.name, p.color || POV_COLORS[i % POV_COLORS.length]))
      for (const n of r.notes) {
        if (n.type === 'BREAK') continue
        if (n.pov) paint(n.pov)
        const who = personOf(n, c.key)
        facets.total++
        facets.types[n.type] = (facets.types[n.type] || 0) + 1
        if (n.star) facets.star++
        if (!n.exportedAt) facets.unsent++
        facets.people.set(who, (facets.people.get(who) || 0) + 1)
      }
    }
    const isSource = (name) => sources.some((s) => s.name === name)
    const people = [...palette].filter(([name]) => name === YOU || facets.people.get(name) > 0 || isSource(name)).map(([name, col]) => ({ name, color: col, count: facets.people.get(name) || 0 }))
    return { yours, others, srcOf, palette, personOf, facets, people }
  }, [clips, reviews, project, currentKey])

  const text = q.trim().toLowerCase()
  const filtering = !!(text || starred || unsent || types.size !== TYPES.length + 1 || hidden.size)
  const activeFilters = (types.size !== TYPES.length + 1 ? 1 : 0) + (starred ? 1 : 0) + (unsent ? 1 : 0) + (hidden.size ? 1 : 0)
  const groups = useMemo(() => {
    const make = (c, i, total, src) => {
      const all = (reviews[c.key] && reviews[c.key].notes) || []
      const notes = all.filter((n) => {
        if (n.type === 'BREAK') return !filtering
        if (!types.has(n.type) || (starred && !n.star) || (unsent && n.exportedAt)) return false
        const who = scope.personOf(n, c.key)
        if (hidden.has(who)) return false
        if (!text) return true
        return (n.text || '').toLowerCase().includes(text) || who.toLowerCase().includes(text) || LABEL[n.type].toLowerCase().includes(text)
      })
      return { c, index: i + 1, total, notes, count: notes.filter((n) => n.type !== 'BREAK').length, src }
    }
    const out = scope.yours.map((c, i) => make(c, i, scope.yours.length, null)).concat(scope.others.map((c, i) => make(c, i, scope.others.length, scope.srcOf.get(c.key) || null)))
    return filtering ? out.filter((g) => g.count) : out
  }, [scope, reviews, text, starred, unsent, types, hidden, filtering])
  const isOpen = (g) => !collapsed.has(g.c.key) || !!text // a search shows what it found, folded or not

  useEffect(() => {
    if (currentGroupRef.current) currentGroupRef.current.scrollIntoView({ block: 'nearest' })
  }, [currentKey])
  useEffect(() => setPos(-1), [text])

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
  const shownIds = groups.filter(isOpen).flatMap((g) => g.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id))
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

  // Follow: keep the note being played in view (unless you've just scrolled yourself).
  useEffect(() => {
    if (!follow || !activeId || Date.now() - userScroll.current < 3000) return
    const el = listRef.current && listRef.current.querySelector('.note.active')
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [follow, activeId])

  // Where the list is scrolled to (Top / Bottom grey out when you're already there).
  function measure() {
    const el = listRef.current
    if (!el) return
    const top = el.scrollTop < 6
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 6
    setEdge((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }))
  }
  useEffect(measure, [groups, collapsed, zoom, showNotes, showFilters, text])

  const toTop = () => listRef.current && listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  const toBottom = () => listRef.current && listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  function goNow() {
    if (currentKey && collapsed.has(currentKey)) setCollapsed((s) => { s.delete(currentKey); return s })
    setTimeout(() => {
      const el = listRef.current
      if (!el) return
      const t = el.querySelector('.note.active') || el.querySelector('.ng.current .note') || el.querySelector('.ng.current')
      if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 40)
  }
  const allFolded = groups.length > 0 && groups.every((g) => collapsed.has(g.c.key))
  const foldAll = () => setCollapsed((s) => { groups.forEach((g) => (allFolded ? s.delete(g.c.key) : s.add(g.c.key))); return s })

  // Search: Enter goes to the next match (Shift+Enter the one before), Esc clears.
  const flat = useMemo(() => groups.flatMap((g) => g.notes.filter((n) => n.type !== 'BREAK').map((n) => ({ n, key: g.c.key }))), [groups])
  function step(dir) {
    if (!flat.length) return
    const i = pos < 0 ? (dir > 0 ? 0 : flat.length - 1) : (pos + dir + flat.length) % flat.length
    setPos(i)
    const m = flat[i]
    if (m.key === currentKey) player.seek(m.n.t)
    else openClip(m.key, m.n.t)
    selectNote(m.n.id)
  }
  function clearFilters() {
    setQ('')
    setTypes(new Set([...TYPES, 'MARKER']))
    setStarred(false)
    setUnsent(false)
    setHidden(new Set())
  }

  async function exportPremiere(kind) {
    const ids = new Set(target)
    const payload = groups
      .map((g) => ({ path: g.c.path, name: g.c.name, probe: g.c.probe, notes: g.notes.filter((n) => ids.has(n.id)).map((n) => ({ t: n.t, end: n.end, type: n.type, text: n.text, star: n.star, color: n.color, sketch: n.sketch })) }))
      .filter((g) => g.notes.length)
    const file = await window.footage.exportPremiere(payload, kind, project ? project.name : 'Footage notes')
    if (file) useStore.getState().showToast((kind === 'csv' ? 'CSV' : 'Premiere XML') + ' saved: ' + file)
  }

  const totalNotes = scope.facets.total
  const shownNotes = groups.reduce((a, g) => a + g.count, 0)
  const whoOf = (n, g) => {
    const name = scope.personOf(n, g.c.key)
    const rp = (reviews[g.c.key] && reviews[g.c.key].povs) || NONE
    return { name, color: scope.palette.get(name), choices: !g.src && rp.length ? rp.map((p) => p.name) : null }
  }

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
            <button className={sideTab === 'notes' ? 'on' : ''} onClick={() => setSideTab('notes')} title="Notes and markers (Shift+T switches)">
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
          {both && <button className="icon-btn small np-swap" onClick={() => useStore.getState().updateSettings({ sideSwap: !swap })} title={stack ? 'Swap: transcript on top / notes on top' : 'Swap sides'}>{stack ? '⇅' : '⇄'}</button>}
          {both && (
            <button className="icon-btn small np-stack" onClick={() => useStore.getState().updateSettings({ sideStack: !stack })} title={stack ? 'Side by side' : 'Stack them: notes above, transcript below'}>
              {stack ? (
                <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 2v10" stroke="currentColor" strokeWidth="1.3" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M1.5 7h11" stroke="currentColor" strokeWidth="1.3" /></svg>
              )}
            </button>
          )}
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
        <PanelFullButton />
        <button className="icon-btn small" onClick={toggleNotesPanel} title="Hide notes (Ctrl+Shift+\)">»</button>
      </div>
      {pad && <div className="np-body"><ProjectPad /></div>}
      <div className={'np-body' + (both ? ' both' : '') + (swap ? ' swap' : '') + (both && stack ? ' stack' : '')} ref={bodyRef} style={pad ? { display: 'none' } : undefined}>
      <div className="np-col np-notes-col" style={{ display: showNotes ? undefined : 'none', flexBasis: both ? split * 100 + '%' : undefined }}>
      <div className="np-tools">
        <div className="np-tools-row">
          <div className={'np-search' + (q ? ' has' : '')}>
            <span className="np-search-ico"><Ico name="search" /></span>
            <input
              ref={searchRef}
              className="np-search-input"
              value={q}
              spellCheck={false}
              placeholder="Search notes…"
              title="Search the notes' text, who they are about, and their type · Enter = next match · Shift+Enter = previous · Esc = clear · Ctrl+Shift+F focuses this"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
                else if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else e.target.blur() }
              }}
            />
            {text && <span className="np-search-count" title="Enter goes to the next match">{pos >= 0 ? pos + 1 + '/' : ''}{flat.length}</span>}
            {q && <button className="np-search-x" onClick={() => { setQ(''); searchRef.current && searchRef.current.focus() }} title="Clear the search"><Ico name="x" /></button>}
          </div>
          <button className={'icon-btn small np-filter-btn' + (showFilters ? ' on' : '')} onClick={() => setShowFilters(!showFilters)} title="Filter by type, star, whose footage…">
            <Ico name="filter" />
            {activeFilters > 0 && <span className="np-dot">{activeFilters}</span>}
          </button>
        </div>
        <div className="np-nav">
          <button onClick={toTop} disabled={edge.top} title="Scroll to the top of the list"><Ico name="top" />Top</button>
          <button onClick={goNow} disabled={!currentKey} title="Scroll to the note at the playhead — the recording that's open"><Ico name="now" />Now</button>
          <button onClick={toBottom} disabled={edge.bottom} title="Scroll to the bottom of the list"><Ico name="bottom" />Bottom</button>
          <span className="grow" />
          <button onClick={foldAll} disabled={!groups.length || !!text} title={text ? 'A search shows everything it finds' : allFolded ? 'Open every recording’s notes' : 'Fold every recording down to its title'}>
            <Ico name={allFolded ? 'unfold' : 'fold'} />{allFolded ? 'Unfold all' : 'Fold all'}
          </button>
          <button className={'np-follow' + (follow ? ' on' : '')} aria-pressed={follow} onClick={() => useStore.getState().updateSettings({ notesFollow: !follow })} title="Keep the list scrolled to the note being played">
            <span className="np-follow-dot" />Follow
          </button>
        </div>
      </div>
      {showFilters && (
        <div className="all-filters">
          <div className="chips">
            {[...TYPES, 'MARKER'].map((ty) => (
              <button key={ty} className={'chip' + (types.has(ty) ? ' on' : '') + (scope.facets.types[ty] ? '' : ' zero')} style={{ '--c': ty === 'MARKER' ? MARKER_COLORS[DEFAULT_MARKER_COLOR].hex : color(ty) }} onClick={() => setTypes((s) => { const n = new Set(s); n.has(ty) ? n.delete(ty) : n.add(ty); return n })}>
                {LABEL[ty]}<span className="n">{scope.facets.types[ty] || 0}</span>
              </button>
            ))}
          </div>
          <div className="chips">
            <button className={'chip' + (starred ? ' on' : '')} style={{ '--c': '#f5c542' }} onClick={() => setStarred(!starred)}>★ Starred<span className="n">{scope.facets.star}</span></button>
            <button className={'chip' + (unsent ? ' on' : '')} style={{ '--c': '#4fd1c5' }} onClick={() => setUnsent(!unsent)} title="Not sent to BijouDocs yet">Not sent yet<span className="n">{scope.facets.unsent}</span></button>
          </div>
          {scope.people.length > 1 && (
            <div className="chips">
              <span className="chips-label">Whose</span>
              {scope.people.map((p) => (
                <button key={p.name} className={'chip' + (hidden.has(p.name) ? '' : ' on') + (p.count ? '' : ' zero')} style={{ '--c': p.color || '#9aa0b4' }} title={hidden.has(p.name) ? 'Show ' + p.name + '’s notes' : 'Hide ' + p.name + '’s notes'} onClick={() => setHidden((s) => { const n = new Set(s); n.has(p.name) ? n.delete(p.name) : n.add(p.name); return n })}>
                  {p.name}<span className="n">{p.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {filtering && (
        <div className="np-active">
          <span className="grow">{shownNotes === totalNotes ? 'All ' : 'Showing '}{shownNotes} of {totalNotes} note{totalNotes === 1 ? '' : 's'}</span>
          <button className="link-btn" onClick={clearFilters}>Clear {q && activeFilters ? 'search & filters' : q ? 'search' : 'filters'}</button>
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

      <div
        className="notes-list grouped"
        ref={listRef}
        style={{ zoom }}
        onScroll={measure}
        onWheel={() => (userScroll.current = Date.now())}
        onMouseDown={() => (userScroll.current = Date.now())}
      >
        {!groups.length && (
          <div className="notes-empty">
            {filtering ? (
              <>
                <p>No notes match{text ? <> “<b>{q.trim()}</b>”</> : ' these filters'}.</p>
                <button className="btn small" onClick={clearFilters}>Clear {q && activeFilters ? 'search & filters' : q ? 'search' : 'filters'}</button>
              </>
            ) : (
              <>
                <p>{project ? 'Add footage to this project, then watch.' : 'Open a recording and watch.'}</p>
                <p className="dim small">Drop a beat with <kbd>M</kbd>, a plain note with <kbd>N</kbd>, a marker with <kbd>Shift</kbd>+<kbd>M</kbd> — or type below.</p>
              </>
            )}
          </div>
        )}
        {groups.map((g) => {
          const isCur = g.c.key === currentKey
          const open = isOpen(g)
          const ids = g.notes.filter((n) => n.type !== 'BREAK').map((n) => n.id)
          const allOn = ids.length > 0 && ids.every((id) => sel.has(id))
          return (
            <div key={g.c.key} className={'ng' + (isCur ? ' current' : '') + (g.count ? '' : ' empty')} ref={isCur ? currentGroupRef : null}>
              <div className="ng-head">
                <button className="ng-caret" onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(g.c.key) ? n.delete(g.c.key) : n.add(g.c.key); return n })} title={open ? 'Fold' : 'Open'}>
                  {open ? '▼' : '▶'}
                </button>
                {g.src && <span className="who-tag fixed" style={{ '--w': g.src.color }} title={g.src.name + '’s recording'}>{g.src.name}</span>}
                <span className="ng-title" onClick={() => !isCur && openClip(g.c.key)} title={g.c.path}>
                  {fmtDay(g.c.recordedAt)} · {clipTitle(g.c)}
                  {project && !g.src && <span className="dim"> ({g.index}/{g.total})</span>}
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
                  q={text}
                  who={n.type === 'BREAK' ? null : whoOf(n, g)}
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
