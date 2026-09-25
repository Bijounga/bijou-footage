import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { fmtDuration, fmtDay, fmtClock, fmtHours } from '../lib/time.js'
import { WorkspaceSwitch } from './EditWorkspace.jsx'

const OBS_NAME = /^\d{4}-\d{2}-\d{2}[ _]\d{2}-\d{2}-\d{2}/

// Status is only what the user chose (Start review / Mark reviewed).
export function clipProgress(clip, review) {
  const status = review && review.done ? 'done' : review && review.started ? 'started' : 'new'
  return { status }
}

export function clipTitle(c) {
  return OBS_NAME.test(c.name) ? fmtClock(c.recordedAt) : c.name.replace(/\.[^.]+$/, '')
}

function useOutsideClose(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return ref
}

export function ProjectPicker({ clipCount }) {
  const projects = useStore((s) => s.projects)
  const current = useStore((s) => s.currentProject())
  const setCurrentProject = useStore((s) => s.setCurrentProject)
  const createProject = useStore((s) => s.createProject)
  const renameProject = useStore((s) => s.renameProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(null) // 'new' | 'rename'
  const ref = useOutsideClose(open, setOpen)

  function commit(value) {
    const name = value.trim()
    if (naming === 'new' && name) createProject(name)
    if (naming === 'rename' && current && name) renameProject(current.id, name)
    setNaming(null)
  }

  if (naming) {
    return (
      <div className="project-picker">
        <input
          className="project-name-input"
          autoFocus
          placeholder="Project name (e.g. Allumeria)"
          defaultValue={naming === 'rename' && current ? current.name : ''}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur()
            if (e.key === 'Escape') setNaming(null)
            e.stopPropagation()
          }}
        />
      </div>
    )
  }

  return (
    <div className="project-picker" ref={ref}>
      <button className="project-btn" onClick={() => setOpen(!open)} title="Switch project">
        <span className="project-icon">{current ? '▣' : '▤'}</span>
        <span className="project-label">{current ? current.name : 'All footage'}</span>
        <span className="dim">▾</span>
      </button>
      {current && (
        <>
          <button className="icon-btn small" title="Rename project" onClick={() => setNaming('rename')}>✎</button>
          <button
            className="icon-btn small"
            title="Delete project (your notes are kept — they belong to the recordings)"
            onClick={() => { if (window.confirm(`Delete project “${current.name}”? Notes on its recordings are kept.`)) deleteProject(current.id) }}
          >
            🗑
          </button>
        </>
      )}
      {open && (
        <div className="menu project-menu">
          <button className={!current ? 'on' : ''} onClick={() => { setCurrentProject(null); setOpen(false) }}>
            <span>All footage</span><span className="dim small">{clipCount}</span>
          </button>
          {projects.length > 0 && <div className="menu-sep" />}
          {projects.map((p) => (
            <button key={p.id} className={current && current.id === p.id ? 'on' : ''} onClick={() => { setCurrentProject(p.id); setOpen(false) }}>
              <span>{p.name}</span><span className="dim small">{p.clipKeys.length}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="accent" onClick={() => { setOpen(false); setNaming('new') }}>＋ New project…</button>
        </div>
      )}
    </div>
  )
}

// Hover "+" on a row in All footage: add that recording to a project.
function AddToProjectMenu({ clipKey }) {
  const projects = useStore((s) => s.projects)
  const addToProject = useStore((s) => s.addToProject)
  const createProject = useStore((s) => s.createProject)
  const showToast = useStore((s) => s.showToast)
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, setOpen)
  return (
    <span className="row-action" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="row-btn" title="Add to a project" onClick={() => setOpen(!open)}>＋</button>
      {open && (
        <div className="menu row-menu">
          <div className="dim small menu-title">Add to project</div>
          {projects.map((p) => {
            const has = p.clipKeys.includes(clipKey)
            return (
              <button key={p.id} disabled={has} onClick={() => { addToProject(p.id, [clipKey]); setOpen(false); showToast(`Added to “${p.name}”`) }}>
                <span>{p.name}</span>{has && <span className="dim small">added</span>}
              </button>
            )
          })}
          <button
            className="accent"
            onClick={() => {
              const name = window.prompt('New project name')
              if (name && name.trim()) {
                const id = createProject(name.trim())
                addToProject(id, [clipKey])
              }
              setOpen(false)
            }}
          >
            ＋ New project…
          </button>
        </div>
      )}
    </span>
  )
}

export default function Library() {
  const clips = useStore((s) => s.clips)
  const reviews = useStore((s) => s.reviews)
  const currentKey = useStore((s) => s.currentKey)
  const folders = useStore((s) => s.settings.folders)
  const scanning = useStore((s) => s.scanning)
  const filter = useStore((s) => s.libraryFilter)
  const setFilter = useStore((s) => s.setLibraryFilter)
  const openClip = useStore((s) => s.openClip)
  const addFolders = useStore((s) => s.addFolders)
  const openModal = useStore((s) => s.openModal)
  const toggleLibrary = useStore((s) => s.toggleLibrary)
  const project = useStore((s) => s.currentProject())
  const removeFromProject = useStore((s) => s.removeFromProject)
  const trackColors = useTrackColors()

  const { groups, stats, visibleCount, scopeCount } = useMemo(() => {
    const scope = project ? project.clipKeys.map((k) => clips.find((c) => c.key === k)).filter(Boolean) : clips
    let total = 0
    let notes = 0
    const text = filter.text.trim().toLowerCase()
    const rows = []
    for (const c of scope) {
      const r = reviews[c.key]
      const dur = c.probe ? c.probe.duration : 0
      total += dur
      const p = clipProgress(c, r)
      notes += r ? r.notes.filter((n) => n.type !== 'BREAK').length : 0
      if (filter.status !== 'all' && p.status !== filter.status) continue
      if (text) {
        const hay = (c.name + ' ' + c.folder + ' ' + (r ? r.notes.map((n) => n.text).join(' ') : '')).toLowerCase()
        if (!hay.includes(text)) continue
      }
      rows.push({ c, r, p })
    }
    // Projects read in story order (oldest first); the whole library newest first.
    rows.sort((a, b) => (project ? a.c.recordedAt - b.c.recordedAt : b.c.recordedAt - a.c.recordedAt))
    const order = project ? scope.slice().sort((a, b) => a.recordedAt - b.recordedAt).map((c) => c.key) : null
    const groups = []
    for (const row of rows) {
      const day = fmtDay(row.c.recordedAt)
      let g = groups[groups.length - 1]
      if (!g || g.day !== day) groups.push((g = { day, rows: [], dur: 0 }))
      row.index = order ? order.indexOf(row.c.key) + 1 : null
      g.rows.push(row)
      g.dur += row.c.probe ? row.c.probe.duration : 0
    }
    return { groups, stats: { total, notes, count: scope.length }, visibleCount: rows.length, scopeCount: scope.length }
  }, [clips, reviews, filter, project])

  const missing = project ? project.clipKeys.filter((k) => !clips.some((c) => c.key === k)).length : 0

  return (
    <aside className="library">
      <div className="lib-top">
        <div className="brand">
          <span className="brand-mark">▶</span> Bijou Footage
        </div>
        <button className="icon-btn" title="Settings" onClick={() => openModal('settings')}>⚙</button>
        <button className="icon-btn" title="Keyboard shortcuts — change any key (?)" onClick={() => openModal('help')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
            <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
          </svg>
        </button>
        <button className="icon-btn" title="Hide library (Ctrl+\)" onClick={toggleLibrary}>«</button>
      </div>

      <WorkspaceSwitch />
      {folders.length > 0 && <ProjectPicker clipCount={clips.length} />}

      {scopeCount > 0 && (
        <div className="lib-stats">
          <div className="lib-stat-text">
            {stats.count} recording{stats.count === 1 ? '' : 's'} · {fmtHours(stats.total)} · {stats.notes} notes
          </div>
        </div>
      )}

      {project && (
        <div className="lib-project-actions">
          <button className="btn small accent block" onClick={() => openModal('addFootage')}>＋ Add footage</button>
        </div>
      )}

      {folders.length > 0 && scopeCount > 0 && (
        <div className="lib-filters">
          <input
            className="lib-search"
            placeholder="Search recordings and notes…"
            value={filter.text}
            onChange={(e) => setFilter({ text: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && (setFilter({ text: '' }), e.target.blur())}
          />
          <div className="seg">
            {[['all', 'All'], ['new', 'Not started'], ['started', 'Started'], ['done', 'Done']].map(([k, l]) => (
              <button key={k} className={filter.status === k ? 'on' : ''} onClick={() => setFilter({ status: k })}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <div className="lib-list">
        {folders.length === 0 && (
          <div className="lib-empty">
            <p>Point Bijou Footage at the folder OBS records into.</p>
            <button className="btn primary" onClick={addFolders}>Add recordings folder…</button>
            <p className="dim small">Your files are never moved, copied or re-encoded — they play straight from where they are.</p>
          </div>
        )}
        {project && scopeCount === 0 && (
          <div className="lib-empty">
            <p>No footage in <b>{project.name}</b> yet.</p>
            <button className="btn primary" onClick={() => openModal('addFootage')}>Add footage…</button>
            <p className="dim small">Pick the recordings you want to review for this video. Your notes stay on each recording, so it can be in more than one project.</p>
          </div>
        )}
        {folders.length > 0 && scanning && clips.length === 0 && <div className="lib-empty dim">Scanning…</div>}
        {folders.length > 0 && !scanning && scopeCount > 0 && visibleCount === 0 && <div className="lib-empty dim">Nothing matches that filter.</div>}
        {!project && folders.length > 0 && !scanning && clips.length === 0 && <div className="lib-empty dim">No videos found in your folders.</div>}
        {groups.map((g) => (
          <div key={g.day} className="lib-group">
            <div className="lib-day" title={`${fmtDuration(g.dur)} recorded this day (${g.rows.length} recording${g.rows.length === 1 ? '' : 's'})`}>
              <span>{g.day}</span>
            </div>
            {g.rows.map(({ c, r, p, index }) => {
              const noteCount = r ? r.notes.filter((n) => n.type !== 'BREAK').length : 0
              return (
                <div
                  key={c.key}
                  className={'lib-row' + (c.key === currentKey ? ' active' : '') + ' st-' + p.status}
                  onClick={() => openClip(c.key)}
                  title={c.path}
                >
                  <div className="lib-row-main">
                    {index != null && <span className="lib-index">{index}</span>}
                    <span className="lib-name">{clipTitle(c)}</span>
                    <span className="lib-dur">{c.probe ? fmtDuration(c.probe.duration) : c.probe === null ? '…' : '?'}</span>
                    {project ? (
                      <span className="row-action" onClick={(e) => e.stopPropagation()}>
                        <button className="row-btn" title={`Remove from “${project.name}” (notes are kept)`} onClick={() => removeFromProject(project.id, c.key)}>×</button>
                      </span>
                    ) : (
                      <AddToProjectMenu clipKey={c.key} />
                    )}
                  </div>
                  <div className="lib-row-sub">
                    <span className="tracks">
                      {c.probe && c.probe.audio && c.probe.audio.map((a, i) => (
                        <i key={i} className={'tdot' + (a.likelySilent ? ' empty' : '')} style={{ '--c': trackColors[i] }} title={'Track ' + (i + 1) + (a.likelySilent ? ' (empty)' : '')} />
                      ))}
                      {c.probe && c.probe.vcodec === 'hevc' && <span className="tag">HEVC</span>}
                      {c.probe && c.probe.error && <span className="tag bad">unreadable</span>}
                    </span>
                    {noteCount > 0 && <span className="lib-notes">{noteCount} ✎</span>}
                    {p.status === 'started' && <span className="lib-status started" title="You started reviewing this">● started</span>}
                    {p.status === 'done' && <span className="lib-done" title="Marked reviewed">✓</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {missing > 0 && <div className="lib-empty dim small">{missing} recording{missing === 1 ? '' : 's'} in this project aren't in your folders right now (moved or drive unplugged).</div>}
      </div>
    </aside>
  )
}
