// Voice enhance — the switch and the strength slider, and the glue that keeps
// them going. See lib/voEnhance.js (what the players read) and
// electron/main/voEnhance.js (how a take is enhanced).
//
// The setting is per project (settings.voEnhanceBy[projectId] = {on, amount}):
// the enhanced copies live in that project's folder.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../state/store.js'
import { useVo } from '../state/voStore.js'
import * as E from '../lib/voEnhance.js'
import { setEnhance, toggleEnhance } from '../lib/voEnhanceSetting.js'

export function useEnhanceSetting() {
  const id = useStore((s) => s.settings.currentProjectId)
  const v = useStore((s) => (s.settings.currentProjectId && s.settings.voEnhanceBy && s.settings.voEnhanceBy[s.settings.currentProjectId]) || null)
  return { id, on: !!(v && v.on), amount: v && v.amount != null ? v.amount : 1 }
}

// Every take the voiceover is using (the Voiceover tab's clips and Edit's lanes).
function takesInUse() {
  const out = new Set()
  for (const s of useVo.getState().sections || []) for (const c of s.clips || []) if (c.take) out.add(c.take)
  for (const s of useStore.getState().sections || []) for (const v of s.vo || []) if (v.take) out.add(v.take)
  return [...out]
}

// Mounted where voiceover plays: hands the setting to the players, finds the
// enhanced copies that exist, and (while it's on) makes the missing ones in the
// background — including for takes recorded or put in later.
export function VoEnhanceBridge() {
  const { on, amount } = useEnhanceSetting()
  const folder = useStore((s) => { const p = s.currentProject(); return (p && p.folder) || null })
  useEffect(() => { E.setFolder(folder) }, [folder])
  useEffect(() => { E.setConfig({ on, amount }) }, [on, amount])
  useEffect(() => {
    if (!folder) return
    let timer = 0
    const run = async () => {
      const takes = takesInUse()
      await E.refresh(takes)
      if (on) E.request(takes.filter((t) => !E.isReady(t)))
    }
    const soon = () => { clearTimeout(timer); timer = setTimeout(run, 500) }
    soon()
    const unVo = useVo.subscribe((s, prev) => { if (s.sections !== prev.sections) soon() })
    const unSt = useStore.subscribe((s, prev) => { if (s.sections !== prev.sections) soon() })
    return () => { clearTimeout(timer); unVo(); unSt() }
  }, [folder, on])
  return null
}

const TIP = 'Voice clean-up — takes the noise out of your voiceover and lightly polishes it: a clearer voice, quieter pauses, same loudness. Your recordings aren’t changed; this plays a cleaned copy, which also goes to Premiere. Strength blends between the recording as it was (0%) and the full effect (100%).'

// The switch + slider + what it's doing right now.
export function EnhanceControl({ stacked }) {
  const { on, amount } = useEnhanceSetting()
  const snap = useSyncExternalStore(E.subscribe, E.getSnapshot)
  const pct = Math.round(amount * 100)
  const busy = on && snap.left > 0
  return (
    <div className={'vo-enh' + (on ? ' on' : '') + (stacked ? ' stacked' : '')}>
      <button className={'vo-enh-btn' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleEnhance(!on)} title={TIP + (on ? ' (On — click to switch off)' : ' (Off — click to switch on)')}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor" /><path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" /></svg>
        Clean up
      </button>
      <input className="vo-enh-range" type="range" min="0" max="100" step="1" value={pct} onChange={(e) => setEnhance({ amount: Number(e.target.value) / 100 })} onDoubleClick={() => setEnhance({ amount: 1 })} title={'Strength — ' + pct + '%. 0% is your recording as it was, 100% the full enhancement. Double-click for 100%.'} style={{ '--p': pct + '%' }} />
      <span className="vo-enh-pct">{pct}%</span>
      {busy && (
        <span className="vo-enh-status" title={'Making the cleaned copies of your takes — ' + snap.left + (snap.left === 1 ? ' take' : ' takes') + ' to go. Each take is ready to hear as soon as it’s done.'}>
          <i className="vo-enh-spin" />
          {snap.left === 1 && snap.take ? Math.round(snap.fraction * 100) + '%' : snap.left + ' left'}
        </span>
      )}
      {on && !busy && snap.error && <span className="vo-enh-err" title={snap.error}>⚠ {snap.error.length > 40 ? 'Couldn’t clean up' : snap.error}</span>}
    </div>
  )
}

// Edit's voiceover track header: a button that opens the switch and slider.
export function EnhanceHeadButton() {
  const { on } = useEnhanceSetting()
  const snap = useSyncExternalStore(E.subscribe, E.getSnapshot)
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
    setAt(at ? null : { left: r.left, top: r.bottom + 6 })
  }
  return (
    <>
      <button className={'th-btn th-enh' + (on ? ' on-a' : '')} onClick={open} title={TIP} aria-label="Voice clean-up">
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor" /><path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" /></svg>
        {on && snap.left > 0 && <i className="vo-enh-dot" />}
      </button>
      {at && (
        <div className="vo-menu vo-enh-pop" ref={ref} style={{ left: Math.max(8, Math.min(at.left, window.innerWidth - 320)), top: at.top }}>
          <div className="dim small vo-menu-title">Voice clean-up — noise out, voice polished. Your recording isn’t changed.</div>
          <EnhanceControl stacked />
        </div>
      )}
    </>
  )
}
