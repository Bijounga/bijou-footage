// The Voiceover strip, just above Edit's timeline — like keeping your
// voiceover sequence open next to the cut in Premiere: your cleaned-up
// voiceover from the Voiceover tab, to pick lines from and bring down to the
// footage. Two ways, side by side (or one at a time):
//   CLIPS       the voiceover as its own little timeline: the real waveform
//               clips (the pieces you cut in the Voiceover tab) to scroll
//               through and grab
//   TRANSCRIPT  every sentence you said, in order
// Either way:  click → it drops on the voiceover track at the playhead
//              drag  → down onto the voiceover track, wherever it should go
// A clip drops whole; a transcript line drops just that sentence. Ticks show
// what's on the track already. Its own strip (not a side-panel tab), so Notes
// and the cut's Transcript can stay open beside the picture. Drag its top
// edge for more room; ▤ on the voiceover track (or ×) shows / hides it.
import React, { useEffect, useMemo } from 'react'
import { useStore } from '../state/store.js'
import VoSource from './VoSource.jsx'
import { useVo } from '../state/voStore.js'
import * as VM from '../lib/voModel.js'
import { buildLines, loadTx, onTx, requestTx } from '../lib/voTranscripts.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { fmtTime } from '../lib/time.js'
import FontSize, { stepSetting } from './FontSize.jsx'
import { VO_MIME } from '../lib/voLane.js'
import { voSrc } from '../lib/voPlayer.js'
import { onTick } from '../lib/hooks.js'
import { linkSourcePlayer } from '../lib/voSrcKeys.js'

const NO_VO = []
const stepScale = stepSetting('voPanelScale')
const STRIP_H = 168

// Is there any voiceover to show (so the strip only appears when it's useful)?
export function useHasVo() {
  return useVo((s) => s.sections.some((x) => x.clips.length))
}

