import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useTrackColors } from '../state/store.js'
import { fmtDuration, fmtTime } from '../lib/time.js'
import { LABEL, TYPES, MARKER_COLORS } from '../lib/beats.js'
import { useBeatColor } from './NotesPanel.jsx'
import * as T from '../lib/editTools.js'
import { bus } from '../lib/hooks.js'
import { hasWave, setWave } from '../lib/speech.js'
import { parseWaveform } from './Timeline.jsx'

// Speech detection needs each recording's waveform in memory. Load any the
// section uses that aren't yet (don't rely on the timeline having done it).
// Returns how many are still loading.
function useEnsureWaves(clipsInSection) {
  const all = useStore((s) => s.clips)
  const keys = [...new Set((clipsInSection || []).map((c) => c.key))]
  const [pending, setPending] = useState(() => keys.filter((k) => !hasWave(k)).length)
  useEffect(() => {
    let dead = false
    const need = keys.filter((k) => !hasWave(k))
    setPending(need.length)
    need.forEach((k) => {
      const clip = all.find((c) => c.key === k)
      if (!clip) return setPending((n) => n - 1)
      window.footage.getWaveform(clip).then((u8) => {
        const w = parseWaveform(u8)
        if (w) setWave(k, w)
        if (!dead) setPending((n) => n - 1)
      })
    })
    return () => { dead = true }
  }, [keys.join('|'), all.length])
  return pending
}

function Dialog({ title, onClose, children, foot }) {
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tool-dialog">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="td-body">{children}</div>
        <div className="td-foot">{foot}</div>
      </div>
    </div>
  )
}

