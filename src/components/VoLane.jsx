// The voiceover track under Edit's audio tracks — an audio track like the
// others, Premiere-style. Voiceover clips (brought in from the Voiceover
// strip above the timeline) sit wherever you slide them — not tied to the
// cuts' lengths, so a line can run across several cuts, or several lines can
// sit under one.
//   click          select (Ctrl / Shift+click adds)
//   drag a clip    move the picked clips (hold Shift to carry everything
//                  after them along, keeping the spacing of a run of lines)
//   drag an edge   trim it (the cursor shows which side; stops at the take's
//                  ends and the clips next to it)
//   cut tool (C)   click a clip to cut it there
//   right-click    colour, volume, cut, copy, delete
//   empty lane     click: deselect and put the playhead there · drag: a box
//   F cuts it at the playhead · Delete takes it off (a gap stays) ·
//   Shift+Delete closes up · Ctrl+C / Ctrl+V copy and paste · Ctrl+Z undoes
// Snaps to the cuts, markers, notes, the playhead and the other voiceover
// clips — and the cut's edges / playhead snap to these (EditTimeline).
// The track head (VoTrackHead) has mute, solo, volume, colour and height.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, VO_TRACK } from '../state/store.js'
import * as VL from '../lib/voLane.js'
import { CLIP_LABEL_HEX, CLIP_LABELS } from '../lib/editModel.js'
import { ensurePeaks, peaksOf, onPeaks } from '../lib/voPeaks.js'
import { seqPlayer } from '../lib/seqPlayer.js'
import { voMix } from '../lib/voPlayer.js'
import { useVo } from '../state/voStore.js'
import { loadTx, onTx, textIn, requestTx } from '../lib/voTranscripts.js'
import { trimTip } from '../lib/trimUi.js'
import { fmtTime } from '../lib/time.js'
import { bus, onTick } from '../lib/hooks.js'
import { Fader } from './Timeline.jsx'
import { VO_MIME } from '../lib/voLane.js'
import { editRecToggle } from '../lib/editRecord.js'

export const VO_DEFAULT_COLOR = '#4fd1c5'
const SNAP_PX = 8
const DRAG_PX = 4
const EDGE_PX = 6

