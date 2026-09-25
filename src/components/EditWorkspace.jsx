import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { bus, onTick } from '../lib/hooks.js'
import { fmtTime, fmtDuration, fmtDay, fmtShortDay } from '../lib/time.js'
import { parseTimecode } from './PlayerView.jsx'
import * as EM from '../lib/editModel.js'
import { ProjectPicker, clipTitle } from './Library.jsx'
import EditTimeline from './EditTimeline.jsx'
import EditPanel from './EditPanel.jsx'
import { ToolsMenu, RemoveSilenceDialog, CutAroundDialog, ExportSectionDialog } from './EditTools.jsx'
import { startEditSkipSilence } from '../lib/editSkipSilence.js'
import { EDIT_BY_ID } from '../lib/editKeys.js'
import { WATCH_SPEEDS } from '../lib/player.js'
import { MARKER_COLORS as MARKER_COLORS_ALL } from '../lib/beats.js'

// Review | Edit switch — top of the sidebar in both workspaces.
export function WorkspaceSwitch() {
  const ws = useStore((s) => s.settings.workspace || 'review')
  const setWorkspace = useStore((s) => s.setWorkspace)
  return (
    <div className="ws-switch">
      <button className={ws === 'review' ? 'on' : ''} onClick={() => setWorkspace('review')} title="Review footage: watch, notes, markers, transcripts">Review</button>
      <button className={ws === 'edit' ? 'on' : ''} onClick={() => setWorkspace('edit')} title="Edit: rough-cut sections and export them to Premiere">Edit</button>
    </div>
  )
}

function useSeqTime(ms = 80) {
  const [t, setT] = useState(() => seqPlayer.getTime())
  useEffect(() => onTick(ms, () => {
    const cur = seqPlayer.getTime()
    setT((p) => (Math.abs(p - cur) > 0.001 ? cur : p))
  }), [ms])
  return t
}
function useSeqPlaying() {
  const [p, setP] = useState(seqPlayer.playing)
  useEffect(() => {
    const off = [seqPlayer.on('state', () => setP(seqPlayer.busy)), seqPlayer.on('ended', () => setP(false))]
    return () => off.forEach((o) => o())
  }, [])
  return p
}