// Seconds input that commits on blur / Enter (never mid-typing).
function Secs({ value, onChange, min = 0, max = 60, step = 0.25 }) {
  return (
    <span className="td-secs">
      <input
        key={value}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onBlur={(e) => { const v = Math.max(min, Math.min(max, Number(e.target.value))); if (isFinite(v) && v !== value) onChange(v); else e.target.value = value }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      s
    </span>
  )
}

function Scope({ scope, setScope, selCount }) {
  return (
    <div className="td-row">
      <span className="td-label">Apply to</span>
      <div className="seg td-seg">
        <button className={scope === 'section' ? 'on' : ''} onClick={() => setScope('section')}>Whole section</button>
        <button className={scope === 'selected' ? 'on' : ''} disabled={!selCount} onClick={() => setScope('selected')}>Selected clips{selCount ? ` (${selCount})` : ''}</button>
      </div>
    </div>
  )
}

function Preview({ plan, extra }) {
  if (!plan) return null
  return (
    <div className="td-preview">
      <b>{fmtDuration(plan.before)}</b> → <b>{fmtDuration(plan.after)}</b>
      <span className="dim"> · removes {fmtDuration(plan.removed)} · {plan.clipsBefore} → {plan.clipsAfter} clips</span>
      {extra}
    </div>
  )
}

// One edit (one undo step): the new cut, with timeline markers following
// their moments; optionally into a new section instead.
function applyPlan(plan, asNew, nameSuffix) {
  const st = useStore.getState()
  const sec = st.currentSection()
  if (!sec || !plan) return
  const markers = T.remapMarkers(sec.clips, plan.clips, sec.markers || [])
  if (asNew) {
    st.createSection(sec.name + ' — ' + nameSuffix)
    st.applySection({ clips: plan.clips, markers })
  } else {
    st.applySection({ clips: plan.clips, markers })
  }
  st.closeModal()
  st.showToast(`Removed ${fmtDuration(plan.removed)} — Ctrl+Z to undo`)
}

// ---- Remove silence ----
export function RemoveSilenceDialog() {
  const sec = useStore((s) => s.currentSection())
  const selCount = useStore((s) => s.editSel.length)
  const trackNames = useStore((s) => s.settings.trackNames)
  const colors = useTrackColors()
  const saved = useStore((s) => s.settings.removeSilence) || {}
  const skip = useStore((s) => s.settings.speechSkip) || []
  const sens = useStore((s) => s.settings.speechSensitivity ?? 0.5)
  const clips = useStore((s) => s.clips)
  const loadingWaves = useEnsureWaves(sec && sec.clips)
  const [scope, setScope] = useState(selCount ? 'selected' : 'section')
  const [opts, setOpts] = useState({ padBefore: 0.25, padAfter: 0.4, minSilence: 1, tracks: null, asNew: false, ...saved })
  const set = (p) => setOpts((o) => ({ ...o, ...p }))
  const tracksUsed = opts.tracks || skip.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
  const nTracks = Math.max(1, ...(sec ? sec.clips : []).map((c) => ((clips.find((x) => x.key === c.key) || {}).probe?.audio || []).length))
  const plan = useMemo(() => {
    if (!sec) return null
    const st = useStore.getState()
    return T.planRemoveSilence(st, sec.clips, { ids: scope === 'selected' ? new Set(st.editSel) : null, tracks: tracksUsed, padBefore: opts.padBefore, padAfter: opts.padAfter, minSilence: opts.minSilence, sens })
  }, [sec, scope, opts, tracksUsed.join(), sens, loadingWaves])
  const close = () => useStore.getState().closeModal()
  const apply = () => {
    useStore.getState().updateSettings({ removeSilence: { padBefore: opts.padBefore, padAfter: opts.padAfter, minSilence: opts.minSilence, tracks: opts.tracks, asNew: opts.asNew } })
    applyPlan(plan, opts.asNew, 'no silence')
  }
  return (
    <Dialog
      title="Remove silence"
      onClose={close}
      foot={
        <>
          <label className="check"><input type="checkbox" checked={opts.asNew} onChange={(e) => set({ asNew: e.target.checked })} /> Put the result in a new section</label>
          <span className="grow" />
          <button className="btn small ghost" onClick={close}>Cancel</button>
          <button className="btn small accent" disabled={loadingWaves > 0 || !plan || plan.removed < 0.05} onClick={apply}>{loadingWaves > 0 ? 'Reading the audio…' : 'Remove ' + (plan ? fmtDuration(plan.removed) : '')}</button>
        </>
      }
    >
      <p className="dim small td-intro">Cuts out the stretches where nobody on the ticked tracks is talking. One step — Ctrl+Z brings it all back.</p>
      <Scope scope={scope} setScope={setScope} selCount={selCount} />
      <div className="td-row">
        <span className="td-label">Listen to</span>
        <div className="td-chips">
          {Array.from({ length: nTracks }, (_, i) => (
            <button key={i} className={'tx-chip' + (tracksUsed.includes(i) ? ' on' : '')} style={{ '--c': colors[i] }} onClick={() => set({ tracks: tracksUsed.includes(i) ? tracksUsed.filter((x) => x !== i) : [...tracksUsed, i].sort() })}>
              <span className="tx-box">{tracksUsed.includes(i) ? '✓' : ''}</span>
              {trackNames[i]}
            </button>
          ))}
        </div>
      </div>
      <div className="td-row">
        <span className="td-label">Padding</span>
        <span>before talking <Secs value={opts.padBefore} max={5} step={0.05} onChange={(v) => set({ padBefore: v })} /></span>
        <span>after <Secs value={opts.padAfter} max={5} step={0.05} onChange={(v) => set({ padAfter: v })} /></span>
      </div>
      <div className="td-row">
        <span className="td-label">Only cut pauses</span>
        <span>longer than <Secs value={opts.minSilence} min={0.2} max={30} step={0.1} onChange={(v) => set({ minSilence: v })} /></span>
        <span className="dim small">(shorter pauses stay, so talk still breathes)</span>
      </div>
      <div className="td-row">
        <span className="td-label">Sensitivity</span>
        <input type="range" min="0" max="1" step="0.05" value={sens} onChange={(e) => useStore.getState().updateSettings({ speechSensitivity: Number(e.target.value) })} />
        <span className="dim small">{Math.round(sens * 100)}% — higher catches quieter talking</span>
      </div>
      <Preview plan={plan} extra={plan && plan.missing ? <div className="dim small">{plan.missing} clip{plan.missing === 1 ? "'s" : "s'"} recording is still being prepared — left as is</div> : null} />
    </Dialog>
  )
}

// ---- Cut around markers / beats ----
export function CutAroundDialog() {
  const sec = useStore((s) => s.currentSection())
  const selCount = useStore((s) => s.editSel.length)
  const reviews = useStore((s) => s.reviews)
  const beatColor = useBeatColor()
  const saved = useStore((s) => s.settings.cutAround) || {}
  const [scope, setScope] = useState(selCount ? 'selected' : 'section')
  const [opts, setOpts] = useState({ colors: Object.keys(MARKER_COLORS), types: [], timeline: true, before: 5, after: 3, asNew: false, ...saved })
  const set = (p) => setOpts((o) => ({ ...o, ...p }))
  const counts = useMemo(() => (sec ? T.markerCounts(useStore.getState(), sec.clips, sec.markers) : { colors: {}, types: {}, timeline: {} }), [sec, reviews])
  const plan = useMemo(() => {
    if (!sec) return null
    const st = useStore.getState()
    return T.planCutAround(st, sec.clips, sec.markers, { ids: scope === 'selected' ? new Set(st.editSel) : null, colors: new Set(opts.colors), types: new Set(opts.types), timeline: opts.timeline, before: opts.before, after: opts.after })
  }, [sec, scope, opts, reviews])
  const toggle = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
  const close = () => useStore.getState().closeModal()
  const apply = () => {
    useStore.getState().updateSettings({ cutAround: { colors: opts.colors, types: opts.types, timeline: opts.timeline, before: opts.before, after: opts.after, asNew: opts.asNew } })
    applyPlan(plan, opts.asNew, 'highlights')
  }
  const nothing = plan && !plan.hits
  return (
    <Dialog
      title="Cut around markers"
      onClose={close}
      foot={
        <>
          <label className="check"><input type="checkbox" checked={opts.asNew} onChange={(e) => set({ asNew: e.target.checked })} /> Put the result in a new section</label>
          <span className="grow" />
          <button className="btn small ghost" onClick={close}>Cancel</button>
          <button className="btn small accent" disabled={!plan || nothing} onClick={apply}>Cut</button>
        </>
      }
    >
      <p className="dim small td-intro">Keeps only the moments around the markers / beats you pick — with padding before and after each — and cuts the rest. Overlapping moments join up. One step — Ctrl+Z brings it back.</p>
      <Scope scope={scope} setScope={setScope} selCount={selCount} />
      <div className="td-row top">
        <span className="td-label">Markers</span>
        <div className="td-chips">
          {Object.entries(MARKER_COLORS).map(([k, c]) => {
            const n = (counts.colors[k] || 0) + (opts.timeline ? counts.timeline[k] || 0 : 0)
            return (
              <button key={k} className={'tx-chip' + (opts.colors.includes(k) ? ' on' : '') + (n ? '' : ' silent')} style={{ '--c': c.hex }} onClick={() => set({ colors: toggle(opts.colors, k) })}>
                <span className="tx-box">{opts.colors.includes(k) ? '✓' : ''}</span>
                {c.label} <span className="dim">{n}</span>
              </button>
            )
          })}
          <label className="check td-inline"><input type="checkbox" checked={opts.timeline} onChange={(e) => set({ timeline: e.target.checked })} /> include timeline markers</label>
        </div>
      </div>
      <div className="td-row top">
        <span className="td-label">Beats &amp; notes</span>
        <div className="td-chips">
          {TYPES.map((k) => (
            <button key={k} className={'tx-chip' + (opts.types.includes(k) ? ' on' : '') + (counts.types[k] ? '' : ' silent')} style={{ '--c': beatColor(k) }} onClick={() => set({ types: toggle(opts.types, k) })}>
              <span className="tx-box">{opts.types.includes(k) ? '✓' : ''}</span>
              {LABEL[k]} <span className="dim">{counts.types[k] || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="td-row">
        <span className="td-label">Padding</span>
        <span>before <Secs value={opts.before} max={120} step={0.5} onChange={(v) => set({ before: v })} /></span>
        <span>after <Secs value={opts.after} max={120} step={0.5} onChange={(v) => set({ after: v })} /></span>
        <span className="dim small">(range beats keep their whole range)</span>
      </div>
      {nothing ? <div className="td-preview dim">Nothing picked is in {scope === 'selected' ? 'the selected clips' : 'this section'} yet.</div> : <Preview plan={plan} extra={plan ? <span className="dim"> · {plan.hits} moment{plan.hits === 1 ? '' : 's'}</span> : null} />}
    </Dialog>
  )
}

// ---- Export options (which markers go to Premiere) ----
export function ExportSectionDialog({ onExport }) {
  const sec = useStore((s) => s.currentSection())
  const reviews = useStore((s) => s.reviews)
  const beatColor = useBeatColor()
  const saved = useStore((s) => s.settings.exportMarkers) || {}
  const [opts, setOpts] = useState({ timeline: true, colors: Object.keys(MARKER_COLORS), types: [...TYPES], ...saved })
  const set = (p) => setOpts((o) => ({ ...o, ...p }))
  const counts = useMemo(() => (sec ? T.markerCounts(useStore.getState(), sec.clips, sec.markers) : { colors: {}, types: {}, timeline: {} }), [sec, reviews])
  const toggle = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
  const close = () => useStore.getState().closeModal()
  const go = () => {
    useStore.getState().updateSettings({ exportMarkers: opts })
    close()
    onExport(opts)
  }
  const tl = Object.values(counts.timeline).reduce((a, b) => a + b, 0)
  return (
    <Dialog
      title="Export to Premiere"
      onClose={close}
      foot={
        <>
          <span className="grow" />
          <button className="btn small ghost" onClick={close}>Cancel</button>
          <button className="btn small accent" onClick={go}>Export…</button>
        </>
      }
    >
      <p className="dim small td-intro">The section becomes one Premiere sequence, cut exactly like here, with your clip colours. Choose which markers come with it — they'll sit on the sequence at the right moments.</p>
      <div className="td-row">
        <span className="td-label">Timeline markers</span>
        <label className="check"><input type="checkbox" checked={opts.timeline} onChange={(e) => set({ timeline: e.target.checked })} /> Include ({tl})</label>
      </div>
      <div className="td-row top">
        <span className="td-label">Recording markers</span>
        <div className="td-chips">
          {Object.entries(MARKER_COLORS).map(([k, c]) => (
            <button key={k} className={'tx-chip' + (opts.colors.includes(k) ? ' on' : '') + (counts.colors[k] ? '' : ' silent')} style={{ '--c': c.hex }} onClick={() => set({ colors: toggle(opts.colors, k) })}>
              <span className="tx-box">{opts.colors.includes(k) ? '✓' : ''}</span>
              {c.label} <span className="dim">{counts.colors[k] || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="td-row top">
        <span className="td-label">Beats &amp; notes</span>
        <div className="td-chips">
          {TYPES.map((k) => (
            <button key={k} className={'tx-chip' + (opts.types.includes(k) ? ' on' : '') + (counts.types[k] ? '' : ' silent')} style={{ '--c': beatColor(k) }} onClick={() => set({ types: toggle(opts.types, k) })}>
              <span className="tx-box">{opts.types.includes(k) ? '✓' : ''}</span>
              {LABEL[k]} <span className="dim">{counts.types[k] || 0}</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

// ---- the Tools ▾ menu in the Edit transport ----
export function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(null)
  const ref = useRef(null)
  const hasClips = useStore((s) => { const x = s.currentSection(); return !!(x && x.clips.length) })
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const pick = (m) => { setOpen(false); useStore.getState().openModal(m) }
  return (
    <div className="speed" ref={ref}>
      <button className="btn small ghost" disabled={!hasClips} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 }); setOpen(!open) }} title="Automatic cuts">Tools ▾</button>
      {open && (
        <div className="menu tools-menu" style={{ position: 'fixed', ...at }}>
          <button onClick={() => pick('removeSilence')}><span>Remove silence…</span><span className="dim small">cut the quiet parts</span></button>
          <button onClick={() => pick('cutAround')}><span>Cut around markers…</span><span className="dim small">keep just the moments</span></button>
          <div className="menu-sep" />
          <button onClick={() => pick('exportSection')}><span>Export to Premiere…</span><span className="dim small">Ctrl+E</span></button>
        </div>
      )}
    </div>
  )
}