function rgba(hex, a) {
  const h = (hex || VO_DEFAULT_COLOR).replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// The track's settings with the defaults filled in.
export function useVoTrack() {
  const t = useStore((s) => s.settings.voTrack)
  return useMemo(() => ({ ...VO_TRACK, ...(t || {}) }), [t])
}

// Is the voiceover heard, given mute / solo (solo is shared with the cut's
// tracks: 'vo' in it means the voiceover is soloed).
export const voAudible = (track, solo) => (solo.length ? solo.includes('vo') : !track.mute)

// ---- the head, beside the lane ----
export function VoTrackHead({ count }) {
  const track = useVoTrack()
  const solo = useStore((s) => s.solo)
  const soloed = solo.includes('vo')
  const stripOn = useStore((s) => s.settings.editVoStrip !== false)
  const rec = useStore((s) => !!s.editRec)
  const audible = voAudible(track, solo)
  const color = track.color || VO_DEFAULT_COLOR
  const meter = useRef(null)
  const onVol = useCallback((v) => useStore.getState().setVoTrack({ vol: v }), [])
  // the meter, ~30 times a second on the shared frame ticker
  useEffect(() => {
    let sc0 = -1
    return onTick(33, () => {
      if (sc0 === 0 && !voMix.playing) return
      const p = voMix.level()
      const db = p > 0 ? 20 * Math.log10(p) : -60
      const sc = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 100) / 100
      if (sc !== sc0 && meter.current) { sc0 = sc; meter.current.style.transform = `scaleX(${sc})` }
    })
  }, [])
  function resizeDown(e) {
    e.preventDefault()
    e.stopPropagation()
    const y0 = e.clientY
    const h0 = track.h
    const move = (ev) => useStore.getState().setVoTrack({ h: Math.round(Math.max(32, Math.min(220, h0 + ev.clientY - y0))) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ns')
    }
    document.body.classList.add('resizing-ns')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const toggleSolo = (e) => {
    const st = useStore.getState()
    useStore.setState((s) => {
      const has = s.solo.includes('vo')
      if (e.ctrlKey) return { solo: has ? s.solo.filter((x) => x !== 'vo') : [...s.solo, 'vo'] }
      return { solo: has && s.solo.length === 1 ? [] : ['vo'] }
    })
    st.pushMixer()
  }
  return (
    <div className={'track-head vo-track-head' + (audible ? '' : ' silent')} style={{ height: track.h, '--c': color }}>
      <div className="th-main">
        <div className="th-top">
          <label className="th-color" title="Voiceover colour — click to change · right-click to reset" onContextMenu={(e) => { e.preventDefault(); useStore.getState().setVoTrack({ color: null }) }}>
            <input type="color" value={color} onChange={(e) => useStore.getState().setVoTrack({ color: e.target.value })} />
          </label>
          <span className="th-name" title="The voiceover track — bring lines in from the Voiceover strip above the timeline">Voiceover{count ? <span className="dim"> · {count}</span> : null}</span>
          <span className="th-volnum">{Math.round(track.vol * 100)}%</span>
        </div>
        <div className="th-buttons">
          <button className={'th-btn' + (track.mute ? ' on-m' : '')} onClick={() => useStore.getState().setVoTrack({ mute: !track.mute })} title="Mute the voiceover">M</button>
          <button className={'th-btn' + (soloed ? ' on-s' : '')} onClick={toggleSolo} title="Solo the voiceover (silences the cut's tracks) · Ctrl+click to solo it with others">S</button>
          <button
            className={'th-btn' + (stripOn ? ' on-a' : '')}
            onClick={() => useStore.getState().updateSettings({ editVoStrip: !stripOn })}
            title="Show / hide the Voiceover strip above the timeline (where your recorded lines are)"
            aria-label="Voiceover strip"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1.5" width="10" height="4" rx="1" fill="currentColor" /><path d="M1.5 8.5h9M1.5 10.8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
          <button
            className={'th-btn th-rec' + (rec ? ' on' : '')}
            onClick={() => editRecToggle()}
            title={rec ? 'Stop recording (R / Space / Esc)' : 'Record voiceover over the cut (R) — from the playhead, after the pre-roll'}
            aria-label={rec ? 'Stop recording' : 'Record voiceover'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">{rec ? <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /> : <circle cx="5" cy="5" r="3.6" fill="currentColor" />}</svg>
          </button>
          <div className="th-meter"><div ref={meter} /></div>
        </div>
      </div>
      <Fader value={track.vol} onChange={onVol} height={track.h} />
      <div className="th-resize" onMouseDown={resizeDown} onDoubleClick={() => useStore.getState().setVoTrack({ h: VO_TRACK.h })} title="Drag to resize the voiceover track · double-click to reset" />
    </div>
  )
}

// ---- the lane ----
export default function VoLane({ vo, view, width, folder, snapCands, tool, onEmptyDown }) {
  const sel = useStore((s) => s.voSel)
  const snapOn = useStore((s) => s.settings.editSnap !== false)
  const track = useVoTrack()
  const solo = useStore((s) => s.solo)
  const audible = voAudible(track, solo)
  const H = track.h
  const trackHex = track.color || VO_DEFAULT_COLOR
  const vsections = useVo((s) => s.sections)
  const rowRef = useRef(null)
  const canvasRef = useRef(null)
  const [live, setLive] = useState(null) // the lane while a clip is being dragged / trimmed
  const [trimming, setTrimming] = useState(null) // {id, side} — that edge lights up
  const [ver, setVer] = useState(0)
  const [menu, setMenu] = useState(null) // {ids, x, y}
  const items = live || vo
  const [dropAt, setDropAt] = useState(null) // where a dragged card would land (seconds)

  // the recorded takes behind the clips (for their lengths and transcripts)
  const takes = useMemo(() => {
    const m = new Map()
    for (const s of vsections) for (const c of s.clips) for (const t of c.takes) m.set(t.id, t)
    return m
  }, [vsections])
  useEffect(() => {
    if (!folder || !vo.length) return
    ensurePeaks(folder, vo.map((v) => v.take))
    const ts = [...new Set(vo.map((v) => v.take))].map((id) => takes.get(id)).filter(Boolean)
    ts.forEach((t) => loadTx(folder, t))
    // the clips are labelled with what's said in them: transcribe takes that aren't yet
    const st = useStore.getState()
    if (st.settings.autoTranscribeOpen !== false && st.tx.installed) {
      const timer = setTimeout(() => requestTx(folder, ts, st.settings.transcriptLang ?? 'en', false), 1500)
      return () => clearTimeout(timer)
    }
  }, [folder, vo, takes])
  useEffect(() => onPeaks(() => setVer((v) => v + 1)), [])
  useEffect(() => onTx(() => setVer((v) => v + 1)), [])
  const takeDur = (id) => {
    const t = takes.get(id)
    if (t && t.dur) return t.dur
    const pk = peaksOf(id)
    return pk ? pk.length / 200 : Infinity
  }

  // what each clip says, worked out once (not on every redraw while panning)
  const labels = useMemo(() => new Map(), [ver])
  const saidIn = (v) => {
    const k = v.take + '@' + v.in + '-' + v.out
    let t = labels.get(k)
    if (t == null) labels.set(k, (t = textIn(v.take, v.in, v.out)))
    return t
  }

  // ---- drawing ----
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(H * dpr)
      cv.style.width = width + 'px'
      cv.style.height = H + 'px'
    }
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, H)
    const selSet = new Set(sel)
    const labelH = H >= 44 ? 15 : 0
    const mid = labelH + (H - labelH) / 2
    const half = (H - labelH) / 2 - 3
    for (const v of items) {
      const x0 = (v.at - view.start) * view.pps
      const x1 = x0 + (v.out - v.in) * view.pps
      if (x1 < 0 || x0 > width) continue
      const on = selSet.has(v.id)
      const hex = v.color ? CLIP_LABEL_HEX[v.color] : trackHex
      const w = Math.max(1, x1 - x0)
      // the body, like an audio clip in Premiere: tinted, a darker label strip on top
      ctx.fillStyle = rgba(hex, on ? 0.42 : 0.22)
      ctx.fillRect(x0, 1, w, H - 2)
      if (labelH) {
        ctx.fillStyle = rgba(hex, on ? 0.75 : 0.5)
        ctx.fillRect(x0, 1, w, labelH)
      }
      const pk = peaksOf(v.take)
      if (pk) {
        ctx.fillStyle = on ? '#ffffff' : rgba(hex, 0.95)
        ctx.beginPath()
        const g = v.gain ? Math.pow(10, v.gain / 20) : 1
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
          const a = v.in + (x - x0) / view.pps
          const i0 = Math.floor(a * 200)
          const i1 = Math.max(i0 + 1, Math.floor((a + 1 / view.pps) * 200))
          let m = 0
          for (let i = Math.max(0, i0); i < Math.min(i1, pk.length); i++) if (pk[i] > m) m = pk[i]
          if (m < 3) continue
          const hgt = Math.max(1, Math.min(1, (m / 255) * g) * half)
          ctx.rect(x, mid - hgt, 1, hgt * 2)
        }
        ctx.fill()
      }
      ctx.strokeStyle = on ? '#fff' : rgba(hex, 0.95)
      ctx.lineWidth = on ? 1.5 : 1
      ctx.strokeRect(x0 + 0.5, 1.5, w - 1, H - 3)
      if (labelH && w > 28) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0 + 3, 1, w - 6, labelH)
        ctx.clip()
        ctx.fillStyle = '#fff'
        ctx.font = '600 10px Inter, sans-serif'
        ctx.textBaseline = 'middle'
        const said = saidIn(v)
        const gain = v.gain ? (v.gain > 0 ? '+' : '') + v.gain + ' dB  ' : ''
        ctx.fillText(gain + (said ? '“' + said + '”' : 'Voiceover ' + fmtTime(v.out - v.in)), Math.max(x0, 0) + 5, 1 + labelH / 2)
        ctx.restore()
      }
      // the edge being trimmed stays lit red
      if (trimming && trimming.id === v.id) {
        ctx.fillStyle = '#ff4a58'
        ctx.fillRect(trimming.side === 'in' ? x0 : x1 - 3, 1, 3, H - 2)
      }
    }
  }, [items, view, width, sel, ver, H, trackHex, trimming])

  // ---- mouse ----
  const at = (e) => view.start + (e.clientX - rowRef.current.getBoundingClientRect().left) / view.pps
  const hit = (t) => items.find((v) => t >= v.at && t < VL.endOf(v))
  // Is the pointer on a clip's edge? {v, side} — within a few pixels, the
  // nearer edge for short clips.
  const edgeAt = (e) => {
    const x = e.clientX - rowRef.current.getBoundingClientRect().left
    for (const v of items) {
      const x0 = (v.at - view.start) * view.pps
      const x1 = x0 + (v.out - v.in) * view.pps
      const zone = Math.min(EDGE_PX, (x1 - x0) / 3)
      if (x >= x0 - 2 && x <= x0 + zone) return { v, side: 'in' }
      if (x >= x1 - zone && x <= x1 + 2) return { v, side: 'out' }
    }
    return null
  }
  const nearest = (edgeT, pts) => {
    const tol = SNAP_PX / view.pps
    let best = null
    let d = tol
    for (const c of pts) { const dd = Math.abs(c - edgeT); if (dd < d) { d = dd; best = c } }
    return best
  }
  // snap a candidate shift (seconds) of the picked clips to the nearest
  // cut / marker / note / playhead / other clip edge
  const snapShift = (dt, picked, all) => {
    if (!snapOn) return dt
    const pts = [...snapCands(), seqPlayer.getTime(), ...VL.edges(all, picked.map((p) => p.id))]
    const tol = SNAP_PX / view.pps
    let best = dt
    let d = tol
    for (const p of picked) {
      for (const edge of [p.at + dt, VL.endOf(p) + dt]) {
        for (const c of pts) {
          const dd = Math.abs(c - edge)
          if (dd < d) { d = dd; best = dt + (c - edge) }
        }
      }
    }
    return best
  }
  const snapTime = (t, exceptIds = []) => {
    if (!snapOn) return t
    const c = nearest(t, [...snapCands(), seqPlayer.getTime(), ...VL.edges(vo, exceptIds)])
    return c == null ? t : c
  }
  // where a dropped card's start lands (snapped, like moving)
  const snapDrop = (t, len) => Math.max(0, t + snapShift(0, [{ id: '_drop', at: t, in: 0, out: len }], vo))

  function hover(e) {
    const row = rowRef.current
    if (!row || e.buttons) return
    const ed = tool !== 'razor' && edgeAt(e)
    const cur = tool === 'razor' ? 'crosshair' : ed ? (ed.side === 'in' ? 'var(--cur-trim-in)' : 'var(--cur-trim-out)') : hit(at(e)) ? 'grab' : ''
    if (row.style.cursor !== cur) row.style.cursor = cur
  }

  function trimDown(e, v, side) {
    const st = useStore.getState()
    const base = st.currentSection().vo || []
    const x0 = e.clientX
    const edge0 = side === 'in' ? v.at : VL.endOf(v)
    const dur = takeDur(v.take)
    const tip = trimTip()
    seqPlayer.pause()
    st.setVoSel([v.id], { keepEdit: false })
    document.body.classList.add('resizing-ew', 'trim-' + side)
    setTrimming({ id: v.id, side })
    let next = null
    const move = (ev) => {
      const T = snapTime(edge0 + (ev.clientX - x0) / view.pps, [v.id])
      const n = VL.trimEdge(base, v.id, side, T, dur)
      if (!n) return
      next = n
      setLive(n)
      const c = n.find((x) => x.id === v.id)
      tip.set(ev.clientX, ev.clientY, side === 'in' ? v.in - c.in : c.out - v.out)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-ew', 'trim-' + side)
      tip.remove()
      setTrimming(null)
      setLive(null)
      if (next) st.applyVo(next, { select: [v.id] })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const down = (e) => {
    if (e.button !== 0) return
    const st = useStore.getState()
    const t = at(e)
    if (tool === 'razor') {
      e.stopPropagation()
      const T = snapOn ? snapTime(t) : t
      const next = hit(t) && VL.splitAt(vo, T)
      if (next && st.applyVo(next)) bus.emit('osd', 'Cut voiceover')
      return
    }
    const ed = edgeAt(e)
    if (ed) {
      e.stopPropagation()
      e.preventDefault()
      return trimDown(e, ed.v, ed.side)
    }
    const v = hit(t)
    // empty lane: the timeline's own selection box / playhead click
    if (!v) return onEmptyDown && onEmptyDown(e)
    e.stopPropagation()
    seqPlayer.pause()
    const add = e.ctrlKey || e.metaKey || e.shiftKey
    let ids = st.voSel
    const wasIn = ids.includes(v.id)
    if (e.ctrlKey || e.metaKey) ids = wasIn ? ids.filter((x) => x !== v.id) : [...ids, v.id]
    else if (!wasIn) ids = e.shiftKey ? [...ids, v.id] : [v.id]
    st.setVoSel(ids, { keepEdit: add })
    const x0 = e.clientX
    const base = st.currentSection().vo || []
    const ripple = e.shiftKey // Shift-drag: carry everything after it along too
    let moved = false
    let next = null
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < DRAG_PX) return
      if (!moved && !ids.includes(v.id)) return // Ctrl+click took it out
      moved = true
      document.body.classList.add('grabbing')
      const picked = base.filter((b) => ids.includes(b.id))
      const dt = snapShift((ev.clientX - x0) / view.pps, picked, base)
      next = VL.moveClips(base, ids, dt, ripple || ev.shiftKey)
      setLive(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('grabbing')
      setLive(null)
      if (moved && next) st.applyVo(next, { select: ids })
      // a Shift+click that didn't drag just added it (Premiere's Shift+click)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function context(e) {
    const v = hit(at(e))
    if (!v) return
    e.preventDefault()
    e.stopPropagation()
    const st = useStore.getState()
    const ids = st.voSel.includes(v.id) ? st.voSel : [v.id]
    if (!st.voSel.includes(v.id)) st.setVoSel(ids, { keepEdit: false })
    setMenu({ ids, x: e.clientX, y: e.clientY, t: at(e) })
  }

  return (
    <div
      className={'et-row vo' + (audible ? '' : ' silent')}
      ref={rowRef}
      style={{ height: H, '--c': trackHex }}
      onMouseDown={down}
      onMouseMove={hover}
      onContextMenu={context}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(VO_MIME)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setDropAt(snapDrop(at(e), window.__voDragLen || 1))
      }}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(VO_MIME)
        if (!raw) return
        e.preventDefault()
        e.stopPropagation()
        setDropAt(null)
        try {
          const d = JSON.parse(raw)
          useStore.getState().placeVoClip(d.src, d.clip, snapDrop(at(e), window.__voDragLen || 1), d.a != null ? { a: d.a, b: d.b } : undefined)
        } catch { /* not ours */ }
      }}
    >
      <canvas ref={canvasRef} />
      {!items.length && <div className="et-vo-empty dim">Voiceover — drag lines here from the Voiceover strip above (or click one to drop it at the playhead)</div>}
      {dropAt != null && <div className="et-vo-drop" style={{ left: (dropAt - view.start) * view.pps }} />}
      <RecBlock view={view} />
      {menu && <VoClipMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

// While recording over the cut: a red block on the track from where the take
// starts to the playhead, growing as you talk.
function RecBlock({ view }) {
  const rec = useStore((s) => s.editRec)
  const ref = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    if (!rec || rec.phase !== 'recording') return
    return onTick(0, () => {
      const el = ref.current
      if (!el) return
      const v = viewRef.current
      const x0 = (rec.start - v.start) * v.pps
      const w = Math.max(1, (seqPlayer.getTime() - rec.start) * v.pps)
      el.style.transform = 'translateX(' + Math.round(x0) + 'px)'
      el.style.width = Math.round(w) + 'px'
    })
  }, [rec])
  if (!rec || rec.phase !== 'recording') return null
  return <div className="et-vo-rec" ref={ref}><span>● REC</span></div>
}

