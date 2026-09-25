import React, { useMemo, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { fmtDay, fmtDuration, fmtHours } from '../lib/time.js'
import { clipTitle } from './Library.jsx'

// Pick recordings to add to the current project — by hand, per the user's
// wish that nothing lands in a project automatically.
export default function AddFootageModal() {
  const clips = useStore((s) => s.clips)
  const project = useStore((s) => s.currentProject())
  const addToProject = useStore((s) => s.addToProject)
  const closeModal = useStore((s) => s.closeModal)
  const showToast = useStore((s) => s.showToast)
  const trackColors = useTrackColors()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [hideShort, setHideShort] = useState(true)
  const folders = useStore((s) => s.settings.folders)
  const addFolders = useStore((s) => s.addFolders)
  const addFiles = useStore((s) => s.addFiles)
  const [busy, setBusy] = useState(false)

  // Pick a folder (any drive) or loose files; whatever they bring in gets
  // pre-ticked, so it's one more click to add them to the project.
  async function browse(kind) {
    setBusy(true)
    try {
      const keys = kind === 'folder' ? await addFolders() : await addFiles()
      if (keys.length) {
        setSel((s) => new Set([...s, ...keys.filter((k) => !inProject.has(k))]))
        setQ('')
        setHideShort(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const inProject = new Set(project ? project.clipKeys : [])
  const groups = useMemo(() => {
    const text = q.trim().toLowerCase()
    const rows = clips
      .filter((c) => !text || (c.name + ' ' + c.folder + ' ' + fmtDay(c.recordedAt)).toLowerCase().includes(text))
      .filter((c) => !hideShort || !c.probe || c.probe.duration >= 60)
      .sort((a, b) => b.recordedAt - a.recordedAt)
    const out = []
    for (const c of rows) {
      const day = fmtDay(c.recordedAt)
      let g = out[out.length - 1]
      if (!g || g.day !== day) out.push((g = { day, clips: [] }))
      g.clips.push(c)
    }
    return out
  }, [clips, q, hideShort])

  if (!project) return null
  const toggle = (keys, on) =>
    setSel((s) => {
      const n = new Set(s)
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)))
      return n
    })
  const chosen = clips.filter((c) => sel.has(c.key))
  const chosenDur = chosen.reduce((a, c) => a + ((c.probe && c.probe.duration) || 0), 0)

  function add() {
    addToProject(project.id, [...sel])
    showToast(`Added ${sel.size} recording${sel.size === 1 ? '' : 's'} to “${project.name}”`)
    closeModal()
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>Add footage to “{project.name}”</h2>
          <button className="icon-btn" onClick={closeModal}>×</button>
        </div>
        <div className="addf-body">
          <div className="row">
            <input className="lib-search" style={{ flex: 1 }} placeholder="Search by date or file name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <label className="check"><input type="checkbox" checked={hideShort} onChange={(e) => setHideShort(e.target.checked)} /> Hide clips under 1 min</label>
          </div>
          <div className="row addf-sources">
            <button className="btn small" disabled={busy} onClick={() => browse('folder')} title="Pick a folder on any drive — every recording inside (and in its subfolders) shows up here">📁 Add a folder…</button>
            <button className="btn small" disabled={busy} onClick={() => browse('files')} title="Pick individual recordings from anywhere on your PC">🎞 Add files…</button>
            <span className="dim small addf-folders" title={folders.join('\n')}>
              {busy ? 'Scanning…' : `Looking in: ${folders.join(' · ') || 'no folders yet'}`}
            </span>
          </div>
          <div className="addf-list">
            {groups.map((g) => {
              const addable = g.clips.filter((c) => !inProject.has(c.key)).map((c) => c.key)
              const allOn = addable.length > 0 && addable.every((k) => sel.has(k))
              return (
                <div key={g.day} className="addf-group">
                  <label className="addf-day">
                    <input type="checkbox" disabled={!addable.length} checked={allOn} onChange={(e) => toggle(addable, e.target.checked)} />
                    <span>{g.day}</span>
                    <span className="dim small">{fmtDuration(g.clips.reduce((a, c) => a + ((c.probe && c.probe.duration) || 0), 0))}</span>
                  </label>
                  {g.clips.map((c) => {
                    const has = inProject.has(c.key)
                    return (
                      <label key={c.key} className={'addf-row' + (has ? ' has' : '')} title={c.path}>
                        <input type="checkbox" disabled={has} checked={has || sel.has(c.key)} onChange={(e) => toggle([c.key], e.target.checked)} />
                        <span className="addf-name">{clipTitle(c)}</span>
                        <span className="dim small mono">{c.name}</span>
                        <span className="tracks">
                          {c.probe && c.probe.audio && c.probe.audio.map((a, i) => (
                            <i key={i} className={'tdot' + (a.likelySilent ? ' empty' : '')} style={{ '--c': trackColors[i] }} />
                          ))}
                        </span>
                        <span className="dim small mono">{c.probe ? fmtDuration(c.probe.duration) : '…'}</span>
                        {has && <span className="dim small">in project</span>}
                      </label>
                    )
                  })}
                </div>
              )
            })}
            {!groups.length && <div className="lib-empty dim">No recordings match.</div>}
          </div>
          <div className="addf-foot">
            <span className="dim small">{sel.size ? `${sel.size} selected · ${fmtHours(chosenDur)}` : 'Tick recordings (or a whole day) to add them.'}</span>
            <button className="btn primary" disabled={!sel.size} onClick={add}>Add {sel.size || ''} to project</button>
          </div>
        </div>
      </div>
    </div>
  )
}
