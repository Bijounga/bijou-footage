// The transcript under the voiceover timeline — automatic, like Edit's: the
// lines of what you say in the CUT (not the whole recordings), following the
// playhead. The line you're on is bright, the ones just before it and after
// it fade with distance, so you always see what you just said and what's
// coming. Click a line to jump there. Single speaker, so it stays compact.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { voPlayer } from '../lib/voPlayer.js'
import { onTick } from '../lib/hooks.js'
import { useVo } from '../state/voStore.js'
import { bus } from '../lib/hooks.js'
import { buildLines, loadTx, onTx } from '../lib/voTranscripts.js'
import { fmtTime } from '../lib/time.js'
import FontSize, { useCtrlWheelSize, stepSetting } from './FontSize.jsx'

// the text with the searched word marked
function marked(text, needle) {
  if (!needle) return text
  const low = text.toLowerCase()
  const out = []
  let i = 0
  for (;;) {
    const j = low.indexOf(needle, i)
    if (j < 0) break
    if (j > i) out.push(text.slice(i, j))
    out.push(<mark key={j}>{text.slice(j, j + needle.length)}</mark>)
    i = j + needle.length
  }
  out.push(text.slice(i))
  return out
}

const Line = React.memo(function Line({ l, d, onGo, needle, hit, here }) {
  // 0 = the line you're on; fades the farther away it is
  const op = d === 0 ? 1 : Math.max(0.22, (d < 0 ? 0.62 : 0.74) - 0.11 * (Math.abs(d) - 1))
  return (
    <div className={'vo-tx-line' + (d === 0 ? ' now' : '') + (hit ? ' hit' : '') + (here ? ' here' : '')} style={{ opacity: hit ? 1 : op }} onClick={() => onGo(l.start)} title="Jump here">
      <span className="vo-tx-time">{fmtTime(l.start)}</span>
      <span className="vo-tx-text">{marked(l.text, needle)}</span>
    </div>
  )
})