// Right-click a voiceover clip: colour, volume, cut, copy, delete — for every
// picked clip if it's one of them.
function VoClipMenu({ menu, onClose }) {
  const ref = useRef(null)
  const st = useStore.getState()
  const sec = st.currentSection()
  const clips = ((sec && sec.vo) || []).filter((v) => menu.ids.includes(v.id))
  const [db, setDb] = useState(clips.length ? clips[0].gain || 0 : 0)
  useEffect(() => {
    const close = (ev) => { if (ref.current && !ref.current.contains(ev.target)) onClose() }
    const esc = (ev) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [])
  if (!sec || !clips.length) return null
  const vo = sec.vo || []
  const apply = (next, select) => { useStore.getState().applyVo(next, select ? { select } : {}) }
  const commitDb = (v) => apply(VL.gainClips(useStore.getState().currentSection().vo || [], menu.ids, v))
  const n = menu.ids.length
  const run = (fn) => (ev) => { ev.stopPropagation(); fn(); onClose() }
  return (
    <div
      ref={ref}
      className="et-clipmenu color-menu et-vomenu"
      style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 330) }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      <div className="color-menu-title">{n > 1 ? `${n} voiceover clips` : 'Voiceover clip'}</div>
      <div className="et-vomenu-sub dim">Colour</div>
      <div className="clip-label-grid">
        {CLIP_LABELS.map(([name, hex]) => (
          <button key={name} className={'mk-swatch' + (clips.every((c) => c.color === name) ? ' on' : '')} style={{ '--c': hex }} title={name} onClick={run(() => apply(VL.colorClips(vo, menu.ids, name)))} />
        ))}
      </div>
      <button className="link-btn et-vomenu-row" onClick={run(() => apply(VL.colorClips(vo, menu.ids, null)))}>Track colour</button>
      <div className="et-vomenu-sub dim">Volume <b className="et-vomenu-db">{db > 0 ? '+' : ''}{db.toFixed(1)} dB</b></div>
      <input
        type="range"
        className="et-vomenu-range"
        min="-24"
        max="12"
        step="0.5"
        value={db}
        onChange={(e) => setDb(Number(e.target.value))}
        onMouseUp={(e) => commitDb(Number(e.target.value))}
        onKeyUp={(e) => commitDb(Number(e.target.value))}
        onDoubleClick={() => { setDb(0); commitDb(0) }}
        title="Drag, then let go to set it · double-click: 0 dB"
      />
      <div className="et-vomenu-sep" />
      <button className="et-vomenu-item" onClick={run(() => { const nx = VL.splitAt(vo, menu.t); if (nx) apply(nx) })}>Cut here</button>
      <button className="et-vomenu-item" onClick={run(() => { VL.voClipboard.set(clips); bus.emit('osd', n > 1 ? `Copied ${n} clips` : 'Copied') })}>Copy <span className="dim">Ctrl+C</span></button>
      <button className="et-vomenu-item" onClick={run(() => apply(VL.removeClips(vo, menu.ids), []))}>Delete <span className="dim">Del</span></button>
      <button className="et-vomenu-item" onClick={run(() => apply(VL.rippleRemove(vo, menu.ids), []))}>Ripple delete <span className="dim">Shift+Del</span></button>
    </div>
  )
}