// ---- sidebar ----
function Sections() {
  const sections = useStore((s) => s.sections)
  const current = useStore((s) => s.currentSection())
  const createSection = useStore((s) => s.createSection)
  const setCurrentSection = useStore((s) => s.setCurrentSection)
  const renameSection = useStore((s) => s.renameSection)
  const deleteSection = useStore((s) => s.deleteSection)
  const moveSection = useStore((s) => s.moveSection)
  const [editing, setEditing] = useState(null)
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  return (
    <div className="es-block">
      <div className="es-head">
        <span>Sections</span>
        <button className="link-btn" onClick={() => setEditing(createSection())} title="A new section — e.g. “King Slime → Eye of Cthulhu”">＋ New</button>
      </div>
      {!sorted.length && <div className="es-empty dim small">A section is one part of the video you cut on its own — e.g. “King Slime → Eye of Cthulhu”.</div>}
      {sorted.map((x, i) => {
        const dur = EM.totalDuration(x.clips)
        const on = current && current.id === x.id
        return (
          <div key={x.id} className={'es-row' + (on ? ' on' : '')} onClick={() => !on && setCurrentSection(x.id)} onDoubleClick={() => setEditing(x.id)}>
            <span className="es-num">{i + 1}</span>
            {editing === x.id ? (
              <input
                className="es-rename"
                autoFocus
                defaultValue={x.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => { renameSection(x.id, e.target.value); setEditing(null) }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
              />
            ) : (
              <span className="es-name" title="Double-click to rename">{x.name}</span>
            )}
            <span className="es-meta dim">{x.clips.length ? fmtDuration(dur) : 'empty'}</span>
            <span className="es-actions" onClick={(e) => e.stopPropagation()}>
              <button className="row-btn" title="Move up" onClick={() => moveSection(x.id, -1)}>↑</button>
              <button className="row-btn" title="Move down" onClick={() => moveSection(x.id, 1)}>↓</button>
              <button className="row-btn" title="Rename" onClick={() => setEditing(x.id)}>✎</button>
              <button className="row-btn" title="Duplicate (e.g. to keep the original before an automatic cut)" onClick={() => useStore.getState().duplicateSection(x.id)}>⧉</button>
              <button className="row-btn" title="Delete section (goes to the Recycle Bin)" onClick={() => { if (confirm(`Delete the section “${x.name}”? (It goes to the Recycle Bin.)`)) deleteSection(x.id) }}>×</button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Bin() {
  const project = useStore((s) => s.currentProject())
  const clips = useStore((s) => s.clips)
  const addToSection = useStore((s) => s.addToSection)
  const colors = useTrackColors()
  const list = useMemo(
    () => (project ? project.clipKeys.map((k) => clips.find((c) => c.key === k)).filter(Boolean).sort((a, b) => a.recordedAt - b.recordedAt) : []),
    [project, clips]
  )
  if (!project) return null
  return (
    <div className="es-block es-bin">
      <div className="es-head">
        <span>Recordings</span>
        <span className="dim small">drag onto the timeline, or ＋</span>
      </div>
      <div className="es-bin-list">
        {list.map((c, i) => (
          <div
            key={c.key}
            className="bin-row"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/x-bijou-clip', c.key)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={c.path + '\nDrag onto the timeline · ＋ adds it to the end · ↗ opens it in Review (mark I … press E there to add just a part)'}
          >
            <span className="bin-idx dim">{i + 1}</span>
            <span className="bin-name">
              <b>{clipTitle(c)}</b> <span className="dim">{fmtShortDay(c.recordedAt)}</span>
            </span>
            <span className="bin-dots">
              {((c.probe && c.probe.audio) || []).map((a, k) => (
                <i key={k} className={'tdot' + (a.likelySilent ? ' empty' : '')} style={{ '--c': colors[k] }} />
              ))}
            </span>
            <span className="bin-dur dim">{c.probe ? fmtDuration(c.probe.duration) : '…'}</span>
            <button className="row-btn" title="Open in Review (to pick a part: I … then E)" onClick={() => { useStore.getState().openClip(c.key); useStore.getState().setWorkspace('review') }}>↗</button>
            <button className="row-btn add" title="Add the whole recording to the end of this section" onClick={() => { const n = addToSection(c.key); if (n) useStore.getState().showToast('Added to “' + n + '”') }}>＋</button>
          </div>
        ))}
        {!list.length && <div className="es-empty dim small">This project has no recordings yet — add some in Review.</div>}
      </div>
    </div>
  )
}

function EditSidebar() {
  const openModal = useStore((s) => s.openModal)
  const clips = useStore((s) => s.clips)
  return (
    <aside className="library edit-side">
      <div className="lib-top">
        <div className="brand">
          <span className="brand-mark">▶</span> Bijou Footage
        </div>
        <button className="icon-btn" title="Settings" onClick={() => openModal('settings')}>⚙</button>
        <button className="icon-btn" title="Keyboard shortcuts" onClick={() => openModal('help')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
            <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
          </svg>
        </button>
        <button className="icon-btn" title="Hide the sidebar (Ctrl+\)" onClick={() => useStore.getState().toggleEditSidebar()}>«</button>
      </div>
      <WorkspaceSwitch />
      <ProjectPicker clipCount={clips.length} />
      <Sections />
      <Bin />
    </aside>
  )
}

// Run an Edit keyboard action from a button.
function runEditKey(id) {
  const a = EDIT_BY_ID[id]
  if (a) a.run({ st: useStore.getState(), bus, osd: (t) => bus.emit('osd', t) })
}
function SpeechIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style={{ verticalAlign: '-1px' }}>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z" fill="currentColor" />
    </svg>
  )
}

// The speed button (like Review): the chosen speed; shows the shuttle speed
// while J / L are in use — stopping returns to the chosen one.
function EditSpeed() {
  const base = useStore((s) => s.settings.editWatchSpeed || 1)
  const [, bump] = useState(0)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(null) // where the menu opens (fixed position)
  const ref = useRef(null)
  useEffect(() => seqPlayer.on('state', () => bump((n) => n + 1)), [])
  useEffect(() => { seqPlayer.setBaseRate(base) }, [])
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const r = seqPlayer.skim ? seqPlayer.skim.rate : seqPlayer.rate
  const shuttling = seqPlayer.shuttling && r !== base
  const label = (r < 0 ? '◀◀ ' : '') + Math.abs(r) + '×'
  return (
    <div className="speed" ref={ref}>
      <button className={'t-rate' + (shuttling ? ' shuttle' : base !== 1 ? ' on' : '')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 }); setOpen(!open) }} title="Playback speed · L shuttles faster, J slower / reverse — stopping returns here">
        {label}
      </button>
      {open && (
        <div className="speed-menu" style={at}>
          <div className="dim small speed-title">Playback speed</div>
          {WATCH_SPEEDS.map((x) => (
            <button key={x} className={x === base ? 'on' : ''} onClick={() => { useStore.getState().setEditWatchSpeed(x); setOpen(false) }}>
              {x}×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// The time; click it (or Ctrl+G) to type one to jump to — "1:02:03",
// "45:10", or "+30" / "-1:00" relative, like Review.
// Owns the ticking clock so only this span re-renders during playback.
function SeqTimeReadout() {
  const t = useSeqTime(80)
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  useEffect(() => bus.on('editGotoTime', () => setEditing(true)), [])
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select() } }, [editing])
  if (!editing) return <span className="t-cur t-cur-btn" onClick={() => setEditing(true)} title="Click to go to a time (Ctrl+G) — e.g. 1:02:03, or +30 / -1:00">{fmtTime(t, true)}</span>
  return (
    <input
      ref={ref}
      className="t-goto"
      defaultValue={fmtTime(t, true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          const v = parseTimecode(e.target.value, seqPlayer.getTime())
          if (v != null) seqPlayer.seek(Math.max(0, Math.min(seqPlayer.total, v)))
          else useStore.getState().showToast("Couldn't read that time — try 1:02:03, 45:10 or +30")
          setEditing(false)
        }
        if (e.key === 'Escape') setEditing(false)
      }}
      onBlur={() => setEditing(false)}
    />
  )
}

// ---- monitor + transport ----
function Monitor({ section }) {
  const aRef = useRef(null)
  const bRef = useRef(null)
  const playing = useSeqPlaying()
  const tool = useStore((s) => s.editTool)
  const setEditTool = useStore((s) => s.setEditTool)
  const snap = useStore((s) => s.settings.editSnap !== false)
  const toggleSnap = useStore((s) => s.toggleEditSnap)
  const mixer = useStore((s) => s.settings.mixer)
  const solo = useStore((s) => s.solo)
  const masterVol = useStore((s) => s.settings.masterVol)
  const [osd, setOsd] = useState(null)
  const sideHidden = useStore((s) => !!s.settings.editSidebarHidden)
  const panelHidden = useStore((s) => !!s.settings.editPanelHidden)
  const skipSil = useStore((s) => !!s.settings.editSkipSilence)
  useEffect(() => {
    seqPlayer.attach(aRef.current, bRef.current)
    useStore.getState().showSectionInPlayer()
  }, [])
  useEffect(() => seqPlayer.setMix(mixer, solo, masterVol ?? 1), [mixer, solo, masterVol])
  useEffect(() => {
    let timer
    return bus.on('osd', (text) => {
      setOsd({ text, id: Date.now() })
      clearTimeout(timer)
      timer = setTimeout(() => setOsd(null), 900)
    })
  }, [])
  const total = section ? EM.totalDuration(section.clips) : 0
  return (
    <div className="em">
      <div className="em-stage">
        {sideHidden && <button className="icon-btn lib-show em-side-show" onClick={() => useStore.getState().toggleEditSidebar()} title="Show the sidebar (Ctrl+\)">»</button>}
        <video ref={aRef} className="em-video" />
        <video ref={bRef} className="em-video" />
        {(!section || !section.clips.length) && (
          <div className="em-empty">
            {!section ? <p>Make a section on the left (e.g. “King Slime → Eye of Cthulhu”).</p> : <p>Drag recordings from the left onto the timeline, or press ＋ — then cut with <kbd>F</kbd>, <kbd>A</kbd>, <kbd>S</kbd>, <kbd>G</kbd>.</p>}
          </div>
        )}
        {osd && <div className="osd" key={osd.id}>{osd.text}</div>}
      </div>
      <div className="transport em-transport">
        <button className="t-btn" onClick={() => seqPlayer.seek(0)} title="Start (Home)">⏮</button>
        <button className="t-btn" onClick={() => runEditKey('e.slower')} title="Slower / reverse (J)">◀◀</button>
        <button className="t-btn play" onClick={() => seqPlayer.toggle()} title="Play / pause (Space) · K stops">{playing ? '❚❚' : '▶'}</button>
        <button className="t-btn" onClick={() => runEditKey('e.faster')} title="Faster (L)">▶▶</button>
        <button className="t-btn" onClick={() => bus.emit('editNextCut', 1)} title="Next cut (↓)">⏭</button>
        <button className="t-btn em-speech" onClick={() => runEditKey('e.prevSpeech')} title="Back to the previous time someone starts talking (Ctrl+←)">‹<SpeechIcon /></button>
        <button className="t-btn em-speech" onClick={() => runEditKey('e.nextSpeech')} title="Next time someone starts talking (Ctrl+→)"><SpeechIcon />›</button>
        <div className="t-time">
          <SeqTimeReadout />
          <span className="dim"> / {fmtTime(total)}</span>
        </div>
        <EditSpeed />
        <div className="tool-seg" title="Tools">
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setEditTool('select')} title="Move tool (V) — select and drag clips">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5l9.5 7-4.2.6 2.4 4.9-1.9.9-2.4-4.9L3 13z" fill="currentColor" /></svg>
          </button>
          <button className={tool === 'razor' ? 'on' : ''} onClick={() => setEditTool('razor')} title="Cut tool (C) — click a clip to cut it there">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5l7 7.2-1.6 1.6-7-7.2zM9.3 9.9l4.2 4.3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /><circle cx="3.6" cy="12.4" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
          </button>
        </div>
        <button className={'snap-btn' + (snap ? ' on' : '')} onClick={toggleSnap} title={'Snapping (W) — the playhead, cuts and drops snap to cuts and markers'}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3v6a2 2 0 0 0 4 0V2h3v6a5 5 0 0 1-10 0V2z" fill="currentColor" /></svg>
          <span>Snap</span>
        </button>
        <button className={'snap-btn' + (skipSil ? ' on' : '')} onClick={() => useStore.getState().toggleEditSkipSilence()} title="Skip silence (Shift+X) — while playing, jump over pauses longer than ~1 s where nobody on the ⇥ tracks is talking">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" /><rect x="4" y="4" width="2" height="8" rx="1" fill="currentColor" /><path d="M8 8h3" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1 1.4" /><path d="M11 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Skip silence</span>
        </button>
        <div className="t-spacer" />
        {panelHidden && <button className="btn small ghost" onClick={() => useStore.getState().toggleEditPanel()} title="Show Notes & Transcript (Ctrl+Shift+\)">Notes &amp; transcript</button>}
        <ToolsMenu />
        <span className="em-name dim">{section ? section.name : ''}</span>
        <button className="btn small" disabled={!section || !section.clips.length} onClick={() => bus.emit('exportSection')} title="Export this section as a Premiere sequence (Ctrl+E)">Export to Premiere</button>
      </div>
    </div>
  )
}

// opts (from the export dialog): which markers go along —
// {timeline: bool, colors: [marker colours], types: [beat/note types]}.
async function exportSection(opts = {}) {
  const colors = new Set(opts.colors || Object.keys(MARKER_COLORS_ALL))
  const types = new Set(opts.types || ['SETUP', 'AND_THEN', 'BECAUSE', 'BUT', 'THEREFORE', 'NOTE'])
  const st = useStore.getState()
  const sec = st.currentSection()
  if (!sec || !sec.clips.length) return
  const items = EM.layout(sec.clips).items
  const clips = []
  const markers = []
  for (const it of items) {
    const c = st.clips.find((x) => x.key === it.key)
    if (!c) continue
    clips.push({ path: c.path, name: c.name, probe: { fps: c.probe.fps, duration: c.probe.duration, width: c.probe.width, height: c.probe.height, audio: c.probe.audio }, in: it.in, out: it.out, color: it.color || null })
    // The recording's notes & markers that fall inside this cut, moved to
    // where they land in the section.
    const notes = (st.reviews[it.key] && st.reviews[it.key].notes) || []
    for (const n of notes) {
      if (n.type === 'BREAK' || n.t < it.in || n.t >= it.out) continue
      if (n.type === 'MARKER' ? !colors.has(n.color || 'yellow') : !types.has(n.type)) continue
      markers.push({ ...n, t: it.start + (n.t - it.in), end: n.end != null ? it.start + (Math.min(n.end, it.out) - it.in) : undefined })
    }
  }
  // Timeline markers (Q in Edit) go out as sequence markers too.
  if (opts.timeline !== false) for (const m of sec.markers || []) markers.push({ id: m.id, t: m.t, type: 'MARKER', color: m.color, text: m.text })
  markers.sort((a, b) => a.t - b.t)
  const project = st.currentProject()
  const file = await window.footage.exportSection({ name: (project ? project.name + ' — ' : '') + sec.name, clips, markers })
  if (file) st.showToast('Premiere XML saved: ' + file)
}

// Drag to trade space between the preview and the timeline (like Review).
function EditSplitter() {
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const center = e.currentTarget.parentElement.getBoundingClientRect()
    const move = (ev) => useStore.getState().updateSettings({ editTimelineHeight: Math.round(Math.max(120, Math.min(center.height - 140, center.bottom - ev.clientY))) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="splitter" onMouseDown={down} onDoubleClick={() => useStore.getState().updateSettings({ editTimelineHeight: null })} title="Drag to resize the timeline · double-click to reset" />
}

// ---- first-run / missing-project states ----
function Setup() {
  const projectsDir = useStore((s) => s.settings.projectsDir)
  const project = useStore((s) => s.currentProject())
  const chooseProjectsDir = useStore((s) => s.chooseProjectsDir)
  if (!projectsDir) {
    return (
      <div className="edit-setup">
        <h2>Where should projects be saved?</h2>
        <p className="dim">Each project becomes a folder there (e.g. “Omniwield”), with one small file per section you cut. Footage stays where it is — it's only referenced, never copied. Your existing projects move there too.</p>
        <button className="btn accent" onClick={chooseProjectsDir}>Choose a folder…</button>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="edit-setup">
        <h2>Pick a project</h2>
        <p className="dim">Choose or create a project at the top left. Its recordings appear there, ready to cut into sections.</p>
      </div>
    )
  }
  return null
}

export default function EditWorkspace() {
  const section = useStore((s) => s.currentSection())
  const projectsDir = useStore((s) => s.settings.projectsDir)
  const project = useStore((s) => s.currentProject())
  useEffect(() => bus.on('exportSection', () => useStore.getState().openModal('exportSection')), [])
  const modal = useStore((s) => s.modal)
  useEffect(() => { useStore.getState().loadSections() }, [project && project.id, project && project.folder])
  useEffect(() => bus.on('editNextCut', (dir) => {
    const s = useStore.getState().currentSection()
    if (!s) return
    const t = seqPlayer.getTime()
    const pts = EM.cutPoints(s.clips)
    const target = dir > 0 ? pts.find((p) => p > t + 1e-3) : [...pts].reverse().find((p) => p < t - 1e-3)
    if (target != null) seqPlayer.seek(target)
  }), [])
  useEffect(() => startEditSkipSilence(), [])
  const ready = projectsDir && project
  const etH = useStore((s) => s.settings.editTimelineHeight)
  const sideHidden = useStore((s) => !!s.settings.editSidebarHidden)
  const panelHidden = useStore((s) => !!s.settings.editPanelHidden)
  return (
    <div className={'app edit-app' + (sideHidden ? ' side-hidden' : '')}>
      {!sideHidden && <EditSidebar />}
      <section className="center edit-center" style={{ '--et-h': etH ? etH + 'px' : undefined }}>
        {ready ? (
          <>
            <div className="edit-upper">
              <Monitor section={section} />
              {!panelHidden && <EditPanel section={section} />}
            </div>
            <EditSplitter />
            <EditTimeline section={section} />
          </>
        ) : (
          <Setup />
        )}
      </section>
      {modal === 'removeSilence' && <RemoveSilenceDialog />}
      {modal === 'cutAround' && <CutAroundDialog />}
      {modal === 'exportSection' && <ExportSectionDialog onExport={exportSection} />}
    </div>
  )
}
