// The Voiceover tab: record your voiceover per section ("Eye of Cthulhu →
// Eater of Worlds"), as many takes as you like, each landing at the
// playhead; the section's clips play back to back. Sidebar: your sections.
// Main area: a toolbar (tools, snapping, auto-cut …), the timeline, and the
// record + transport bar with the microphone settings.
//
// Keys: lib/voKeys.js — R records, Shift+R re-records the clip, P punches in
// over a stretch, Space plays, F / D / A / S / G / V / C / W like Edit,
// J / K / L shuttle, T transcript, N notes. All rebindable.
import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { useVo, flushVoSave } from '../state/voStore.js'
import * as VM from '../lib/voModel.js'
import { CLIP_LABELS } from '../lib/editModel.js'
import { WATCH_SPEEDS } from '../lib/player.js'
import { voPlayer } from '../lib/voPlayer.js'
import { voKeymap } from '../lib/voKeys.js'
import { voRec, listMics } from '../lib/voRecorder.js'
import { onTick, bus } from '../lib/hooks.js'
import { fmtTime, fmtDuration } from '../lib/time.js'
import { IconSkipStart, IconSkipEnd, IconVolume } from './Icons.jsx'
import { ProjectPicker } from './Library.jsx'
import { Brand } from './Updates.jsx'
import { WorkspaceSwitch, Setup } from './EditWorkspace.jsx'
import VoTimeline from './VoTimeline.jsx'
import VoTranscript from './VoTranscript.jsx'
import ProjectPad from './ProjectPad.jsx'
import FontSize, { useCtrlWheelSize, stepSetting } from './FontSize.jsx'

const PREROLLS = [0, 1, 2, 3, 5]

// ---- speed: your chosen speed, plus L / J shuttling above or below it ----
function setSpeed(x) {
  voPlayer.setBase(x)
  useStore.getState().updateSettings({ voSpeed: x })
}

// ---- keys: lib/voKeys.js (rebindable: Keyboard shortcuts → Voiceover keys) ----
export function handleVoKey(combo, e) {
  const a = voKeymap(useStore.getState().settings.voKeybinds).get(combo)
  if (!a) return
  // while a take is being made only the recording keys work
  if (useVo.getState().rec && !a.rec) return
  e.preventDefault()
  a.run()
}

function useVoPlaying() {
  const [p, setP] = useState(voPlayer.playing)
  useEffect(() => {
    const off = [voPlayer.on('state', () => setP(voPlayer.playing)), voPlayer.on('ended', () => setP(false))]
    return () => off.forEach((o) => o())
  }, [])
  return p
}
function useVoTime(ms = 80) {
  const [t, setT] = useState(() => voPlayer.getTime())
  useEffect(() => onTick(ms, () => {
    const cur = voPlayer.getTime()
    setT((p) => (Math.abs(p - cur) > 0.001 ? cur : p))
  }), [ms])
  return t
}
// A small popup menu opened by a button (fixed position, closes on outside click).
function usePopup() {
  const [at, setAt] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!at) return
    const close = (e) => { if (!ref.current || !ref.current.contains(e.target)) setAt(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [at])
  const open = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAt(at ? null : { left: r.left, top: r.bottom + 6, bottom: window.innerHeight - r.top + 6 })
  }
  return { at, ref, open, close: () => setAt(null) }
}

