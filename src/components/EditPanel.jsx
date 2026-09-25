import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { onTick } from '../lib/hooks.js'
import { fmtTime } from '../lib/time.js'
import { LABEL, MARKER_COLORS, noteHex } from '../lib/beats.js'
import * as EM from '../lib/editModel.js'
import { clipTitle } from './Library.jsx'
import { useSummarizer, SummaryCard } from './TranscriptPanel.jsx'
import ProjectPad from './ProjectPad.jsx'
import { remapMarkers } from '../lib/editTools.js'

// A little air around transcript lines when cutting by them (the words'
// own timing is tight).
const PAD_BEFORE = 0.12
const PAD_AFTER = 0.25

// The index of the last item whose time is <= the playhead, re-rendering
// only when it changes.
function useCurrentIndex(times) {
  const [i, setI] = useState(-1)
  useEffect(
    () =>
      onTick(150, () => {
        const t = seqPlayer.getTime()
        let lo = 0
        let hi = times.length - 1
        let k = -1
        while (lo <= hi) {
          const m = (lo + hi) >> 1
          if (times[m] <= t + 0.05) { k = m; lo = m + 1 } else hi = m - 1
        }
        setI((p) => (p === k ? p : k))
      }),
    [times]
  )
  return i
}

// ---- Notes: timeline markers + the recordings' notes inside the cut ----
function NotesList({ section }) {
  const reviews = useStore((s) => s.reviews)
  const clips = useStore((s) => s.clips)
  const beatColors = useStore((s) => s.beatColors)
  const zoom = useStore((s) => s.settings.notesZoom || 1)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => {
    const out = (section.markers || []).map((m) => ({ kind: 'seq', id: m.id, t: m.t, color: m.color, text: m.text }))
    // Each recording's notes sorted once; each clip takes its slice (a cut
    // can have hundreds of clips from the same recording).
    const sorted = new Map()
    const titles = new Map()
    for (const it of EM.layout(section.clips).items) {
      let notes = sorted.get(it.key)
      if (!notes) {
        notes = ((reviews[it.key] && reviews[it.key].notes) || []).filter((n) => n.type !== 'BREAK').sort((x, y) => x.t - y.t)
        sorted.set(it.key, notes)
        const c = clips.find((x) => x.key === it.key)
        titles.set(it.key, c ? clipTitle(c) : '')
      }
      let lo = 0
      let hi = notes.length
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (notes[m].t < it.in) lo = m + 1
        else hi = m
      }
      for (let k = lo; k < notes.length && notes[k].t < it.out; k++) {
        const n = notes[k]
        out.push({ kind: 'rec', id: n.id + '@' + it.id, n, t: it.start + n.t - it.in, from: titles.get(it.key) })
      }
    }
    return out.sort((a, b) => a.t - b.t)
  }, [section, reviews, clips])
  const times = useMemo(() => rows.map((r) => r.t), [rows])
  const cur = useCurrentIndex(times)
  const listRef = useRef(null)
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.ep-note.now')
    if (el && seqPlayer.playing) el.scrollIntoView({ block: 'nearest' })
  }, [cur])
  const st = useStore.getState
  if (!rows.length) {
    return <div className="ep-empty dim small">No markers or notes in this cut yet. Press <kbd>Q</kbd> to drop a marker on the timeline — notes and markers from Review show up here too, wherever those moments are in the cut.</div>
  }
  return (
    <div className="ep-list" ref={listRef} style={{ zoom }}>
      {rows.map((r, i) => {
        const color = r.kind === 'seq' ? (MARKER_COLORS[r.color] || MARKER_COLORS.yellow).hex : noteHex(r.n, beatColors)
        return (
          <div key={r.id} className={'ep-note' + (i === cur ? ' now' : '')} style={{ '--c': color }} onClick={() => seqPlayer.seek(r.t)}>
            <span className="ep-time">{fmtTime(r.t)}</span>
            <span className="ep-kind">
              {r.kind === 'seq' ? <><span className="mk-shield" /> Marker</> : r.n.type === 'MARKER' ? <><span className="mk-shield" /> Rec. marker</> : LABEL[r.n.type] || r.n.type}
            </span>
            <span className="ep-text">
              {r.kind === 'seq' && editing === r.id ? (
                <input
                  autoFocus
                  className="ep-input"
                  defaultValue={r.text}
                  placeholder="Name this marker…"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { st().updateSeqMarker(r.id, { text: e.target.value.trim() }); setEditing(null) }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
                />
              ) : (
                <span onDoubleClick={(e) => { if (r.kind === 'seq') { e.stopPropagation(); setEditing(r.id) } }}>
                  {r.kind === 'seq' ? r.text || <span className="dim">double-click to name</span> : r.n.text || <span className="dim">—</span>}
                </span>
              )}
              {r.kind === 'rec' && <span className="ep-from dim"> · {r.from}</span>}
            </span>
            {r.kind === 'seq' && (
              <span className="ep-actions" onClick={(e) => e.stopPropagation()}>
                {Object.entries(MARKER_COLORS).map(([k, c]) => (
                  <button key={k} className={'ep-sw' + (r.color === k ? ' on' : '')} style={{ '--c': c.hex }} title={c.label} onClick={() => st().updateSeqMarker(r.id, { color: k })} />
                ))}
                <button className="row-btn" title="Delete marker (Ctrl+Z brings it back)" onClick={() => st().deleteSeqMarker(r.id)}>×</button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- Transcript of the cut ----
const txCache = new Map() // key|track -> segments
const WIN = 220
const EST = 24
// Index of the first transcript segment starting at or after t.
const MAX_SEG = 120 // no segment is longer than this (s)
function firstFrom(segs, t) {
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (segs[m][0] < t) lo = m + 1
    else hi = m
  }
  return lo
}

function TranscriptList({ section }) {
  const clips = useStore((s) => s.clips)
  const txDone = useStore((s) => s.txDone)
  const txVersion = useStore((s) => s.txVersion)
  const trackNames = useStore((s) => s.settings.trackNames)
  const zoom = useStore((s) => s.settings.notesZoom || 1)
  const colors = useTrackColors()
  const [ver, bump] = useState(0)
  const items = useMemo(() => EM.layout(section.clips).items, [section.clips])

  // Load every transcript the cut needs (once per recording/track).
  useEffect(() => {
    let dead = false
    const need = []
    for (const key of new Set(items.map((it) => it.key))) for (const tr of txDone[key] || []) if (!txCache.has(key + '|' + tr)) need.push([key, tr])
    Promise.all(
      need.map(([key, tr]) => {
        const c = clips.find((x) => x.key === key)
        if (!c) return null
        txCache.set(key + '|' + tr, null)
        return window.footage.readTranscript({ key: c.key, size: c.size, probe: { audio: c.probe.audio } }, tr).then((d) => txCache.set(key + '|' + tr, d ? d.segments : []))
      })
    ).then(() => !dead && need.length && bump((n) => n + 1))
    return () => { dead = true }
  }, [items, txDone, txVersion])

  const tracks = useMemo(() => {
    const set = new Set()
    for (const it of items) for (const tr of txDone[it.key] || []) set.add(tr)
    return [...set].sort((a, b) => a - b)
  }, [items, txDone])
  const rows = useMemo(() => {
    const out = []
    for (const it of items) {
      for (const tr of tracks) {
        const segs = txCache.get(it.key + '|' + tr)
        if (!segs) continue
        // Segments are in time order: jump to this clip's part rather than
        // scanning the whole recording for every clip (hundreds of clips).
        for (let k = firstFrom(segs, it.in - MAX_SEG); k < segs.length && segs[k][0] < it.out; k++) {
          const [s, e, text] = segs[k]
          if (e <= it.in) continue
          out.push({ t: it.start + Math.max(s, it.in) - it.in, e: it.start + Math.min(e, it.out) - it.in, tr, text, key: it.key })
        }
      }
    }
    return out.sort((a, b) => a.t - b.t)
  }, [items, tracks, ver])
  const times = useMemo(() => rows.map((r) => r.t), [rows])
  const cur = useCurrentIndex(times)

  // Select lines: drag across them, or click one and Shift+click another.
  const [sel, setSel] = useState(null)
  const anchor = useRef(null)
  const drag = useRef(null)
  useEffect(() => {
    const up = () => setTimeout(() => { drag.current = null }, 0)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  useEffect(() => setSel(null), [rows])
  function rowDown(i, e) {
    if (e.shiftKey) { e.preventDefault(); return }
    if (e.button !== 0) return
    e.preventDefault() // no text highlight while dragging across lines
    drag.current = { from: i, moved: false }
  }
  function rowEnter(i, e) {
    const d = drag.current
    if (!d || !(e.buttons & 1) || i === d.from) return
    d.moved = true
    anchor.current = d.from
    setSel({ a: Math.min(d.from, i), b: Math.max(d.from, i) })
  }
  function rowClick(i, r, e) {
    if (drag.current && drag.current.moved) return
    if (e.shiftKey && anchor.current != null) {
      setSel({ a: Math.min(anchor.current, i), b: Math.max(anchor.current, i) })
      return
    }
    anchor.current = i
    setSel(null)
    seqPlayer.seek(r.t)
    setFollow(true)
  }
  const { summary, summarize, closeSummary } = useSummarizer()
  function summarizeSel() {
    const part = rows.slice(sel.a, sel.b + 1)
    const names = [...new Set(part.map((x) => x.key))].map((k) => clips.find((c) => c.key === k)).filter(Boolean).map(clipTitle)
    const sec = useStore.getState().currentSection()
    summarize({
      from: part[0].t,
      to: part[part.length - 1].e,
      title: (sec ? sec.name + ' — ' : '') + 'cut from ' + names.join(', '),
      lines: part.map((x) => ({ t: fmtTime(x.t), who: trackNames[x.tr] || 'Track ' + (x.tr + 1), text: x.text }))
    })
  }
  function copySel() {
    const text = rows.slice(sel.a, sel.b + 1).map((x) => `[${fmtTime(x.t)}] ${trackNames[x.tr]}: ${x.text}`).join('\n')
    navigator.clipboard.writeText(text)
    useStore.getState().showToast('Copied ' + (sel.b - sel.a + 1) + ' lines')
  }
  // Cut by transcript. Timeline markers follow their moments.
  function cutBySelection(keepOnly) {
    const st = useStore.getState()
    const sec = st.currentSection()
    if (!sec || !sel) return
    const part = rows.slice(sel.a, sel.b + 1)
    const a = Math.max(0, part[0].t - PAD_BEFORE)
    const b = Math.max(...part.map((x) => x.e)) + PAD_AFTER
    const next = keepOnly ? EM.keepRanges(sec.clips, [[a, b]]) : EM.removeRange(sec.clips, a, b)
    if (!next) return
    st.applySection({ clips: next, markers: remapMarkers(sec.clips, next, sec.markers || []) }, { playhead: keepOnly ? 0 : a })
    setSel(null)
    st.showToast((keepOnly ? 'Kept only ' : 'Removed ') + fmtTime(b - a, true) + ' — Ctrl+Z to undo')
  }
  function summaryToMarker() {
    if (!summary || !summary.text) return
    const st = useStore.getState()
    const id = st.addSeqMarker(summary.from)
    if (id) st.updateSeqMarker(id, { text: 'Summary: ' + summary.text.trim().split('\n')[0].slice(0, 200) })
    st.showToast('Saved as a marker at ' + fmtTime(summary.from))
  }

  // Windowed like Review's transcript: only WIN rows in the DOM.
  const bodyRef = useRef(null)
  const [start, setStart] = useState(0)
  const [follow, setFollow] = useState(true)
  const around = (i) => Math.max(0, Math.min(rows.length - WIN, i - (WIN >> 1)))
  useEffect(() => {
    if (!follow || cur < 0) return
    if (cur < start + 20 || cur >= start + WIN - 20) setStart(around(cur))
  }, [cur, follow])
  useLayoutEffect(() => {
    if (!follow || cur < 0 || !bodyRef.current) return
    const el = bodyRef.current.querySelector(`[data-i="${cur}"]`)
    if (!el) return
    const br = bodyRef.current.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    bodyRef.current.scrollTop += r.top - br.top - (br.height - r.height) / 2
  })
  function onScroll() {
    const body = bodyRef.current
    const blk = body && body.querySelector('.ep-block')
    if (!blk) return
    const br = body.getBoundingClientRect()
    const kr = blk.getBoundingClientRect()
    const per = EST * zoom
    let idx = null
    if (start > 0 && kr.top > br.top + 1) idx = start - Math.ceil((kr.top - br.top) / per)
    else if (start + WIN < rows.length && kr.bottom < br.bottom - 1) idx = start + WIN + Math.floor((br.bottom - kr.bottom) / per) - Math.floor(br.height / per)
    if (idx != null) setStart(around(Math.max(0, Math.min(rows.length - 1, idx))))
  }
  if (!tracks.length) return <div className="ep-empty dim small">None of the recordings in this cut are transcribed yet — open them in Review (they transcribe when opened) or use the Transcript tab there.</div>
  const end = Math.min(rows.length, start + WIN)
  const s0 = Math.min(start, Math.max(0, rows.length - WIN))
  return (
    <>
      <div className="tx-cols-head" style={{ '--n': tracks.length }}>
        <span />
        {tracks.map((tr) => <span key={tr} style={{ '--c': colors[tr] }}>{trackNames[tr]}</span>)}
        {!follow && <button className="link-btn tx-follow" onClick={() => setFollow(true)}>Follow ↓</button>}
      </div>
      <div className="tx-body" ref={bodyRef} onScroll={onScroll} onWheel={() => setFollow(false)}>
        <div style={{ zoom }}>
          <div style={{ height: s0 * EST }} />
          <div className="ep-block">
            {rows.slice(s0, end).map((r, k) => {
              const i = s0 + k
              return (
                <div key={i} data-i={i} className={'tx-row' + (i === cur ? ' now' : '') + (sel && i >= sel.a && i <= sel.b ? ' sel' : '')} style={{ '--n': tracks.length }} onMouseDown={(e) => rowDown(i, e)} onMouseEnter={(e) => rowEnter(i, e)} onClick={(e) => rowClick(i, r, e)}>
                  <span className="tx-time">{fmtTime(r.t)}</span>
                  {tracks.map((tr) => (
                    <span key={tr} className={tr === r.tr ? 'tx-cell' : 'tx-cell empty'} style={{ '--c': colors[tr] }}>
                      {tr === r.tr && <span className="tx-text">{r.text}</span>}
                    </span>
                  ))}
                </div>
              )
            })}
          </div>
          <div style={{ height: Math.max(0, rows.length - end) * EST }} />
        </div>
      </div>
      {!sel && !summary && <div className="tx-hint dim small">Drag across lines (or click, then Shift+click) to select them</div>}
      {sel && (
        <div className="tx-selbar">
          <span className="grow"><b>{sel.b - sel.a + 1}</b> line{sel.b === sel.a ? '' : 's'} · {fmtTime(rows[sel.a].t)}–{fmtTime(rows[sel.b].e)}</span>
          <button className="btn small accent" onClick={summarizeSel} disabled={summary && ['loading', 'thinking', 'writing'].includes(summary.status)} title="Summarize with the local AI (on your graphics card)">✦ Summarize</button>
          <button className="btn small ghost" onClick={() => cutBySelection(false)} title="Cut these lines out of the section (ripple)">✂ Remove</button>
          <button className="btn small ghost" onClick={() => cutBySelection(true)} title="Keep only these lines — cut everything else in the section">Keep only</button>
          <button className="btn small ghost" onClick={copySel}>Copy</button>
          <button className="icon-btn small" onClick={() => setSel(null)} title="Clear selection">×</button>
        </div>
      )}
      {summary && <SummaryCard summary={summary} onClose={closeSummary} onNote={summaryToMarker} noteLabel="Save as marker" onSeek={(t) => seqPlayer.seek(t)} />}
    </>
  )
}

// Notes and transcript side by side; drag the line between them.
function BothView({ section }) {
  const split = useStore((s) => s.settings.editPanelSplit ?? 0.42)
  const ref = useRef(null)
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const box = ref.current.getBoundingClientRect()
    const move = (ev) => useStore.getState().updateSettings({ editPanelSplit: Math.max(0.15, Math.min(0.85, (ev.clientX - box.left) / box.width)) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew')
    }
    document.body.classList.add('resizing-ew')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div className="np-body both" ref={ref}>
      <div className="np-col np-notes-col" style={{ flexBasis: split * 100 + '%' }}>
        <NotesList section={section} />
      </div>
      <div className="np-split" onMouseDown={down} onDoubleClick={() => useStore.getState().updateSettings({ editPanelSplit: 0.42 })} title="Drag to resize · double-click to reset" />
      <div className="np-col np-tx-col">
        <div className="tx-panel"><TranscriptList section={section} /></div>
      </div>
    </div>
  )
}

export default function EditPanel({ section }) {
  const tab = useStore((s) => s.settings.editPanelTab || 'notes')
  const width = useStore((s) => s.settings.editPanelWidth || 380)
  const set = (patch) => useStore.getState().updateSettings(patch)
  function resizeDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const move = (ev) => set({ editPanelWidth: Math.round(Math.max(260, Math.min(window.innerWidth - 700, window.innerWidth - ev.clientX))) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew')
    }
    document.body.classList.add('resizing-ew')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <aside className="notes-panel edit-panel" style={{ width }}>
      <div className="np-resize" onMouseDown={resizeDown} onDoubleClick={() => set({ editPanelWidth: 380 })} title="Drag to resize · double-click to reset" />
      <div className="np-head">
        <div className="np-title">
          <div className="np-tabs">
            <button className={tab === 'notes' ? 'on' : ''} onClick={() => set({ editPanelTab: 'notes' })}>Notes &amp; markers</button>
            <button className={tab === 'transcript' ? 'on' : ''} onClick={() => set({ editPanelTab: 'transcript' })}>Transcript</button>
            <button className={tab === 'both' ? 'on' : ''} onClick={() => set({ editPanelTab: 'both', ...(width < 620 ? { editPanelWidth: 680 } : {}) })} title="Notes and transcript side by side — drag the line between them">◫ Both</button>
            <button className={'np-pad-tab' + (tab === 'pad' ? ' on' : '')} onClick={() => set({ editPanelTab: 'pad' })} title="Project notes — checklists and notes for the whole project, shared with Review">☑ Project</button>
          </div>
        </div>
        <button className="icon-btn small" onClick={() => useStore.getState().toggleEditPanel()} title="Hide this panel (Ctrl+Shift+\)">»</button>
      </div>
      {tab === 'pad' ? (
        <div className="np-body"><ProjectPad /></div>
      ) : !section ? (
        <div className="ep-empty dim small">Open a section to see its notes and transcript.</div>
      ) : tab === 'both' ? (
        <BothView section={section} />
      ) : tab === 'notes' ? (
        <NotesList section={section} />
      ) : (
        <div className="tx-panel"><TranscriptList section={section} /></div>
      )}
    </aside>
  )
}
