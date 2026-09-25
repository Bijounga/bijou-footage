import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors, useTrackNames, trackNamesFor } from '../state/store.js'
import { player } from '../lib/player.js'
import { bus } from '../lib/hooks.js'
import { fmtTime, fmtDay } from '../lib/time.js'
import { clipTitle } from './Library.jsx'

const api = window.footage
const WIN = 240 // transcript rows in the DOM at once
const EST = 24 // estimated row height (px) for the off-screen spacers

// What the main process needs to find a clip's transcript files.
const slim = (c) => ({ key: c.key, size: c.size, path: c.path, probe: { audio: (c.probe && c.probe.audio) || [], duration: c.probe && c.probe.duration } })

// Transcript for the open recording: one column per transcribed track,
// rows in time order so the columns line up like a conversation. Plus a
// search over this recording / the project / everything.
// memo: the notes panel re-renders several times a second (playhead);
// this must not re-render thousands of transcript rows with it.
export default React.memo(TranscriptPanel)

function TranscriptPanel() {
  const clips = useStore((s) => s.clips)
  const currentKey = useStore((s) => s.currentKey)
  const project = useStore((s) => s.currentProject())
  const trackNames = useTrackNames(currentKey)
  const want = useStore((s) => s.settings.transcribeTracks) || []
  const toggleTrack = useStore((s) => s.toggleTranscribeTrack)
  const tx = useStore((s) => s.tx)
  const txDone = useStore((s) => s.txDone)
  const txVersion = useStore((s) => s.txVersion)
  const zoom = useStore((s) => s.settings.notesZoom || 1)
  const colors = useTrackColors()
  const clip = clips.find((c) => c.key === currentKey)
  const audio = (clip && clip.probe && clip.probe.audio) || []
  const done = (clip && txDone[clip.key]) || []

  const [q, setQ] = useState('')
  const scope = useStore((s) => s.settings.transcriptScope || 'all')
  const setScope = (v) => useStore.getState().updateSettings({ transcriptScope: v })
  const searchRef = useRef(null)
  const measureRef = useRef(null)
  const [clearX, setClearX] = useState(0)
  useLayoutEffect(() => {
    const m = measureRef.current
    const inp = searchRef.current
    if (!m || !inp) return
    const pad = parseFloat(getComputedStyle(inp).paddingLeft) || 8
    // Just after the text; never past the box's right edge.
    setClearX(Math.min(pad + m.offsetWidth + 4 - inp.scrollLeft, inp.clientWidth - 24))
  }, [q])
  useEffect(() => bus.on('focusTranscriptSearch', () => { searchRef.current && (searchRef.current.focus(), searchRef.current.select()) }), [])
  useEffect(() => { if (!project && scope === 'project') setScope('clip') }, [project, scope])

  // ---- transcript of the open recording ----
  const [data, setData] = useState({}) // track -> segments
  useEffect(() => {
    let dead = false
    setData({})
    if (!clip || !done.length) return
    Promise.all(done.map((tr) => api.readTranscript(slim(clip), tr).then((d) => [tr, d ? d.segments : []]))).then((pairs) => {
      if (!dead) setData(Object.fromEntries(pairs))
    })
    return () => { dead = true }
  }, [clip && clip.key, done.join(), txVersion])

  const cols = done.filter((tr) => data[tr])
  const rows = useMemo(() => {
    const out = []
    for (const tr of cols) for (const seg of data[tr]) out.push({ tr, s: seg[0], e: seg[1], text: seg[2], words: seg[3] })
    out.sort((a, b) => a.s - b.s)
    return out
  }, [data])

  // Only a window of WIN rows is in the DOM (a 7-hour recording has ~10k
  // lines; laying them all out cost 150-250 ms every time the current line
  // changed). Spacers stand in for the rest at an estimated row height, and
  // the window moves with the playhead (Follow) or with your scrolling.
  const bodyRef = useRef(null)
  const blockRef = useRef(null)
  const [follow, setFollow] = useState(true)
  const followRef = useRef(true)
  followRef.current = follow
  const [win, setWin] = useState({ start: 0 })
  const winRef = useRef(win)
  winRef.current = win
  const curRef = useRef(-1)
  const clickedRef = useRef(false)
  useEffect(() => setWin({ start: 0 }), [rows])
  const start = Math.min(win.start, Math.max(0, rows.length - WIN))
  const end = Math.min(rows.length, start + WIN)
  const perRow = EST * zoom

  const windowAround = (i) => Math.max(0, Math.min(rows.length - WIN, i - (WIN >> 1)))
  const rowEl = (i) => bodyRef.current && bodyRef.current.querySelector(`[data-i="${i}"]`)
  function markCurrent(scroll) {
    const body = bodyRef.current
    if (!body) return
    const prev = body.querySelector('.tx-row.now')
    if (prev) prev.classList.remove('now')
    const el = curRef.current >= 0 ? rowEl(curRef.current) : null
    if (!el) return
    el.classList.add('now')
    if (scroll && followRef.current) {
      const br = body.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      body.scrollTop += r.top - br.top - (br.height - r.height) / 2
    }
  }

  useEffect(() => {
    if (!rows.length) return
    const tick = (force, noScroll) => {
      const t = player.getTime()
      let lo = 0
      let hi = rows.length - 1
      let i = -1
      while (lo <= hi) {
        const m = (lo + hi) >> 1
        if (rows[m].s <= t + 0.05) { i = m; lo = m + 1 } else hi = m - 1
      }
      if (i === curRef.current && !force) return
      curRef.current = i
      const w = winRef.current
      const inWin = i >= w.start + 20 && i < w.start + WIN - 20
      if (followRef.current && i >= 0 && !inWin) setWin({ start: windowAround(i), scrollTo: true })
      else markCurrent(!noScroll)
    }
    // Clicking or dragging on the timeline / waveforms, skimming, jumping to
    // a note: the transcript comes along (and Follow turns back on).
    const jumped = () => {
      followRef.current = true
      setFollow(true)
      // A click on a transcript line shouldn't yank that line out from under the mouse.
      tick(true, clickedRef.current)
      clickedRef.current = false
    }
    const offSeek = player.on('seek', jumped)
    const offScrub = player.on('scrub', jumped)
    let n = 0
    const id = setInterval(() => {
      tick(false)
      // Safety net: if the view ever ends up on a spacer (panel resized,
      // text zoomed…), bring the right rows in. It measures the DOM (a
      // layout), so only ~2×/s, and not while following playback — then
      // the current line is always on screen anyway.
      if (++n % 4 === 0 && !(player.playing && followRef.current) && onScrollRef.current) onScrollRef.current()
    }, 150)
    return () => { clearInterval(id); offSeek(); offScrub() }
  }, [rows])

  // After the window moves: re-mark the current line, then either centre
  // it (Follow) or keep the row you were looking at in place (scrolling).
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    if (win.anchor != null) {
      const el = rowEl(win.anchor)
      if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - win.off
    }
    if (win.center != null) {
      const el = rowEl(win.center)
      if (el) {
        const br = body.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        body.scrollTop += r.top - br.top - (br.height - r.height) / 2
      }
    }
    markCurrent(!!win.scrollTo)
  }, [win])

  // Text size changed: every row (and the spacers) changed height, so the
  // old scroll position no longer points at the same lines — often into a
  // spacer, leaving the panel blank. Re-centre on the current line.
  const firstZoom = useRef(true)
  useLayoutEffect(() => {
    if (firstZoom.current) { firstZoom.current = false; return }
    if (!rows.length) return
    const i = Math.max(0, curRef.current)
    setWin({ start: windowAround(i), center: i })
  }, [zoom])

  const onScrollRef = useRef(null)
  onScrollRef.current = onScroll
  function onScroll() {
    const body = bodyRef.current
    const blk = blockRef.current
    if (!body || !blk || !rows.length) return
    const br = body.getBoundingClientRect()
    const kr = blk.getBoundingClientRect()
    // Scrolled into a spacer: estimate which row is at the top of the view.
    let idx = null
    if (start > 0 && kr.top > br.top + 1) idx = start - Math.ceil((kr.top - br.top) / perRow)
    else if (end < rows.length && kr.bottom < br.bottom - 1) idx = end + Math.floor((br.bottom - kr.bottom) / perRow) - Math.floor(br.height / perRow)
    if (idx == null) return
    idx = Math.max(0, Math.min(rows.length - 1, idx))
    const ns = windowAround(idx)
    if (ns === start) return
    setWin({ start: ns, anchor: idx, off: 0 })
  }

  // Click a word to land on it (from the caret position — no per-word
  // elements, which would be hundreds of thousands in a long recording).
  function seekRow(row, e) {
    let t = row.s
    const pos = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY)
    const textEl = e.currentTarget.querySelector('.tx-text')
    if (pos && textEl && textEl.contains(pos.startContainer) && row.words && row.words.length) {
      const before = row.text.slice(0, pos.startOffset)
      const k = Math.min(row.words.length - 1, before.split(/\s+/).filter(Boolean).length - (/\s$/.test(before) || !before ? 0 : 1))
      if (k >= 0) t = row.words[k][0]
    }
    clickedRef.current = true
    player.seek(t, { exact: true })
  }

  // "+" on a line: a beat at that moment with the quote as its text. With
  // the notes showing it opens for typing; from the transcript alone it's
  // just dropped in (so you can keep going).
  function addFromLine(row, e) {
    e.stopPropagation()
    const st = useStore.getState()
    const notesVisible = st.settings.sideTab === 'both'
    const id = st.addNote('beat', { t: row.s, quick: !notesVisible })
    if (!id) return
    st.updateNote(id, { text: '“' + row.text + '”' })
    if (!notesVisible) st.showToast('Beat added at ' + fmtTime(row.s) + ' — it’s in Notes')
  }

  // ---- selecting a section (Shift+click) → summary ----
  const anchorRef = useRef(null)
  const [sel, setSel] = useState(null) // {a, b} row indexes, inclusive
  useEffect(() => { setSel(null); anchorRef.current = null }, [rows])
  const dragSel = useRef(null) // {from, moved} while the mouse is down on a line
  useEffect(() => {
    const up = () => setTimeout(() => { dragSel.current = null }, 0)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  function rowDown(i, e) {
    if (e.shiftKey) { e.preventDefault(); return }
    if (e.button !== 0 || e.target.closest('button')) return
    e.preventDefault() // no text highlight while dragging across lines (word clicks still work)
    dragSel.current = { from: i, moved: false }
  }
  function rowEnter(i, e) {
    const d = dragSel.current
    if (!d || !(e.buttons & 1) || i === d.from) return
    d.moved = true
    window.getSelection && window.getSelection().removeAllRanges()
    anchorRef.current = d.from
    setSel({ a: Math.min(d.from, i), b: Math.max(d.from, i) })
  }
  function clickRow(i, row, e) {
    if (dragSel.current && dragSel.current.moved) return // that was a drag-select
    if (e.shiftKey && anchorRef.current != null) {
      e.preventDefault()
      window.getSelection && window.getSelection().removeAllRanges()
      setSel({ a: Math.min(anchorRef.current, i), b: Math.max(anchorRef.current, i) })
      return
    }
    anchorRef.current = i
    if (sel) setSel(null)
    seekRow(row, e)
  }
  const { summary, summarize, closeSummary } = useSummarizer()
  function summarizeSel() {
    if (!sel || !clip) return
    const part = rows.slice(sel.a, sel.b + 1)
    summarize({
      from: part[0].s,
      to: part[part.length - 1].e,
      title: clipTitle(clip) + ' (' + fmtDay(clip.recordedAt) + ')',
      lines: part.map((x) => ({ t: fmtTime(x.s), who: trackNames[x.tr] || 'Track ' + (x.tr + 1), text: x.text }))
    })
  }
  // Cut by transcript, from Review: these lines become a clip at the end of
  // the open edit section.
  function addSelToSection() {
    if (!sel || !clip) return
    const part = rows.slice(sel.a, sel.b + 1)
    const a = Math.max(0, part[0].s - 0.12)
    const b = Math.max(...part.map((x) => x.e)) + 0.25
    const name = useStore.getState().addToSection(clip.key, a, b)
    if (name) useStore.getState().showToast('Added ' + fmtTime(b - a, true) + ' to “' + name + '”')
  }
  function copySel() {
    if (!sel) return
    const text = rows.slice(sel.a, sel.b + 1).map((x) => `[${fmtTime(x.s)}] ${trackNames[x.tr]}: ${x.text}`).join('\n')
    navigator.clipboard.writeText(text)
    useStore.getState().showToast('Copied ' + (sel.b - sel.a + 1) + ' lines')
  }
  function summaryToNote() {
    if (!summary || !summary.text) return
    const st = useStore.getState()
    st.logNote({ t: summary.from, type: 'NOTE', text: 'Summary ' + fmtTime(summary.from) + '–' + fmtTime(summary.to) + ':\n' + summary.text.trim() })
    st.showToast('Summary saved as a note at ' + fmtTime(summary.from))
  }

  const rowEls = []
  for (let i = start; i < end; i++) {
    const r = rows[i]
    const inSel = sel && i >= sel.a && i <= sel.b
    rowEls.push(
      <div key={i} data-i={i} className={'tx-row' + (inSel ? ' sel' : '')} style={{ '--n': cols.length }} onMouseDown={(e) => rowDown(i, e)} onMouseEnter={(e) => rowEnter(i, e)} onClick={(e) => clickRow(i, r, e)}>
        <span className="tx-time">{fmtTime(r.s)}</span>
        <button className="tx-add" onClick={(e) => addFromLine(r, e)} title="Make this line a beat (quote as its text)">+</button>
        {cols.map((tr) => (
          <span key={tr} className={tr === r.tr ? 'tx-cell' : 'tx-cell empty'} style={{ '--c': colors[tr] }}>
            {tr === r.tr && <span className="tx-text">{r.text}</span>}
          </span>
        ))}
      </div>
    )
  }

  // ---- search ----
  const [res, setRes] = useState(null)
  const scopeClips = useMemo(() => {
    if (scope === 'clip') return clip ? [clip] : []
    if (scope === 'project' && project) return project.clipKeys.map((k) => clips.find((c) => c.key === k)).filter(Boolean)
    return clips
  }, [scope, clip, project, clips])
  useEffect(() => {
    const text = q.trim()
    if (!text) { setRes(null); return }
    const id = setTimeout(() => {
      api.searchTranscripts(text, scopeClips.filter((c) => txDone[c.key]).map(slim)).then(setRes)
    }, 180)
    return () => clearTimeout(id)
  }, [q, scopeClips, txVersion, txDone])
  useEffect(() => {
    // Search hits in the open recording show on the timeline too.
    const hits = res && clip ? res.hits.filter((h) => h.key === clip.key).map((h) => ({ t: h.t, track: h.track })) : []
    useStore.getState().setSearchHits(hits)
  }, [res, clip && clip.key])
  useEffect(() => () => useStore.getState().setSearchHits([]), [])

  const grouped = useMemo(() => {
    if (!res) return []
    const by = new Map()
    for (const h of res.hits) {
      if (!by.has(h.key)) by.set(h.key, [])
      by.get(h.key).push(h)
    }
    return [...by.entries()]
      .map(([key, hits]) => ({ c: clips.find((c) => c.key === key), hits: hits.sort((a, b) => a.t - b.t) }))
      .filter((g) => g.c)
      .sort((a, b) => a.c.recordedAt - b.c.recordedAt)
  }, [res, clips])

  function openHit(h) {
    const st = useStore.getState()
    if (h.key === st.currentKey) player.seek(Math.max(0, h.t - 0.3), { exact: true })
    else st.openClip(h.key, Math.max(0, h.t - 0.3))
  }

  // ---- transcribe controls ----
  const need = clip ? audio.map((a, i) => i).filter((i) => want[i] && !audio[i].likelySilent && !done.includes(i)) : []
  const running = tx.running
  const runningClip = running && clips.find((c) => c.key === running.key)
  const projectLeft = project
    ? project.clipKeys.reduce((n, k) => {
        const c = clips.find((x) => x.key === k)
        if (!c || !c.probe) return n
        const d = txDone[k] || []
        return n + (c.probe.audio || []).filter((a, i) => want[i] && !a.likelySilent && !d.includes(i)).length
      }, 0)
    : 0
  const busy = (key, tr) => (running && running.key === key && running.track === tr) || tx.queue.some((j) => j.key === key && j.track === tr)

  const hl = (text) => {
    const needle = q.trim().toLowerCase()
    const i = needle ? text.toLowerCase().indexOf(needle) : -1
    if (i < 0) return text
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + needle.length)}</mark>
        {text.slice(i + needle.length)}
      </>
    )
  }

  return (
    <div className="tx-panel">
      <div className="tx-search">
        <div className="tx-search-box">
          <input
            ref={searchRef}
            className="lib-search"
            placeholder="Search what anyone said…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }}
          />
          {/* invisible copy of the text, to put the × right after it */}
          <span className="tx-measure" ref={measureRef} aria-hidden="true">{q}</span>
          {q && (
            <button className="tx-clear" style={{ left: clearX }} onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); searchRef.current && searchRef.current.focus() }} title="Clear search (Esc)">
              ×
            </button>
          )}
        </div>
        <select value={scope} onChange={(e) => setScope(e.target.value)} title="Where to search">
          <option value="clip">This recording</option>
          {project && <option value="project">This project</option>}
          <option value="all">All footage</option>
        </select>
      </div>

      <div className="tx-tracks">
        <span className="tx-tracks-label dim small">Transcribe</span>
        {(audio.length ? audio : trackNames.slice(0, 4)).map((a, i) => {
          const silent = audio[i] && audio[i].likelySilent
          const has = done.includes(i)
          return (
            <button
              key={i}
              className={'tx-chip' + (want[i] ? ' on' : '') + (silent ? ' silent' : '')}
              style={{ '--c': colors[i] }}
              onClick={() => toggleTrack(i)}
              title={(want[i] ? 'Ticked — this track gets transcribed. Click to skip it.' : 'Not ticked — click to transcribe this track too.') + (silent ? ' It is empty in this recording.' : '') + (has ? ' Already transcribed here.' : '')}
            >
              <span className="tx-box">{want[i] ? '✓' : ''}</span>
              {trackNames[i]}
              {silent ? <span className="tx-badge">empty</span> : has ? <span className="tx-badge done">done</span> : busy(currentKey, i) ? <span className="tx-badge">…</span> : null}
            </button>
          )
        })}
      </div>

      <div className="tx-status">
        {!tx.installed ? (
          <span className="dim small">Transcription isn't set up yet. <button className="link-btn" onClick={() => useStore.getState().openModal('settings')}>Set it up in Settings → Tools</button></span>
        ) : running ? (
          <>
            <div className="tx-prog">
              <div className="tx-prog-text small">
                {running.loading ? 'Loading the speech model…' : `Transcribing ${trackNamesFor(useStore.getState(), running.key)[running.track]}`}
                <span className="dim"> · {runningClip ? clipTitle(runningClip) : ''}</span>
                {tx.queue.length > 0 && <span className="dim"> · {tx.queue.length} more queued</span>}
              </div>
              <div className="tx-bar"><div style={{ width: (running.duration ? (100 * running.done) / running.duration : 0) + '%', background: colors[running.track] }} /></div>
            </div>
            <button className="link-btn" onClick={() => useStore.getState().cancelTranscripts()} title="Stop transcribing and clear the queue">Stop</button>
          </>
        ) : (
          <>
            {clip && need.length > 0 && (
              <button className="btn small" onClick={() => useStore.getState().transcribe([clip.key], { front: true })}>
                Transcribe {need.map((i) => trackNames[i]).join(' + ')}
              </button>
            )}
            {project && projectLeft > 0 && (
              <button className="btn small ghost" onClick={() => useStore.getState().transcribe(project.clipKeys)} title="Queue every recording in this project (the chosen tracks)">
                Whole project <span className="dim">({projectLeft} track{projectLeft === 1 ? '' : 's'})</span>
              </button>
            )}
            {clip && !need.length && !(project && projectLeft) && <span className="dim small">{done.length ? 'The ticked tracks are transcribed.' : 'Tick the tracks you want transcribed.'}</span>}
          </>
        )}
      </div>

      {res ? (
        <div className="tx-results" style={{ zoom }}>
          <div className="dim small tx-count">
            {res.total ? `${res.total} match${res.total === 1 ? '' : 'es'}${res.total > res.hits.length ? ` (showing ${res.hits.length})` : ''}` : 'No matches ' + (scope === 'clip' ? 'in this recording' : scope === 'project' ? 'in this project' : 'anywhere') + (scopeClips.some((c) => txDone[c.key]) ? '' : ' — nothing transcribed there yet')}
          </div>
          {grouped.map((g) => (
            <div key={g.c.key} className="tx-group">
              <div className="ng-head">
                <span className="ng-title">{fmtDay(g.c.recordedAt)} · {clipTitle(g.c)}</span>
                <span className="dim small">{g.hits.length}</span>
              </div>
              {g.hits.map((h, i) => (
                <div key={i} className={'tx-hit' + (h.key === currentKey ? ' cur' : '')} onClick={() => openHit(h)} style={{ '--c': colors[h.track] }}>
                  <span className="tx-time">{fmtTime(h.t)}</span>
                  <span className="tx-who">{trackNamesFor(useStore.getState(), h.key)[h.track]}</span>
                  <span className="tx-text">{hl(h.text)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : !clip ? (
        <div className="notes-empty"><p>Open a recording to see its transcript.</p></div>
      ) : !cols.length ? (
        <div className="notes-empty"><p>{done.length ? 'Loading…' : 'No transcript yet for this recording.'}</p></div>
      ) : (
        <>
          <div className="tx-cols-head" style={{ '--n': cols.length }}>
            <span />
            {cols.map((tr) => <span key={tr} style={{ '--c': colors[tr] }}>{trackNames[tr]}</span>)}
            {!follow && <button className="link-btn tx-follow" onClick={() => setFollow(true)} title="Scroll along with the playhead again">Follow ↓</button>}
          </div>
          {!sel && !summary && <div className="tx-hint dim small">Click a line to jump there · Shift+click another to select that section</div>}
          <div className="tx-body" ref={bodyRef} onScroll={onScroll} onWheel={() => setFollow(false)}>
            <div style={{ zoom }}>
              <div style={{ height: start * EST }} />
              <div ref={blockRef}>{rowEls}</div>
              <div style={{ height: (rows.length - end) * EST }} />
            </div>
          </div>
          {sel && (
            <div className="tx-selbar">
              <span className="grow">
                <b>{sel.b - sel.a + 1}</b> line{sel.b === sel.a ? '' : 's'} · {fmtTime(rows[sel.a].s)}–{fmtTime(rows[sel.b].e)}
              </span>
              <button className="btn small accent" onClick={summarizeSel} disabled={summary && ['loading', 'thinking', 'writing'].includes(summary.status)} title="Summarize this section with the local AI (on your graphics card)">✦ Summarize</button>
              <button className="btn small ghost" onClick={addSelToSection} title="Add these lines to the open edit section, as a clip (cut by transcript)">＋ Add to section</button>
              <button className="btn small ghost" onClick={copySel} title="Copy these lines with timestamps and names">Copy</button>
              <button className="icon-btn small" onClick={() => setSel(null)} title="Clear selection (Esc)">×</button>
            </div>
          )}
          {summary && <SummaryCard summary={summary} onClose={closeSummary} onNote={summaryToNote} />}
        </>
      )}
    </div>
  )
}

// "[1:02:03]" in a summary → a link that jumps there.
const TS = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g
const toSecs = (ts) => ts.split(':').reduce((a, p) => a * 60 + Number(p), 0)
function linkify(line, onSeek) {
  const out = []
  let last = 0
  let m
  TS.lastIndex = 0
  while ((m = TS.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const t = toSecs(m[1])
    out.push(<button key={m.index} className="sum-ts" onClick={() => (onSeek ? onSeek(t) : player.seek(t, { exact: true }))} title="Jump here">{m[1]}</button>)
    last = m.index + m[0].length
  }
  out.push(line.slice(last))
  return out
}

// Summaries of transcript selections, for Review and Edit: streams in via
// the local model (electron/main/llm.js).
export function useSummarizer() {
  const [summary, setSummary] = useState(null) // {id, from, to, status, text, error}
  useEffect(
    () =>
      api.onLlmEvent((ev) =>
        setSummary((cur) => {
          if (!cur || cur.id !== ev.id) return cur
          if (ev.type === 'status') return { ...cur, status: ev.status }
          if (ev.type === 'text') return { ...cur, status: 'writing', text: ev.text }
          if (ev.type === 'done') return { ...cur, status: 'done', text: ev.text }
          if (ev.type === 'error') return { ...cur, status: 'error', error: ev.message }
          return cur
        })
      ),
    []
  )
  async function summarize({ from, to, title, lines }) {
    const id = 'sum' + Date.now()
    if (!(await api.llmInstalled())) {
      setSummary({ id, from, to, status: 'error', error: "AI summaries aren't set up yet — Settings → Tools." })
      return
    }
    setSummary({ id, from, to, status: 'loading', text: '' })
    api.summarize(id, { title, lines })
  }
  return { summary, summarize, closeSummary: () => setSummary(null) }
}

export function SummaryCard({ summary, onClose, onNote, onSeek, noteLabel = 'Save as note' }) {
  const { status, text, error, from, to } = summary
  const working = ['loading', 'thinking', 'writing'].includes(status) || /^reading/.test(status || '')
  const label = status === 'loading' ? 'Loading the model onto your graphics card… (first time takes ~10 s)' : status === 'thinking' ? 'Reading the section…' : /^reading/.test(status || '') ? 'Long section — ' + status + '…' : null
  return (
    <div className="sum-card">
      <div className="sum-head">
        <span className="sum-title">✦ Summary <span className="dim">{fmtTime(from)}–{fmtTime(to)}</span></span>
        {status === 'done' && (
          <>
            <button className="link-btn" onClick={() => { navigator.clipboard.writeText(text); useStore.getState().showToast('Summary copied') }}>Copy</button>
            <button className="link-btn" onClick={onNote} title="Save it at the start of the section">{noteLabel}</button>
          </>
        )}
        <button className="icon-btn small" onClick={onClose} title="Close">×</button>
      </div>
      <div className="sum-body">
        {status === 'error' ? (
          <div className="error-text small">{error}</div>
        ) : (
          <>
            {label && !text && <div className="dim small sum-wait"><span className="act-dot" /> {label}</div>}
            {(text || '').split('\n').map((ln, i) =>
              ln.trim() ? (
                <p key={i} className={/^\s*[-*•]/.test(ln) ? 'sum-bullet' : ''}>{linkify(ln.replace(/^\s*[-*•]\s*/, '').replace(/\*\*/g, ''), onSeek)}</p>
              ) : null
            )}
            {working && text && <span className="sum-caret" />}
          </>
        )}
      </div>
    </div>
  )
}