export default function VoTranscript({ section }) {
  const clips = section ? section.clips : null
  const project = useStore((s) => s.currentProject())
  const folder = project && project.folder
  const tx = useStore((s) => s.tx)
  const auto = useStore((s) => s.settings.autoTranscribeOpen !== false)
  const [ver, setVer] = useState(0)
  useEffect(() => onTx(() => setVer((v) => v + 1)), [])
  // saved transcripts of the takes in this section
  const takes = useMemo(() => {
    const m = new Map()
    for (const c of clips || []) for (const t of c.takes) m.set(t.id, t)
    return [...m.values()]
  }, [clips])
  useEffect(() => { if (folder) takes.forEach((t) => loadTx(folder, t)) }, [folder, takes])
  const lines = useMemo(() => (clips ? buildLines(clips) : []), [clips, ver])

  // the line under the playhead
  const [cur, setCur] = useState(-1)
  useEffect(() => onTick(90, () => {
    const t = voPlayer.getTime() + 0.05
    let i = -1
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].start <= t) i = k
      else break
    }
    setCur((p) => (p === i ? p : i))
  }), [lines])
  // keep it a bit above the middle, so there's more ahead than behind
  const listRef = useRef(null)
  useEffect(() => {
    const list = listRef.current
    const el = list && list.children[Math.max(0, cur)]
    if (el) list.scrollTo({ top: el.offsetTop - list.clientHeight * 0.36, behavior: 'smooth' })
  }, [cur, lines.length])
  const go = (t) => voPlayer.seek(t)

  // ---- search: find a word in the cut, step through the hits ----
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const hits = useMemo(() => (needle ? lines.map((l, i) => (l.text.toLowerCase().includes(needle) ? i : -1)).filter((i) => i >= 0) : []), [lines, needle])
  const [hitAt, setHitAt] = useState(-1) // which hit (index into hits) you're on
  useEffect(() => setHitAt(-1), [needle])
  // the hits are drawn on the timeline's ruler too
  useEffect(() => {
    useVo.setState({ txHits: hits.map((i) => lines[i].start) })
    return () => useVo.setState({ txHits: [] })
  }, [hits, lines])
  const step = (dir) => {
    if (!hits.length) return
    let n
    if (hitAt < 0) {
      // the first one after the playhead (or the last one before it)
      const t = voPlayer.getTime() - 0.05
      n = dir > 0 ? hits.findIndex((i) => lines[i].start >= t) : hits.map((i) => lines[i].start < t).lastIndexOf(true)
      if (n < 0) n = dir > 0 ? 0 : hits.length - 1
    } else n = (hitAt + dir + hits.length) % hits.length
    setHitAt(n)
    voPlayer.seek(lines[hits[n]].start)
  }
  const inputRef = useRef(null)
  useEffect(() => bus.on('voSearch', () => { inputRef.current && inputRef.current.focus(); inputRef.current && inputRef.current.select() }), [])

  const running = tx.running && String(tx.running.key).startsWith('vo:') ? tx.running : null
  const queued = tx.queue.filter((j) => String(j.key).startsWith('vo:')).length
  let note = null
  if (!tx.installed) note = <>Speech-to-text isn't set up. <button className="link-btn" onClick={() => { try { localStorage.setItem('settingsTab', 'ai') } catch {} useStore.getState().openModal('settings') }}>Set it up…</button></>
  else if (running) note = running.loading ? 'Loading the speech model…' : `Transcribing your voiceover · ${running.duration ? Math.floor((100 * running.done) / running.duration) : 0}%${queued ? ` · ${queued} more` : ''}`
  else if (queued) note = `Transcribing · ${queued} waiting`
  else if (!lines.length && takes.length) note = auto ? 'No speech found in this cut yet.' : 'Turned off: Settings → Transcription & AI → “Transcribe a recording when I open it”.'
  const w = useStore((s) => s.settings.voTxW) || 560
  const scale = useStore((s) => s.settings.voTxScale) || 1
  const stepScale = React.useMemo(() => stepSetting('voTxScale'), [])
  useCtrlWheelSize(listRef, stepScale)
  const onResize = (e) => {
    e.preventDefault()
    const x0 = e.clientX
    const move = (ev) => useStore.getState().updateSettings({ voTxW: Math.max(340, Math.min(1400, w - (ev.clientX - x0))) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="vo-tx" style={{ width: w, '--tz': scale }}>
      <div className="vo-tx-resize" onPointerDown={onResize} title="Drag to change the width" />
      <div className="vo-tx-head">
        <span>Transcript</span>
        <div className="vo-tx-search">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 10l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <input
            ref={inputRef}
            value={q}
            placeholder="Search what you said"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
              else if (e.key === 'Escape') { if (q) setQ(''); else e.currentTarget.blur() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
            }}
          />
          {needle && <span className="vo-tx-count">{hits.length ? (hitAt >= 0 ? hitAt + 1 + ' / ' : '') + hits.length : 'none'}</span>}
          {needle && <button onClick={() => step(-1)} title="Previous (Shift+Enter)" disabled={!hits.length}>▲</button>}
          {needle && <button onClick={() => step(1)} title="Next (Enter)" disabled={!hits.length}>▼</button>}
        </div>
        {note && <span className="vo-tx-note">{note}</span>}
        <span className="vo-tx-spacer" />
        <FontSize value={scale} onStep={stepScale} />
        <button className="link-btn" onClick={() => useStore.getState().updateSettings({ voTranscript: false })} title="Hide the transcript (T)">Hide</button>
      </div>
      <div className="vo-tx-list" ref={listRef}>
        {lines.map((l, i) => (
          <Line key={l.id} l={l} d={cur < 0 ? i + 1 : i - cur} onGo={go} needle={needle} hit={hits.includes(i)} here={hitAt >= 0 && hits[hitAt] === i} />
        ))}
        {!lines.length && !note && <div className="vo-tx-empty dim">What you say shows up here as soon as it's recorded.</div>}
        <div className="vo-tx-pad" />
      </div>
    </div>
  )
}
