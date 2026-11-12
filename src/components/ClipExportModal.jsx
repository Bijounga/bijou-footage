import React, { useEffect, useRef, useState } from 'react'
import { useStore, useTrackNames, useTrackColors, fmtBytes } from '../state/store.js'
import { player } from '../lib/player.js'
import { fmtTime, parseTime } from '../lib/time.js'

const SIZES = [
  ['discord10', 'Fit under 10 MB — Discord'],
  ['discord50', 'Fit under 50 MB — Discord (boosted server)'],
  ['original', 'Original quality (big file)']
]

// What a track is set to right now: its fader level, 0 if muted (or another track is soloed).
function levelOf(st, i) {
  const m = st.settings.mixer[i] || { vol: 1, mute: false }
  if (st.solo.length) return st.solo.includes(i) ? m.vol : 0
  return m.mute ? 0 : m.vol
}

// One time box: edits as text, commits on Enter / leaving, with a button to take the playhead.
function TimeBox({ label, value, onChange, max }) {
  const [text, setText] = useState(fmtTime(value, true))
  useEffect(() => { setText(fmtTime(value, true)) }, [value])
  const commit = () => {
    const v = parseTime(text)
    if (v == null) return setText(fmtTime(value, true))
    onChange(Math.max(0, Math.min(max || v, v)))
  }
  return (
    <div className="cx-time">
      <span className="dim small">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      <button className="btn small ghost" onClick={() => onChange(Math.max(0, Math.min(max || player.getTime(), player.getTime())))} title="Use where the playhead is now">Playhead</button>
    </div>
  )
}

export default function ClipExportModal() {
  const closeModal = useStore((s) => s.closeModal)
  const showToast = useStore((s) => s.showToast)
  const clip = useStore((s) => s.clip())
  const range = useStore((s) => s.clipExport)
  const settings = useStore((s) => s.settings)
  const names = useTrackNames(clip && clip.key)
  const colors = useTrackColors()
  const dur = (clip && clip.probe && clip.probe.duration) || 0
  const audio = (clip && clip.probe && clip.probe.audio) || []
  const saved = settings.clipExport || {}

  const [start, setStart] = useState(range ? range.start : 0)
  const [end, setEnd] = useState(range ? range.end : dur)
  const [mode, setMode] = useState(saved.audio || 'one')
  const [size, setSize] = useState(saved.size || 'discord10')
  const [use, setUse] = useState(() => {
    const st = useStore.getState()
    return audio.map((_, i) => levelOf(st, i) > 0 && !(audio[i].likelySilent && settings.autoMuteEmpty))
  })
  const [busy, setBusy] = useState(false)
  const [frac, setFrac] = useState(0)
  const [retry, setRetry] = useState(false)
  const [error, setError] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => window.footage.onExportClip((ev) => { setFrac(ev.fraction || 0); if (ev.retry) setRetry(true) }), [])

  if (!clip) return null
  const len = end - start
  const nUsed = use.filter(Boolean).length
  const ok = len >= 0.5 && start >= 0 && (nUsed > 0 || !audio.length)

  async function go() {
    setBusy(true)
    setError(null)
    setFrac(0)
    setRetry(false)
    const st = useStore.getState()
    useStore.getState().updateSettings({ clipExport: { audio: mode, size } })
    st.scheduleSave()
    const p = clip.probe
    const r = await window.footage.exportClip({
      path: clip.path,
      name: clip.name,
      probe: { vcodec: p.vcodec, width: p.width, height: p.height, fps: p.fps, audio: p.audio.map((a) => ({ channels: a.channels })) },
      start,
      end,
      audio: mode,
      size,
      gains: audio.map((_, i) => (use[i] ? Math.max(0.05, (st.settings.mixer[i] || { vol: 1 }).vol) : 0))
    })
    if (!alive.current) return
    setBusy(false)
    if (r.cancelled) return
    if (r.error) return setError(r.error)
    const over = r.limitMB && r.bytes > r.limitMB * 1e6
    showToast('Clip saved (' + fmtBytes(r.bytes) + (over ? ' — still over ' + r.limitMB + ' MB, try a shorter clip' : '') + ')' + ': ' + r.path)
    window.footage.showItem(r.path)
    closeModal()
  }

  function cancel() {
    if (busy) window.footage.exportClipCancel()
    else closeModal()
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeModal()}>
      <div className="modal cx-modal">
        <div className="modal-head">
          <h2>Export clip</h2>
          <button className="icon-btn" onClick={cancel} title={busy ? 'Stop the export' : 'Close'}>×</button>
        </div>
        <div className="settings">
          <section>
            <h3>Range</h3>
            <div className="dim small">{clip.name}</div>
            <TimeBox label="From" value={start} onChange={setStart} max={dur} />
            <TimeBox label="To" value={end} onChange={setEnd} max={dur} />
            <div className="dim small">{len >= 0.5 ? fmtTime(len, true) + ' long' : 'The end has to come after the start'}</div>
          </section>
          <section>
            <h3>Audio</h3>
            <label className="check"><input type="radio" name="cxa" checked={mode === 'one'} onChange={() => setMode('one')} /> Mix all the tracks into one</label>
            <label className="check"><input type="radio" name="cxa" checked={mode === 'all'} onChange={() => setMode('all')} /> Keep every track separate (as recorded)</label>
            <div className="dim small">
              {mode === 'one'
                ? 'One stereo track at your fader levels — Discord only plays the first track, so this is the one to send.'
                : 'Each ticked track stays its own track, untouched. Discord will only play the first.'}
            </div>
            <div className="cx-tracks">
              {audio.map((a, i) => (
                <label key={i} className="check cx-track">
                  <input type="checkbox" checked={!!use[i]} onChange={(e) => setUse(use.map((u, k) => (k === i ? e.target.checked : u)))} />
                  <span className="th-swatch" style={{ background: colors[i % colors.length] }} />
                  {names[i] || 'Track ' + (i + 1)}
                  {mode === 'one' && <span className="dim small">{Math.round(Math.max(0.05, (settings.mixer[i] || { vol: 1 }).vol) * 100)}%</span>}
                </label>
              ))}
            </div>
          </section>
          <section>
            <h3>Size</h3>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="dim small">
              {size === 'original' ? 'H.264 at high quality, picture size unchanged.' : 'Re-encoded to land under the limit; the picture is made smaller if a long clip needs it.'}
            </div>
          </section>
          {error && <div className="error-text">{error}</div>}
          {busy && (
            <div className="storage-bar" title={Math.round(frac * 100) + '%'}>
              <div className="sb-fill" style={{ width: Math.round(frac * 100) + '%' }} />
            </div>
          )}
          {busy && retry && <div className="dim small">A little over the limit — squeezing it down once more…</div>}
          <div className="row-btns">
            <button className="btn primary" disabled={busy || !ok} onClick={go}>
              {busy ? 'Exporting… ' + Math.round(frac * 100) + '%' : 'Export…'}
            </button>
            <button className="btn" onClick={cancel}>{busy ? 'Stop' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
