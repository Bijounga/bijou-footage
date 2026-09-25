import React, { useEffect, useMemo, useState } from 'react'
import { useStore, DEFAULT_TRACK_NAMES, TRACK_COLORS, useTrackColors, fmtBytes } from '../state/store.js'
import { fmtTime, fmtDay, fmtClock } from '../lib/time.js'
import { LABEL } from '../lib/beats.js'
import { useBeatColor } from './NotesPanel.jsx'
import { BUILT_IN_THEMES } from '../lib/themes.js'
import { UpdatesSection } from './Updates.jsx'
import { ToolsSection } from './ToolsSetup.jsx'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ExportModal() {
  const ids = useStore((s) => s.exportSelection) || []
  const clips = useStore((s) => s.clips)
  const reviews = useStore((s) => s.reviews)
  const includeSource = useStore((s) => s.settings.includeSource)
  const updateSettings = useStore((s) => s.updateSettings)
  const closeModal = useStore((s) => s.closeModal)
  const markExported = useStore((s) => s.markExported)
  const showToast = useStore((s) => s.showToast)
  const color = useBeatColor()
  const [scripts, setScripts] = useState(null)
  const [dir, setDir] = useState('')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState(null) // script id or 'new'
  const [newTitle, setNewTitle] = useState(() => {
    const p = useStore.getState().currentProject()
    return p ? p.name : ''
  })
  const [chainPerClip, setChainPerClip] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const project = useStore((s) => s.currentProject())
  const setProjectScript = useStore((s) => s.setProjectScript)
  useEffect(() => {
    window.footage.listScripts().then((r) => {
      setScripts(r.scripts)
      setDir(r.dir)
      // Each project remembers the script it last sent to.
      if (project && project.bijouScriptId && r.scripts.some((x) => x.id === project.bijouScriptId)) setTarget(project.bijouScriptId)
    })
  }, [])

  // Beats in story order: recordings by recording time, notes by time,
  // keeping the user's own scene breaks, plus (optionally) a break between
  // recordings so each session becomes its own chain on the map.
  const { beats, clipCount } = useMemo(() => {
    const idSet = new Set(ids)
    const out = []
    let clipCount = 0
    const sorted = clips.filter((c) => reviews[c.key]).sort((a, b) => a.recordedAt - b.recordedAt)
    for (const c of sorted) {
      const notes = reviews[c.key].notes
      const chosen = notes.filter((n) => idSet.has(n.id))
      if (!chosen.length) continue
      clipCount++
      if (chainPerClip && out.length) out.push({ type: 'BREAK' })
      const lo = chosen[0].t
      const hi = chosen[chosen.length - 1].t
      for (const n of notes) {
        if (n.type === 'BREAK') {
          if (n.t > lo && n.t < hi && out.length && out[out.length - 1].type !== 'BREAK') out.push({ type: 'BREAK' })
          continue
        }
        if (!idSet.has(n.id) || n.type === 'MARKER') continue
        out.push({ id: n.id, type: n.type, text: n.text, t: n.t, end: n.end ?? null, clipName: c.name, clipPath: c.path })
      }
    }
    return { beats: out, clipCount }
  }, [ids, clips, reviews, chainPerClip])

  const beatCount = beats.filter((b) => b.type !== 'BREAK').length
  const filtered = (scripts || []).filter((s) => s.title.toLowerCase().includes(q.trim().toLowerCase()))

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const r = await window.footage.exportToBijou({
        targetId: target === 'new' ? null : target,
        newTitle: newTitle.trim() || 'Footage notes',
        beats: beats.map(({ id, ...b }) => b),
        includeSource
      })
      markExported(beats.filter((b) => b.id).map((b) => b.id))
      if (project) setProjectScript(project.id, r.id)
      showToast(`Added ${r.count} beat${r.count === 1 ? '' : 's'} to “${r.title}” mind map`)
      closeModal()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Send to BijouDocs mind map" onClose={closeModal} wide>
      <div className="export-body">
        <div className="export-left">
          <div className="dim small">
            {beatCount} beat{beatCount === 1 ? '' : 's'} from {clipCount} recording{clipCount === 1 ? '' : 's'} — added as connected idea nodes, in a fresh column so nothing already on the map moves.
          </div>
          <div className="export-preview">
            {beats.map((b, i) =>
              b.type === 'BREAK' ? (
                <div key={'b' + i} className="xp-break" />
              ) : (
                <div key={b.id} className="xp-node" style={{ '--c': color(b.type) }}>
                  <div className="xp-title">{LABEL[b.type]}</div>
                  <div className="xp-text">{b.text || <span className="dim">(empty)</span>}</div>
                  {includeSource && <div className="xp-src">[{b.clipName.replace(/\.[^.]+$/, '')} @ {fmtTime(b.t)}{b.end != null ? '–' + fmtTime(b.end) : ''}]</div>}
                </div>
              )
            )}
          </div>
          <label className="check"><input type="checkbox" checked={includeSource} onChange={(e) => updateSettings({ includeSource: e.target.checked })} /> Put recording + timecode on each node</label>
          <label className="check"><input type="checkbox" checked={chainPerClip} onChange={(e) => setChainPerClip(e.target.checked)} /> Separate chain for each recording</label>
        </div>
        <div className="export-right">
          <input className="lib-search" placeholder="Find a script…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="script-list">
            <div className={'script-row new' + (target === 'new' ? ' on' : '')} onClick={() => setTarget('new')}>
              <span>＋ New script</span>
              {target === 'new' && (
                <input
                  autoFocus
                  placeholder="Title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
            {scripts === null && <div className="dim small pad">Loading scripts…</div>}
            {filtered.map((s) => (
              <div key={s.id} className={'script-row' + (target === s.id ? ' on' : '')} onClick={() => setTarget(s.id)} onDoubleClick={() => { setTarget(s.id); }}>
                <span>{s.title}</span>
                <span className="dim small">{s.updatedAt ? fmtDay(s.updatedAt) : ''}</span>
              </div>
            ))}
          </div>
          <div className="dim small">BijouDocs folder: {dir}</div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn primary block" disabled={!target || !beatCount || busy} onClick={send}>
            {busy ? 'Sending…' : target ? `Send ${beatCount} beats` : 'Pick a script'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Settings → Storage: what's using space, the cache limit, and cleanup.
function StorageSection() {
  const settings = useStore((s) => s.settings)
  const cache = useStore((s) => s.cache)
  const [stats, setStats] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const refresh = () => window.footage.cacheStats().then(setStats)
  React.useEffect(() => { refresh() }, [cache.size])
  const limit = settings.cacheLimitGB || 20
  const mode = settings.cacheMode || 'remind'
  const setPolicy = (l, m) => useStore.getState().setCachePolicy(l, m)
  const pct = stats ? Math.min(100, (100 * stats.total) / (limit * 1024 ** 3)) : 0
  const act = async (fn) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false); refresh() }
  }
  return (
    <section>
      <h3>Storage</h3>
      <p className="dim small">
        The media cache holds each recording's audio tracks copied out into small files (no re-encoding) plus its waveform — it's what makes seeking and multi-track playback instant. Deleting it loses nothing: a recording's cache is rebuilt the next time you open it.
      </p>
      <div className="storage-bar" title={stats ? `${fmtBytes(stats.total)} of ${limit} GB` : ''}>
        <div className={'sb-fill' + (pct >= 100 ? ' over' : pct >= 85 ? ' near' : '')} style={{ width: pct + '%' }} />
      </div>
      <div className="storage-rows">
        <div><span>Media cache</span><b>{stats ? fmtBytes(stats.total) : '…'}</b><span className="dim small">of {limit} GB{stats ? ` · ${stats.recordings} recording${stats.recordings === 1 ? '' : 's'}` : ''}</span></div>
        <div className="sub"><span>Audio tracks</span><span>{stats ? fmtBytes(stats.audio) : '…'}</span></div>
        <div className="sub"><span>Waveforms</span><span>{stats ? fmtBytes(stats.waveforms) : '…'}</span></div>
        <div><span>Transcripts</span><b>{stats ? fmtBytes(stats.transcripts) : '…'}</b><span className="dim small">{stats ? `${stats.transcriptFiles} track${stats.transcriptFiles === 1 ? '' : 's'} · kept (they took GPU time to make)` : ''}</span></div>
      </div>
      <label className="inline wide">
        Cache limit
        {/* Applied when you finish typing (Enter / leaving the box) — never
            mid-typing, where "15" would briefly be "1" and, in auto mode,
            delete most of the cache. */}
        <input
          key={limit}
          type="number"
          min="1"
          max="2000"
          defaultValue={limit}
          onBlur={(e) => { const v = Math.max(1, Math.round(Number(e.target.value)) || limit); if (v !== limit) setPolicy(v, mode); else e.target.value = limit }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="num-input"
        /> GB
      </label>
      <label className="inline wide">
        When it's over the limit
        <select value={mode} onChange={(e) => setPolicy(limit, e.target.value)}>
          <option value="remind">Remind me (pause background prep)</option>
          <option value="auto">Delete the oldest automatically</option>
        </select>
      </label>
      <div className="row-btns">
        <button className="btn small" disabled={busy || !stats || stats.total <= limit * 1024 ** 3} onClick={() => act(() => useStore.getState().trimCache())} title="Delete the prepared audio of the recordings you opened longest ago, until it fits">Delete oldest to fit</button>
        <button className="btn small danger" disabled={busy || !stats || !stats.total} onClick={() => act(() => useStore.getState().emptyCache())} title="Delete all prepared audio and waveforms (the open recording is kept)">Delete cache</button>
        <button className="btn small ghost" onClick={() => stats && window.footage.openPath(stats.folder)}>Open folder</button>
      </div>
    </section>
  )
}

export function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const tools = useStore((s) => s.tools)
  const clips = useStore((s) => s.clips)
  const queue = useStore((s) => s.waveformQueue)
  const closeModal = useStore((s) => s.closeModal)
  const addFolders = useStore((s) => s.addFolders)
  const removeFolder = useStore((s) => s.removeFolder)
  const addFiles = useStore((s) => s.addFiles)
  const removeFile = useStore((s) => s.removeFile)
  const rescan = useStore((s) => s.rescan)
  const renameTrack = useStore((s) => s.renameTrack)
  const setTrackColor = useStore((s) => s.setTrackColor)
  const trackColors = useTrackColors()
  const updateSettings = useStore((s) => s.updateSettings)
  const buildAll = useStore((s) => s.buildAllWaveforms)
  const bijouThemes = useStore((s) => s.bijouThemes)
  const allThemes = [...BUILT_IN_THEMES, ...bijouThemes]
  const setTheme = useStore((s) => s.setTheme)
  const refreshBijouThemes = useStore((s) => s.refreshBijouThemes)
  const frameless = useStore((s) => s.frameless)
  const setHideTitleBar = useStore((s) => s.setHideTitleBar)
  // Pick up themes made in BijouDocs since this app started.
  useEffect(() => { refreshBijouThemes() }, [])
  const titleBarPending = !!settings.hideTitleBar !== frameless

  return (
    <Modal title="Settings" onClose={closeModal}>
      <div className="settings">
        <UpdatesSection />
        <ToolsSection />
        <section>
          <h3>Theme</h3>
          <div className="theme-grid">
            {allThemes.map((t) => (
              <button key={t.id} className={'theme-card' + ((settings.theme || 'dark') === t.id ? ' on' : '')} onClick={() => setTheme(t.id)} title={t.note ? t.name + ' — ' + t.note : t.name}>
                <span className="theme-swatch" style={{ background: t.colors['--bg'] }}>
                  <i style={{ background: t.colors['--panel'] }} />
                  <i style={{ background: t.colors['--panel-3'] }} />
                  <i style={{ background: t.colors['--cyan'] }} />
                  <i style={{ background: t.colors['--ink'] }} />
                </span>
                <span className="theme-name">{t.name}</span>
                {t.note && <span className="theme-note">{t.note}</span>}
              </button>
            ))}
          </div>
          <p className="dim small">Includes BijouDocs' themes, and any custom themes you make there. The video area always stays black.</p>
        </section>
        <section>
          <h3>Window</h3>
          <label className="check">
            <input type="checkbox" checked={!!settings.hideTitleBar} onChange={(e) => setHideTitleBar(e.target.checked)} />
            Hide the Windows title bar (more room — drag the window by the app's top strips)
          </label>
          {titleBarPending && (
            <div className="row">
              <span className="dim small">The window reopens to apply this (everything's saved).</span>
              <button className="btn small primary" onClick={() => { useStore.getState().flushSave(); window.footage.recreateWindow() }}>Apply now</button>
            </div>
          )}
          <p className="dim small">For every last pixel, <b>Full screen</b> (F11, changeable in Keyboard shortcuts) also covers the taskbar.</p>
        </section>
        <section>
          <h3>Recordings folders &amp; files</h3>
          {settings.folders.map((f) => (
            <div key={f} className="folder-row">
              <span>{f}</span>
              <button className="btn small ghost" onClick={() => removeFolder(f)}>Remove</button>
            </div>
          ))}
          {(settings.files || []).map((f) => (
            <div key={f} className="folder-row">
              <span title="Added as a single file">🎞 {f}</span>
              <button className="btn small ghost" onClick={() => removeFile(f)}>Remove</button>
            </div>
          ))}
          <div className="row">
            <button className="btn small" onClick={addFolders}>Add folder…</button>
            <button className="btn small" onClick={addFiles}>Add files…</button>
            <button className="btn small ghost" onClick={rescan}>Rescan</button>
            <span className="dim small">{clips.length} recordings found (subfolders included)</span>
          </div>
        </section>
        <section>
          <h3>Tracks</h3>
          <p className="dim small">Your OBS audio tracks, in order: default name and color. To name a track differently in one recording, rename it on the timeline. Tracks that are silent in a recording are detected automatically.</p>
          <div className="track-names">
            {settings.trackNames.slice(0, 6).map((n, i) => (
              <label key={i} style={{ '--c': trackColors[i] }}>
                <span className="th-color" title="Track color · right-click to reset" onContextMenu={(e) => { e.preventDefault(); setTrackColor(i, null) }}>
                  <input type="color" value={trackColors[i]} onChange={(e) => setTrackColor(i, e.target.value)} />
                </span>
                {i + 1}
                <input defaultValue={n} placeholder={DEFAULT_TRACK_NAMES[i]} onBlur={(e) => renameTrack(i, e.target.value.trim())} />
              </label>
            ))}
          </div>
          <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => TRACK_COLORS.forEach((_, i) => setTrackColor(i, null))}>Reset colors</button>
          <label className="check"><input type="checkbox" checked={settings.autoMuteEmpty} onChange={(e) => updateSettings({ autoMuteEmpty: e.target.checked })} /> Auto-mute tracks that are empty in a recording</label>
        </section>
        <section>
          <h3>Reviewing</h3>
          <label className="inline wide" title="How quiet talking can be and still count, for the A speech markers and Ctrl+→ skip">Speech detection sensitivity <input type="range" min="0" max="1" step="0.05" value={settings.speechSensitivity ?? 0.5} onChange={(e) => updateSettings({ speechSensitivity: Number(e.target.value) })} /> <span className="dim small">{Math.round((settings.speechSensitivity ?? 0.5) * 100)}%</span></label>
          <label className="check"><input type="checkbox" checked={!!settings.noteColorBars} onChange={(e) => updateSettings({ noteColorBars: e.target.checked })} /> Color strip on the left of each note (beat / marker color)</label>
          <label className="check"><input type="checkbox" checked={settings.pauseWhileTyping} onChange={(e) => updateSettings({ pauseWhileTyping: e.target.checked })} /> Pause while typing a note (resumes on Enter)</label>
          <label className="check"><input type="checkbox" checked={settings.instantSeek !== false} onChange={(e) => updateSettings({ instantSeek: e.target.checked })} /> Instant seeks while playing</label>
          <p className="dim small">Clicking or skipping while playing starts from the nearest keyframe (up to ~2–4s before the spot, so you never miss it) and keeps playing with no delay. Seeks while paused are always frame-exact.</p>
          <div className="row">
            <label className="inline">Arrow skip <input type="number" min="1" max="120" value={settings.skipSmall} onChange={(e) => updateSettings({ skipSmall: Math.max(1, Number(e.target.value) || 5) })} /> s</label>
            <label className="inline">Shift+Arrow skip <input type="number" min="1" max="600" value={settings.skipBig} onChange={(e) => updateSettings({ skipBig: Math.max(1, Number(e.target.value) || 30) })} /> s</label>
          </div>
        </section>
        <section>
          <h3>Transcription</h3>
          <p className="dim small">Runs on your graphics card (Whisper large-v3-turbo). Pick which tracks get transcribed in the Transcript tab.</p>
          <label className="check"><input type="checkbox" checked={settings.autoTranscribeOpen !== false} onChange={(e) => updateSettings({ autoTranscribeOpen: e.target.checked })} /> Transcribe a recording when I open it</label>
          <label className="check"><input type="checkbox" checked={!!settings.autoTranscribeAll} onChange={(e) => { updateSettings({ autoTranscribeAll: e.target.checked }); if (e.target.checked) useStore.getState().autoTranscribe() }} /> Transcribe everything in the background (newest first — keeps the graphics card busy)</label>
          <label className="inline wide">Language <select value={settings.transcriptLang ?? 'en'} onChange={(e) => updateSettings({ transcriptLang: e.target.value })}>
            <option value="en">English</option>
            <option value="">Detect automatically</option>
          </select></label>
        </section>
        <StorageSection />
        <section>
          <h3>Waveforms &amp; ffmpeg</h3>
          <div className="dim small">
            ffmpeg: {tools.ffmpeg || <b className="error-text">not found</b>} · ffprobe: {tools.ffprobe || <b className="error-text">not found</b>}
          </div>
          <label className="inline wide">ffmpeg folder (optional) <input defaultValue={settings.ffmpegDir} placeholder="C:\ffmpeg\bin" onBlur={(e) => updateSettings({ ffmpegDir: e.target.value.trim() })} /></label>
          <label className="check"><input type="checkbox" checked={settings.autoPrepare !== false} onChange={(e) => updateSettings({ autoPrepare: e.target.checked })} /> Prepare every recording in the background</label>
          <p className="dim small">Builds waveforms and copies each audio track into a small file (no re-encoding), so seeking and multi-track playback are instant. Newest recordings first; whatever you open jumps the queue. Its size limit is under Storage above.</p>
          <div className="row">
            {queue > 0 ? (
              <span className="dim small">{queue} recording{queue === 1 ? '' : 's'} left to prepare</span>
            ) : (
              <button className="btn small" onClick={buildAll}>Prepare all now</button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