// ---- sidebar: your VO sections ----
function VoSections() {
  const sections = useVo((s) => s.sections)
  const current = useVo((s) => s.current())
  const [editing, setEditing] = useState(null)
  const vo = useVo.getState()
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  return (
    <div className="es-block">
      <div className="es-head">
        <span>Voiceover sections</span>
        <button className="link-btn" onClick={() => setEditing(useVo.getState().createSection())} title="A new section — e.g. “Eye of Cthulhu → Eater of Worlds”">＋ New</button>
      </div>
      {!sorted.length && <div className="es-empty dim small">A section is one part of the video's voiceover — e.g. “Eye of Cthulhu → Eater of Worlds”. Each has its own recordings.</div>}
      {sorted.map((x, i) => {
        const on = current && current.id === x.id
        return (
          <div key={x.id} className={'es-row' + (on ? ' on' : '')} onClick={() => !on && vo.setCurrent(x.id)} onDoubleClick={() => setEditing(x.id)}>
            <span className="es-num">{i + 1}</span>
            {editing === x.id ? (
              <input
                className="es-rename"
                autoFocus
                defaultValue={x.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => { vo.renameSection(x.id, e.target.value); setEditing(null) }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
              />
            ) : (
              <span className="es-name" title="Double-click to rename">{x.name}</span>
            )}
            <span className="es-meta dim">{x.clips.length ? fmtDuration(VM.totalVo(x.clips)) : 'empty'}</span>
            <span className="es-actions" onClick={(e) => e.stopPropagation()}>
              <button className="row-btn" title="Move up" onClick={() => vo.moveSection(x.id, -1)}>↑</button>
              <button className="row-btn" title="Move down" onClick={() => vo.moveSection(x.id, 1)}>↓</button>
              <button className="row-btn" title="Rename" onClick={() => setEditing(x.id)}>✎</button>
              <button className="row-btn" title="Delete section (its file goes to the Recycle Bin; recordings stay on disk)" onClick={() => { if (confirm(`Delete the voiceover section “${x.name}”? (It goes to the Recycle Bin; its recordings stay in the project folder.)`)) vo.deleteSection(x.id) }}>×</button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function VoSidebar() {
  const openModal = useStore((s) => s.openModal)
  const clips = useStore((s) => s.clips)
  return (
    <aside className="library edit-side vo-side">
      <div className="lib-top">
        <Brand />
        <button className="icon-btn" title="Settings" onClick={() => openModal('settings')}>⚙</button>
        <button className="icon-btn" title="Keyboard shortcuts — change any Voiceover key here" onClick={() => openModal('help')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
            <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
          </svg>
        </button>
      </div>
      <WorkspaceSwitch />
      <ProjectPicker clipCount={clips.length} />
      <VoSections />
    </aside>
  )
}

// ---- the toolbar ----
function VoSpeed() {
  const [, bump] = useState(0)
  useEffect(() => voPlayer.on('state', () => bump((n) => n + 1)), [])
  const pop = usePopup()
  const r = voPlayer.rate
  return (
    <div className="speed">
      <button className={'t-rate' + (voPlayer.shuttle != null ? ' shuttle' : r !== 1 ? ' on' : '')} onClick={pop.open} title="Playback speed — pick your speed here. L plays and speeds up for a while, J slows down, K (or pausing) goes back to it. The pitch stays natural.">{r}×</button>
      {pop.at && (
        <div className="speed-menu" ref={pop.ref} style={{ left: pop.at.left, bottom: pop.at.bottom }}>
          <div className="dim small speed-title">Playback speed</div>
          {WATCH_SPEEDS.map((x) => (
            <button key={x} className={x === voPlayer.base ? 'on' : ''} onClick={() => { setSpeed(x); pop.close() }}>{x}×</button>
          ))}
        </div>
      )}
    </div>
  )
}

const NO_CLIPS = [] // (one shared empty list: a selector can't make a new one each time)
// The volume of the selected clips, in dB (committed when you let go: one undo step).
function LevelPopup({ pop }) {
  const sel = useVo((s) => s.sel)
  const clips = useVo((s) => { const c = s.current(); return c ? c.clips : NO_CLIPS })
  const picked = clips.filter((c) => sel.includes(c.id))
  const cur = picked.length ? picked[0].gain || 0 : 0
  const [v, setV] = useState(cur)
  useEffect(() => setV(cur), [cur, sel.join(',')])
  const commit = (x) => useVo.getState().setClipGain(x)
  return (
    <div className="vo-menu vo-level" ref={pop.ref} style={{ left: pop.at.left, top: pop.at.top }}>
      <div className="dim small vo-menu-title">Volume of {sel.length} clip{sel.length === 1 ? '' : 's'} — louder or quieter than recorded</div>
      <div className="vo-gain">
        <input type="range" min="-24" max="12" step="0.5" value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => commit(v)} onKeyUp={() => commit(v)} onDoubleClick={() => { setV(0); commit(0) }} />
        <span className="vo-gain-val">{v > 0 ? '+' : ''}{v.toFixed(1)} dB</span>
        <button className="vo-gain-reset" disabled={v === 0} onClick={() => { setV(0); commit(0) }} title="Back to as recorded">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.2A5 5 0 1 1 3 9.5" /><path d="M3 2.6v3.8h3.8" /></svg>
        </button>
      </div>
    </div>
  )
}

function VoToolbar() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const sel = useVo((s) => s.sel)
  const range = useVo((s) => s.range)
  const vo = useVo.getState()
  const tool = settings.voTool || 'select'
  const snap = settings.voSnap !== false
  const ripple = !!settings.voAutoRipple
  const clickSeek = settings.voClickSeek !== false
  const txShown = settings.voTranscript !== false
  const notesShown = settings.voNotes !== false
  const cutMenu = usePopup()
  const colorMenu = usePopup()
  const levelMenu = usePopup()
  const hasSel = sel.length > 0 || !!range
  const rec = useVo((s) => s.rec)
  return (
    <div className="vo-toolbar">
      <div className="tool-seg" title="Tools">
        <button className={tool === 'select' ? 'on' : ''} onClick={() => update({ voTool: 'select' })} title="Move tool (V) — click a clip to select it, drag on it to select a stretch, drag an edge to trim">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5l9.5 7-4.2.6 2.4 4.9-1.9.9-2.4-4.9L3 13z" fill="currentColor" /></svg>
        </button>
        <button className={tool === 'razor' ? 'on' : ''} onClick={() => update({ voTool: 'razor' })} title="Cut tool (C) — click a clip to cut it there">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5l7 7.2-1.6 1.6-7-7.2zM9.3 9.9l4.2 4.3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /><circle cx="3.6" cy="12.4" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
        </button>
      </div>
      <span className="vo-sep" />
      <button className="snap-btn" onClick={() => vo.splitAtPlayhead()} title="Cut at the playhead (F)">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M3.5 5L1.5 8l2 3M12.5 5l2 3-2 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Cut</span>
      </button>
      <button className="snap-btn" disabled={!hasSel} onClick={() => vo.deleteSelected()} title="Ripple delete the selection (Delete / G) — a stretch if you dragged one, else the selected clips">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Delete</span>
      </button>
      <button className="snap-btn" onClick={cutMenu.open} title="Auto-cut the silences out of the selected clips (all of them if none is selected)">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="6" width="2" height="4" rx="1" fill="currentColor" /><rect x="4" y="4" width="2" height="8" rx="1" fill="currentColor" /><path d="M8 8h2" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1 1.4" /><rect x="11" y="4" width="2" height="8" rx="1" fill="currentColor" /></svg>
        <span>Auto-cut ▾</span>
      </button>
      {cutMenu.at && (
        <div className="vo-menu" ref={cutMenu.ref} style={{ left: cutMenu.at.left, top: cutMenu.at.top }}>
          <div className="dim small vo-menu-title">Cut silences out of {sel.length ? sel.length + ' selected clip' + (sel.length > 1 ? 's' : '') : 'every clip'}</div>
          {Object.entries(VM.CUT_PRESETS).map(([id, p]) => (
            <button key={id} onClick={() => { cutMenu.close(); vo.autoCut(id) }}>
              <b>{p.label}</b>
              <span className="dim small">gaps over {p.minSilenceMs} ms, keeps {p.paddingMs} ms around speech</span>
            </button>
          ))}
        </div>
      )}
      <button className="snap-btn" disabled={!sel.length} onClick={levelMenu.open} title="Volume of the selected clips (louder or quieter than recorded)">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6v4h2.7L9 13V3L5.2 6z" fill="currentColor" /><path d="M11 5.8a3.2 3.2 0 0 1 0 4.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
        <span>Level ▾</span>
      </button>
      {levelMenu.at && <LevelPopup pop={levelMenu} />}
      <button className="snap-btn" disabled={!sel.length} onClick={colorMenu.open} title="Colour the selected clips">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /></svg>
        <span>Colour ▾</span>
      </button>
      {colorMenu.at && (
        <div className="vo-menu vo-colors" ref={colorMenu.ref} style={{ left: colorMenu.at.left, top: colorMenu.at.top }}>
          {CLIP_LABELS.map(([name, hex]) => (
            <button key={name} title={name} style={{ background: hex }} onClick={() => { colorMenu.close(); vo.colorSelected(name) }} />
          ))}
          <button className="none" title="No colour" onClick={() => { colorMenu.close(); vo.colorSelected(null) }}>×</button>
        </div>
      )}
      <span className="vo-sep" />
      <button className="snap-btn" disabled={!!rec} onClick={() => vo.rerecord()} title="Re-record the selected clip (or the one at the playhead) — Shift+R. You hear the end of what comes before it, then record; the new take replaces it and the rest closes up or opens up.">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.2A5 5 0 1 1 3 9.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /><path d="M3 2.6v3.8h3.8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="8" r="1.8" fill="#ff4d5e" /></svg>
        <span>Re-record</span>
      </button>
      <button className="snap-btn" disabled={!!rec || !range} onClick={() => vo.punchIn()} title="Punch in (P) — drag over the part you want to redo on the waveform, then punch in: you record just that part and it's spliced in.">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11h3M11 11h3M5 6v8M11 6v8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /><circle cx="8" cy="9" r="1.8" fill="#ff4d5e" /></svg>
        <span>Punch in</span>
      </button>
      <span className="t-spacer" />
      <div className="vo-opts" role="group" aria-label="Options">
      <button className={'snap-btn' + (snap ? ' on' : '')} onClick={() => update({ voSnap: !snap })} title="Snapping (W) — playhead, cuts and marks pull the cursor in">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3v6a2 2 0 0 0 4 0V2h3v6a5 5 0 0 1-10 0V2z" fill="currentColor" /></svg>
        <span>Snap</span>
      </button>
      <button className={'snap-btn' + (ripple ? ' on' : '')} onClick={() => update({ voAutoRipple: !ripple })} title="Cut out selections instantly — drag over something on the waveform and it's gone the moment you let go (the rest closes up). Undo brings it back.">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5l5 5.2M9.8 9.9l.5 2.6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /><circle cx="3.6" cy="11.4" r="1.9" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M10 5h5M12.5 2.5L15 5l-2.5 2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Cut out instantly</span>
      </button>
      <button className={'snap-btn' + (clickSeek ? ' on' : '')} onClick={() => update({ voClickSeek: !clickSeek })} title="The playhead jumps to where you click on the waveform. Turn it off to select and trim without it moving.">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v14M8 8l-4-3.5M8 8l4-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 14.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <span>Jump to clicks</span>
      </button>
      </div>
      <span className="vo-sep" />
      <button className={'snap-btn' + (txShown ? ' on' : '')} onClick={() => update({ voTranscript: !txShown })} title="Transcript of what's in the cut, following the playhead (T)">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 7h9M2 10.5h12M2 14h7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
        <span>Transcript</span>
      </button>
      <button className={'snap-btn' + (notesShown ? ' on' : '')} onClick={() => update({ voNotes: !notesShown })} title="Project notes — the same pad as in Review and Edit (N)">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h10v12H3z M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" strokeLinecap="round" /></svg>
        <span>Notes</span>
      </button>
    </div>
  )
}

// ---- the record + transport bar ----
function LevelMeter() {
  const [lv, setLv] = useState(0)
  const [clip, setClip] = useState(false)
  useEffect(() => voRec.on(() => {
    setLv(voRec.level)
    setClip(performance.now() - voRec.clipped < 1500)
  }), [])
  // dBFS → 0–1 over −60…0 dB
  const db = lv > 0 ? 20 * Math.log10(lv) : -99
  const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100
  return (
    <div className={'vo-meter' + (clip ? ' clip' : '')} title={lv > 0 ? `Input peak ${db.toFixed(1)} dB${clip ? ' — clipping! Turn the gain down' : ''}` : 'Input level'}>
      <div className="vo-meter-fill" style={{ width: pct + '%' }} />
    </div>
  )
}

function RecordBar({ section }) {
  const rec = useVo((s) => s.rec)
  const playing = useVoPlaying()
  const t = useVoTime()
  const [, bump] = useState(0)
  useEffect(() => onTick(200, () => { if (useVo.getState().rec) bump((n) => n + 1) }), [])
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const [mics, setMics] = useState([])
  const [micErr, setMicErr] = useState(voRec.error)
  useEffect(() => voRec.on(() => setMicErr(voRec.error)), [])
  const refreshMics = () => listMics().then(setMics)
  useEffect(() => {
    refreshMics()
    navigator.mediaDevices.addEventListener('devicechange', refreshMics)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshMics)
  }, [])
  const gainDb = settings.voGainDb ?? 0
  const setGainDb = (v) => {
    update({ voGainDb: v })
    voRec.setGain(Math.pow(10, v / 20))
  }
  const volume = settings.voVolume ?? 1
  const setVolume = (v) => {
    update({ voVolume: v })
    voPlayer.setVolume(v)
  }
  const gainPop = usePopup()
  const total = section ? VM.totalVo(section.clips) : 0
  const recording = rec && rec.phase === 'recording'
  return (
    <div className="vo-bar">
      <div className="vo-rec-group">
        <button className={'vo-rec-btn' + (rec ? ' on' : '')} onClick={() => useVo.getState().toggleRecord()} title={rec ? 'Stop recording (R)' : 'Record — lands at the playhead (R)'}>
          <span />
        </button>
        <div className="vo-status">
          {!rec && <b>Ready</b>}
          {rec && rec.phase === 'countdown' && <b className="vo-count">{rec.count}…</b>}
          {rec && rec.phase === 'preroll' && <b className="vo-count">Listen…</b>}
          {recording && <b className="vo-live">● {fmtTime(voRec.dur, true)}</b>}
          <span className="dim small">{rec ? (rec.phase === 'recording' ? (rec.replace ? 'Redoing it — R or Space to stop' : 'R or Space to stop · M marks a mistake') : 'Esc cancels') : 'R records · Shift+R re-records · Space plays'}</span>
        </div>
        <button className="btn small ghost" disabled={!recording} onClick={() => useVo.getState().markMistake()} title="Mark a mistake at this moment (M) — shows as a red tick to fix later">⚑ Mistake</button>
      </div>
      <div className="vo-transport">
        <button className="t-btn" onClick={() => voPlayer.seek(0)} disabled={!!rec} title="Start (Home)"><IconSkipStart /></button>
        <button className="t-btn play" onClick={() => voPlayer.toggle()} disabled={!!rec || !total} title="Play / pause (Space)">{playing ? '❚❚' : '▶'}</button>
        <button className="t-btn" onClick={() => voPlayer.seek(voPlayer.total)} disabled={!!rec} title="End (End)"><IconSkipEnd /></button>
        <div className="t-time">
          <span>{fmtTime(t, true)}</span>
          <span className="dim"> / {fmtTime(total)}</span>
        </div>
        <VoSpeed />
        <div className="vo-volume" title="Playback volume (double-click to reset)">
          <IconVolume level={volume === 0 ? 0 : volume < 0.6 ? 0.5 : 1} />
          <input type="range" min="0" max="1.5" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} onDoubleClick={() => setVolume(1)} />
          <span className="vo-vol-val">{Math.round(volume * 100)}%</span>
        </div>
      </div>
      <div className="vo-mic">
        <select
          value={settings.voMic || ''}
          onChange={(e) => { update({ voMic: e.target.value || null }); voRec.open(e.target.value || null).then(() => voRec.fellBack && update({ voMic: null })) }}
          onFocus={refreshMics}
          disabled={!!rec}
          title="Microphone"
        >
          <option value="">System default microphone</option>
          {mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m) => (
            <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>
          ))}
        </select>
        <button className="vo-meter-btn" onClick={gainPop.open} title="Microphone level — click to set how loud your microphone records (the volume of what you've already recorded isn't changed)">
          <span className="vo-meter-label">Mic</span>
          <LevelMeter />
        </button>
        {gainPop.at && (
          <div className="vo-menu vo-gain-pop" ref={gainPop.ref} style={{ left: Math.max(8, gainPop.at.left - 120), bottom: gainPop.at.bottom }}>
            <div className="dim small vo-menu-title">Mic gain — how loud your microphone records. Keep the loudest bits out of the red.</div>
            <div className="vo-gain">
              <input type="range" min="-12" max="24" step="0.5" value={gainDb} onChange={(e) => setGainDb(Number(e.target.value))} onDoubleClick={() => setGainDb(0)} />
              <span className="vo-gain-val">{gainDb > 0 ? '+' : ''}{gainDb.toFixed(1)} dB</span>
              <button className="vo-gain-reset" disabled={gainDb === 0} onClick={() => setGainDb(0)} title="Reset to 0 dB">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.2A5 5 0 1 1 3 9.5" /><path d="M3 2.6v3.8h3.8" /></svg>
              </button>
            </div>
            <LevelMeter />
          </div>
        )}
        <label className="vo-preroll" title="Count-in before recording starts">
          Pre-roll
          <select value={settings.voPreroll ?? 3} onChange={(e) => update({ voPreroll: Number(e.target.value) })}>
            {PREROLLS.map((p) => <option key={p} value={p}>{p ? p + ' s' : 'Off'}</option>)}
          </select>
        </label>
        {micErr && <span className="error-text small" title={micErr}>⚠ {micErr}</span>}
      </div>
    </div>
  )
}

// The notes panel: the project's notes pad, with its own text size.
function VoNotes({ project }) {
  const scale = useStore((s) => s.settings.voNotesScale) || 1
  const stepScale = React.useMemo(() => stepSetting('voNotesScale'), [])
  const bodyRef = useRef(null)
  useCtrlWheelSize(bodyRef, stepScale)
  return (
    <div className="vo-notes">
      <div className="vo-notes-head">
        <span>Notes</span>
        <span className="vo-notes-for dim">{project ? project.name : ''} — shared with Review and Edit</span>
        <span className="vo-tx-spacer" />
        <FontSize value={scale} onStep={stepScale} />
        <button className="link-btn" onClick={() => useStore.getState().updateSettings({ voNotes: false })} title="Hide the notes (N)">Hide</button>
      </div>
      <div className="vo-notes-body" ref={bodyRef} style={{ zoom: scale }}><ProjectPad /></div>
    </div>
  )
}

export default function VoiceoverWorkspace() {
  const project = useStore((s) => s.currentProject())
  const projectsDir = useStore((s) => s.settings.projectsDir)
  const sectionsFor = useVo((s) => s.sectionsFor)
  const section = useVo((s) => s.current())
  const rec = useVo((s) => s.rec)
  const settings = useStore((s) => s.settings)
  useEffect(() => { useVo.getState().load() }, [project && project.id, project && project.folder])
  // Show the current section's clips in the player when it changes.
  useEffect(() => { if (sectionsFor) useVo.getState().showInPlayer() }, [section && section.id, sectionsFor])
  // The microphone is open while you're here (for the level meter) and
  // let go when you leave.
  useEffect(() => {
    const st = useStore.getState().settings
    voRec.gain = Math.pow(10, (st.voGainDb ?? 0) / 20)
    voRec.open(st.voMic || null).then(() => {
      if (voRec.fellBack) {
        useStore.getState().updateSettings({ voMic: null })
        useStore.getState().showToast('Your microphone wasn’t found — using the default one')
      }
    })
    voPlayer.base = st.voSpeed || 1
    voPlayer.volume = st.voVolume ?? 1
    return () => {
      voPlayer.pause()
      voRec.close()
      flushVoSave()
    }
  }, [])
  const ready = projectsDir && project && project.folder
  return (
    <div className={'app edit-app vo-app' + (rec ? ' vo-recording' : '')}>
      <VoSidebar />
      <section className="center vo-center">
        {ready ? (
          <>
            <VoToolbar />
            <VoTimeline section={section} />
            {(settings.voTranscript !== false || settings.voNotes !== false) && (
              <div className="vo-lower">
                {settings.voNotes !== false && <VoNotes project={project} />}
                {settings.voTranscript !== false && <VoTranscript section={section} />}
              </div>
            )}
            <RecordBar section={section} />
          </>
        ) : (
          <Setup />
        )}
      </section>
    </div>
  )
}