function StripResize() {
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const strip = e.currentTarget.parentElement
    const h0 = strip.getBoundingClientRect().height
    const y0 = e.clientY
    const move = (ev) => useStore.getState().updateSettings({ editVoStripH: Math.round(Math.max(96, Math.min(420, h0 - (ev.clientY - y0)))) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="vo-strip-resize top" onMouseDown={down} onDoubleClick={() => useStore.getState().updateSettings({ editVoStripH: null })} title="Drag to resize the Voiceover strip · double-click to reset" />
}

// The bottom edge: dragging it down grows the strip into the timeline below
// (the timeline gets shorter) instead of pushing up into the picture.
function StripResizeBottom() {
  function down(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const strip = e.currentTarget.parentElement
    const et = strip.parentElement.querySelector('.et')
    const h0 = strip.getBoundingClientRect().height
    const t0 = et ? et.getBoundingClientRect().height : 300
    const y0 = e.clientY
    const move = (ev) => {
      // what the timeline can give up, keeping it at least 120 px
      const dy = Math.max(96 - h0, Math.min(t0 - 120, Math.min(420 - h0, ev.clientY - y0)))
      useStore.getState().updateSettings({ editVoStripH: Math.round(h0 + dy), editTimelineHeight: Math.round(t0 - dy) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div className="vo-strip-resize bottom" onMouseDown={down} onDoubleClick={() => useStore.getState().updateSettings({ editVoStripH: null })} title="Drag to resize the Voiceover strip (the timeline gives up the room) · double-click to reset" />
}

// Play / pause and the time, for the strip's own player.
function SrcTransport() {
  const [s, setS] = React.useState({ t: 0, total: 0, playing: false })
  useEffect(() => onTick(100, () => {
    const n = { t: Math.round(voSrc.getTime() * 10) / 10, total: voSrc.total, playing: voSrc.playing }
    setS((o) => (o.t === n.t && o.total === n.total && o.playing === n.playing ? o : n))
  }), [])
  return (
    <div className="vo-src-transport">
      <button
        className={'icon-btn small vo-src-play' + (s.playing ? ' on' : '')}
        onClick={() => { useStore.getState().setEditFocus('vosrc'); voSrc.toggle() }}
        title="Play / pause the voiceover here (Space while the strip has the focus)"
        aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? (
          <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><rect x="1" y="1" width="3" height="9" rx="0.8" fill="currentColor" /><rect x="6" y="1" width="3" height="9" rx="0.8" fill="currentColor" /></svg>
        ) : (
          <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><path d="M1.5 1l8 4.5-8 4.5z" fill="currentColor" /></svg>
        )}
      </button>
      <span className="vo-src-time">{fmtTime(s.t, true)} <span className="dim">/ {fmtTime(s.total)}</span></span>
    </div>
  )
}

export default function VoPanel({ section }) {
  const sections = useVo((s) => s.sections)
  const project = useStore((s) => s.currentProject())
  const folder = project && project.folder
  const pickId = useStore((s) => s.settings.editVoSrc)
  const scale = useStore((s) => s.settings.voPanelScale) || 1
  const stripH = useStore((s) => s.settings.editVoStripH) || STRIP_H
  const placed = (section && section.vo) || NO_VO
  const list = useMemo(() => [...sections].filter((x) => x.clips.length).sort((a, b) => a.order - b.order), [sections])
  const src = list.find((x) => x.id === pickId) || list[0] || null
  const [ver, setVer] = React.useState(0)
  useEffect(() => onTx(() => setVer((v) => v + 1)), [])
  const auto = useStore((s) => s.settings.autoTranscribeOpen !== false && s.tx.installed)
  const lang = useStore((s) => s.settings.transcriptLang ?? 'en')
  useEffect(() => {
    if (!folder || !src) return
    const takes = src.clips.flatMap((c) => c.takes)
    takes.forEach((t) => loadTx(folder, t))
    // its words, on their own (like the Voiceover tab): the ones with no transcript yet
    if (auto) setTimeout(() => requestTx(folder, takes, lang), 600)
  }, [folder, src, auto, lang])
  // what's said in each clip
  const said = useMemo(() => {
    const m = new Map()
    if (!src) return m
    for (const l of buildLines(src.clips)) {
      const id = l.id.slice(0, l.id.indexOf('@'))
      m.set(id, (m.get(id) ? m.get(id) + ' ' : '') + l.text)
    }
    return m
  }, [src, ver])
  const items = useMemo(() => (src ? VM.layoutVo(src.clips).items.map((it, i) => ({ ...it, n: i + 1 })) : []), [src])
  // A clip counts as placed once most of it is on the track (a single
  // sentence dropped from the transcript doesn't tick the whole clip).
  const count = (clipId) => {
    const it = items.find((x) => x.id === clipId)
    const got = placed.filter((p) => p.src === (src && src.id) && p.srcClip === clipId).reduce((a, p) => a + (p.out - p.in), 0)
    return it && got >= it.dur * 0.9 ? 1 : 0
  }
  // the transcript: every sentence, in order
  const lines = useMemo(() => (src ? buildLines(src.clips) : []), [src, ver])
  const lineCount = (l) => placed.filter((p) => p.src === (src && src.id) && p.srcClip === l.clip && p.in <= l.a + 0.12 && p.out >= l.b - 0.05).length
  const mode = useStore((s) => s.settings.voPanelMode) || 'both'
  const setMode = (m) => useStore.getState().updateSettings({ voPanelMode: m })
  const hide = () => useStore.getState().updateSettings({ editVoStrip: false })

  // the strip plays on its own player (voSrc), like a source monitor
  useEffect(() => { if (src) voSrc.setSection(folder, src.clips) }, [folder, src && src.clips])
  useEffect(() => {
    linkSourcePlayer()
    return () => {
      voSrc.pause()
      if (useStore.getState().editFocus === 'vosrc') useStore.getState().setEditFocus('cut')
    }
  }, [])
  const focused = useStore((s) => s.editFocus === 'vosrc')
  // the sentence under the strip's playhead
  const [curLine, setCurLine] = React.useState(null)
  useEffect(() => onTick(120, () => {
    const t = voSrc.getTime()
    const l = lines.find((x) => t >= x.start - 0.02 && t < x.end + 0.05)
    const id = l ? l.id : null
    setCurLine((c) => (c === id ? c : id))
  }), [lines])
  const listRef = React.useRef(null)
  useEffect(() => {
    // keep the playing sentence in view
    if (!curLine || !listRef.current || !voSrc.playing) return
    const el = listRef.current.querySelector('.vo-card.cur')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [curLine])

  if (!src) return null
  const left = items.filter((it) => !count(it.id)).length
  return (
    <div
      className={'vo-strip' + (focused ? ' focused' : '')}
      style={{ '--vz': scale, height: stripH }}
      onMouseDownCapture={() => useStore.getState().setEditFocus('vosrc')}
    >
      <StripResize />
      <StripResizeBottom />
      <div className="vo-strip-head">
        <b className="vo-strip-title" title="Its own player, like a source monitor: click it, then Space / J K L / ← → play the voiceover here. Drag a clip or line down onto the voiceover track — or double-click a clip / click a line to drop it at the cut's playhead.">Voiceover</b>
        <SrcTransport />
        <select value={src.id} onChange={(e) => useStore.getState().updateSettings({ editVoSrc: e.target.value })} title="Which voiceover section">
          {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div className="seg vo-mode">
          {[['clips', 'Clips'], ['transcript', 'Transcript'], ['both', 'Both']].map(([id, label]) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>
          ))}
        </div>
        <span className="dim small vo-strip-count">{items.length - left} / {items.length} placed</span>
        <span className="vo-tx-spacer" />
        <button className="link-btn" onClick={() => useStore.getState().layInVoSection(src.id, seqPlayer.getTime())} title="Put every line on the voiceover track, back to back from the playhead">Lay in all</button>
        <FontSize value={scale} onStep={stepScale} />
        <button className="icon-btn small vo-strip-x" onClick={hide} title="Hide the Voiceover strip (the strip button on the voiceover track brings it back)" aria-label="Hide the Voiceover strip">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className={'vo-strip-body ' + mode}>
        {mode !== 'transcript' && <VoSource src={src} items={items} said={said} placedOf={count} folder={folder} height={stripH - 36} />}
        {mode !== 'clips' && (
          <div className="vo-panel-list vo-lines" ref={listRef}>
            {lines.map((l) => {
              const n = lineCount(l)
              return (
                <div
                  key={l.id}
                  className={'vo-card line' + (n ? ' placed' : '') + (curLine === l.id ? ' cur' : '')}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(VO_MIME, JSON.stringify({ src: src.id, clip: l.clip, a: l.a, b: l.b }))
                    e.dataTransfer.effectAllowed = 'copy'
                    window.__voDragLen = Math.max(0.05, l.b - l.a + 0.2)
                  }}
                  onDragEnd={() => { window.__voDragLen = null }}
                  onClick={() => useStore.getState().placeVoClip(src.id, l.clip, seqPlayer.getTime(), { a: l.a, b: l.b })}
                  title="Click: drop this sentence at the playhead · drag: onto the voiceover track"
                >
                  <button
                    className="vo-line-play"
                    onClick={(e) => { e.stopPropagation(); voSrc.seek(l.start); voSrc.play() }}
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    title="Listen to this line (in the strip)"
                    aria-label="Listen to this line"
                  >
                    <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1l7 4-7 4z" fill="currentColor" /></svg>
                  </button>
                  <span className="vo-card-n">{n ? '✓' : ''}</span>
                  <span className="vo-card-text">{l.text}</span>
                  <span className="vo-card-dur">{fmtTime(l.b - l.a, true)}</span>
                </div>
              )
            })}
            {!lines.length && <div className="dim small vo-lines-empty">The transcript appears here once your voiceover has been transcribed (it starts on its own).</div>}
          </div>
        )}
      </div>
    </div>
  )
}
