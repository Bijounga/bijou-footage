import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { ACTIONS as REVIEW_ACTIONS, ACTION_BY_ID as REVIEW_BY_ID, bindingsFor as reviewBindingsFor, comboFromEvent, prettyCombo, shortCombo } from '../lib/keybinds.js'
import { EDIT_ACTIONS, EDIT_BY_ID, editBindingsFor, MUTE_ID } from '../lib/editKeys.js'
import { SOURCE_KEY_IDS } from '../lib/voSrcKeys.js'
import { VO_ACTIONS, VO_BY_ID, voBindingsFor } from '../lib/voKeys.js'
import { MARKER_COLORS } from '../lib/beats.js'

// The per-colour marker actions (marker_red, e.marker_red…) show as ONE row,
// each key wearing its colour's dot; + asks which colour first.
const COLOR_ID = /^(e\.)?marker_([a-z]+)$/
// Sections, in this order (anything else after them, A–Z).
const SECTION_ORDER = ['Playback', 'Notes', 'Edit', 'Record', 'Timeline', 'Audio', 'Framing', 'Voiceover', 'Tools', 'View', 'Library']
const NO_FOLDS = []

// The shortcuts window: every action in sections (Playback, Notes, …) you can
// fold away, A–Z inside each; searchable, each rebindable.
// Click a key to change it (then press the new one), ＋ to add another,
// × to remove one. Taking a key another action uses asks first.
export default function KeybindsModal() {
  // Review, Edit and Voiceover have their own keys; opens on the workspace you're in.
  const [mode, setMode] = useState(() => { const w = useStore.getState().settings.workspace; return w === 'edit' || w === 'voiceover' ? w : 'review' })
  const edit = mode === 'edit'
  const voice = mode === 'voiceover'
  const overrideKey = voice ? 'voKeybinds' : edit ? 'editKeybinds' : 'keybinds'
  const overrides = useStore((s) => s.settings[overrideKey]) || {}
  const ACTIONS = voice ? VO_ACTIONS : edit ? EDIT_ACTIONS : REVIEW_ACTIONS
  const ACTION_BY_ID = voice ? VO_BY_ID : edit ? EDIT_BY_ID : REVIEW_BY_ID
  const bindingsFor = voice ? voBindingsFor : edit ? editBindingsFor : reviewBindingsFor
  const setKeybinds = useStore((s) => (voice ? s.setVoKeybinds : edit ? s.setEditKeybinds : s.setKeybinds))
  const resetKeybind = useStore((s) => (voice ? s.resetVoKeybind : edit ? s.resetEditKeybind : s.resetKeybind))
  const resetAllKeybinds = useStore((s) => (voice ? s.resetAllVoKeybinds : edit ? s.resetAllEditKeybinds : s.resetAllKeybinds))
  const closeModal = useStore((s) => s.closeModal)
  const [q, setQ] = useState('')
  const [capture, setCapture] = useState(null) // {id, index} — index null = adding
  const [conflict, setConflict] = useState(null) // {id, index, combo, otherId}
  const searchRef = useRef(null)

  const text = q.trim().toLowerCase()
  const keyMatch = (keys) => keys.some((k) => k.toLowerCase().includes(text) || prettyCombo(k).toLowerCase().includes(text))
  const rows = useMemo(() => {
    const out = ACTIONS.filter((a) => !COLOR_ID.test(a.id) && !MUTE_ID.test(a.id))
      .map((a) => ({ a, keys: bindingsFor(a.id, overrides) }))
      .filter(({ a, keys }) => !text || a.label.toLowerCase().includes(text) || a.cat.toLowerCase().includes(text) || keyMatch(keys))
    // the coloured markers, gathered into one row
    const colors = ACTIONS.filter((a) => COLOR_ID.test(a.id)).map((a) => {
      const color = a.id.match(COLOR_ID)[2]
      return { a, color, hex: (MARKER_COLORS[color] || {}).hex || '#999', keys: bindingsFor(a.id, overrides) }
    })
    if (colors.length) {
      const label = 'Quick marker — in a colour'
      const hay = (label + ' coloured colored color quick marker ' + colors.map((c) => c.color + ' ' + c.a.label).join(' ')).toLowerCase()
      const hit = !text || hay.includes(text) || colors.some((c) => keyMatch(c.keys))
      if (hit) out.push({ a: { id: '__colors', label, cat: colors[0].a.cat }, colors, keys: [] })
    }
    // the per-layer mutes (Edit), gathered into one row too
    const mutes = ACTIONS.filter((a) => MUTE_ID.test(a.id)).map((a) => ({ a, track: +a.id.match(MUTE_ID)[1] - 1, keys: bindingsFor(a.id, overrides) }))
    if (mutes.length) {
      const label = 'Mute audio layers on a clip'
      const hay = (label + ' mute unmute layer layers track tracks audio voiceover silence talking').toLowerCase()
      if (!text || hay.includes(text) || mutes.some((m) => keyMatch(m.keys))) out.push({ a: { id: '__mute', label, cat: mutes[0].a.cat }, mutes, keys: [] })
    }
    // a mouse binding: which modifier + click drops a strip clip at the playhead
    if (edit) {
      const label = 'Drop a voiceover clip at the playhead'
      const hay = (label + ' click modifier ctrl shift alt voiceover strip place put').toLowerCase()
      if (!text || hay.includes(text)) out.push({ a: { id: '__voDrop', label, cat: 'Voiceover' }, voDrop: true, keys: [] })
    }
    return out.sort((x, y) => x.a.label.localeCompare(y.a.label, undefined, { numeric: true }))
  }, [q, overrides, mode])
  const sections = useMemo(() => {
    const by = new Map()
    for (const r of rows) {
      if (!by.has(r.a.cat)) by.set(r.a.cat, [])
      by.get(r.a.cat).push(r)
    }
    const rank = (c) => { const i = SECTION_ORDER.indexOf(c); return i < 0 ? 99 : i }
    return [...by.entries()].sort((x, y) => rank(x[0]) - rank(y[0]) || x[0].localeCompare(y[0])).map(([cat, list]) => ({ cat, list }))
  }, [rows])
  // folded sections, remembered for Review / Edit / Voiceover separately
  const folded = useStore((s) => (s.settings.kbFolded && s.settings.kbFolded[mode]) || NO_FOLDS)
  const toggleFold = (cat) => {
    const st = useStore.getState()
    const all = { ...(st.settings.kbFolded || {}) }
    const cur = all[mode] || []
    all[mode] = cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]
    st.updateSettings({ kbFolded: all })
  }
  const [picking, setPicking] = useState(false) // choosing the colour for a new coloured-marker key
  const [mutePick, setMutePick] = useState(null) // the layers for a new mute key, while choosing them
  const voDropMod = useStore((s) => s.settings.voDropMod) || 'ctrl'
  const trackNames = useStore((s) => s.settings.trackNames) || []
  const layerName = (t) => trackNames[t] || 'Layer ' + (t + 1)
  const muteIds = () => ACTIONS.filter((a) => MUTE_ID.test(a.id)).map((a) => a.id)
  const labelOf = (id, tracks) => (id === '__mute' ? 'Mute ' + (tracks || []).map(layerName).join(' + ') : ACTION_BY_ID[id].label)

  function owner(combo, exceptId) {
    // a mute key belongs to the whole mute row: re-setting it isn't a clash
    const skip = (id) => id === exceptId || (exceptId === '__mute' && MUTE_ID.test(id))
    const hit = ACTIONS.find((a) => !skip(a.id) && bindingsFor(a.id, overrides).includes(combo))
    return hit ? hit.id : null
  }

  function apply(id, index, combo, stealFrom, tracks) {
    const now = () => useStore.getState().settings[overrideKey]
    // taking a key off a mute takes it off every layer it muted
    for (const f of stealFrom ? (MUTE_ID.test(stealFrom) ? muteIds() : [stealFrom]) : []) {
      const ks = bindingsFor(f, now())
      if (ks.includes(combo)) setKeybinds(f, ks.filter((k) => k !== combo))
    }
    if (id === '__mute') {
      // the key mutes exactly these layers (it may have muted others before)
      for (const mid of muteIds()) {
        const ks = bindingsFor(mid, now())
        const want = tracks.includes(+mid.match(MUTE_ID)[1] - 1)
        if (want && !ks.includes(combo)) setKeybinds(mid, [...ks, combo])
        else if (!want && ks.includes(combo)) setKeybinds(mid, ks.filter((k) => k !== combo))
      }
      return
    }
    const keys = [...bindingsFor(id, useStore.getState().settings[overrideKey])]
    if (index == null) { if (!keys.includes(combo)) keys.push(combo) } else keys[index] = combo
    setKeybinds(id, [...new Set(keys)])
  }

  // Listening for the new key: capture phase so nothing else reacts to it.
  useEffect(() => {
    if (!capture) return
    useStore.setState({ capturingKey: true })
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) { setCapture(null); return }
      const combo = comboFromEvent(e)
      if (!combo) return // bare modifier — wait for the real key
      const other = owner(combo, capture.id)
      if (other) setConflict({ ...capture, combo, otherId: other })
      else apply(capture.id, capture.index, combo, null, capture.tracks)
      setCapture(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setTimeout(() => useStore.setState({ capturingKey: false }), 0)
    }
  }, [capture])

  useEffect(() => { searchRef.current && searchRef.current.focus() }, [])

  const customized = Object.keys(overrides).length

  function renderRow({ a, keys }) {
            const isCustom = Array.isArray(overrides[a.id])
            return (
              <div key={a.id} className={'kb-row' + (capture && capture.id === a.id ? ' capturing' : '')}>
                <span className="kb-label">
                  {a.label}
                  {a.global && <span className="dim small"> · works while typing</span>}
                  {edit && SOURCE_KEY_IDS.has(a.id) && <span className="dim small" title="Click the Voiceover strip above the timeline and this key drives its own player instead of the cut"> · also the Voiceover strip</span>}
                </span>
                <span className="kb-cat">{a.cat}</span>
                <span className="kb-keys">
                  {keys.map((k, i) =>
                    capture && capture.id === a.id && capture.index === i ? (
                      <span key={i} className="kb-chip listening">Press a key… (Esc cancels)</span>
                    ) : (
                      <span key={i} className="kb-chip" onClick={() => { setConflict(null); setCapture({ id: a.id, index: i }) }} title="Click, then press the new key">
                        {prettyCombo(k)}
                        <button className="kb-x" onClick={(e) => { e.stopPropagation(); setKeybinds(a.id, keys.filter((_, j) => j !== i)) }} title="Remove this key">×</button>
                      </span>
                    )
                  )}
                  {capture && capture.id === a.id && capture.index == null ? (
                    <span className="kb-chip listening">Press a key… (Esc cancels)</span>
                  ) : (
                    <button className="kb-add" onClick={() => { setConflict(null); setCapture({ id: a.id, index: null }) }} title="Add a key">＋</button>
                  )}
                  {!keys.length && !(capture && capture.id === a.id) && <span className="dim small">no key</span>}
                </span>
                <span className="kb-reset">
                  {isCustom && <button className="icon-btn small" onClick={() => resetKeybind(a.id)} title={'Reset to default: ' + (a.keys.map(prettyCombo).join(', ') || 'no key')}>↺</button>}
                </span>
              </div>
            )
  }

  // Modifier + click on a clip in the Voiceover strip: pick the modifier.
  function renderVoDrop({ a }) {
    return (
      <div key="__voDrop" className="kb-row">
        <span className="kb-label">
          {a.label}
          <span className="dim small"> · hold it and click a clip in the Voiceover strip (double-click works too)</span>
        </span>
        <span className="kb-cat">{a.cat}</span>
        <span className="kb-keys">
          <span className="seg kb-mod">
            {Object.entries({ ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' }).map(([m, label]) => (
              <button key={m} className={voDropMod === m ? 'on' : ''} onClick={() => useStore.getState().updateSettings({ voDropMod: m })}>
                {label} + click
              </button>
            ))}
          </span>
        </span>
        <span className="kb-reset" />
      </div>
    )
  }

  // The layer mutes: one row; each key shows the layers it toggles, + picks
  // the layers first (one or several), then listens for the key.
  function renderMutes({ a, mutes }) {
    const byKey = new Map()
    for (const m of mutes) for (const k of m.keys) {
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(m.track)
    }
    const capturing = !!capture && capture.id === '__mute'
    const removeKey = (k) => { for (const mid of muteIds()) { const ks = bindingsFor(mid, useStore.getState().settings[overrideKey]); if (ks.includes(k)) setKeybinds(mid, ks.filter((x) => x !== k)) } }
    return (
      <div key="__mute" className={'kb-row kb-colors' + (capturing ? ' capturing' : '')}>
        <span className="kb-label">
          {a.label}
          <span className="dim small"> · the selected clips (or the one at the playhead); press again to unmute</span>
        </span>
        <span className="kb-cat">{a.cat}</span>
        <span className="kb-keys">
          {[...byKey].map(([k, tracks]) => (
            <span key={k} className="kb-chip" title={'Mutes ' + tracks.map(layerName).join(' + ')}>
              {prettyCombo(k)}
              <span className="kb-layers">{tracks.map((t) => t + 1).join(' + ')}</span>
              <button className="kb-x" onClick={() => removeKey(k)} title="Remove this key">×</button>
            </span>
          ))}
          {capturing ? (
            <span className="kb-chip listening">Press a key for {capture.tracks.map(layerName).join(' + ')}… (Esc cancels)</span>
          ) : mutePick ? (
            <span className="kb-colors-pick">
              <span className="dim small">Layers:</span>
              {mutes.map((m) => (
                <button key={m.track} className={'kb-layer-btn' + (mutePick.includes(m.track) ? ' on' : '')} title={layerName(m.track)} onClick={() => setMutePick((p) => (p.includes(m.track) ? p.filter((x) => x !== m.track) : [...p, m.track].sort((x, y) => x - y)))}>
                  {m.track + 1}{trackNames[m.track] ? ' ' + trackNames[m.track] : ''}
                </button>
              ))}
              <button className="btn small primary" disabled={!mutePick.length} onClick={() => { setConflict(null); setCapture({ id: '__mute', index: null, tracks: mutePick }); setMutePick(null) }}>Set key</button>
              <button className="kb-x" onClick={() => setMutePick(null)} title="Cancel">×</button>
            </span>
          ) : (
            <button className="kb-add" onClick={() => setMutePick([])} title="Add a key — pick the layers it mutes first">＋</button>
          )}
          {!byKey.size && !capturing && !mutePick && <span className="dim small">no keys yet</span>}
        </span>
        <span className="kb-reset" />
      </div>
    )
  }

  // The coloured markers: one row, a colour dot on every key; + picks the colour first.
  function renderColors({ a, colors }) {
    const capturing = !!capture && colors.some((c) => c.a.id === capture.id)
    const pickedHex = capturing ? (colors.find((c) => c.a.id === capture.id) || {}).hex : null
    return (
      <div key="__colors" className={'kb-row kb-colors' + (capturing ? ' capturing' : '')}>
        <span className="kb-label">
          {a.label}
          <span className="dim small"> · each key drops its own colour</span>
        </span>
        <span className="kb-cat">{a.cat}</span>
        <span className="kb-keys">
          {colors.flatMap((c) =>
            c.keys.map((k, i) =>
              capture && capture.id === c.a.id && capture.index === i ? (
                <span key={c.color + i} className="kb-chip listening">Press a key…</span>
              ) : (
                <span key={c.color + i} className="kb-chip" onClick={() => { setConflict(null); setCapture({ id: c.a.id, index: i }) }} title={c.a.label + ' — click, then press the new key'}>
                  <i className="kb-dot" style={{ background: c.hex }} />
                  {prettyCombo(k)}
                  <button className="kb-x" onClick={(e) => { e.stopPropagation(); setKeybinds(c.a.id, c.keys.filter((_, j) => j !== i)) }} title="Remove this key">×</button>
                </span>
              )
            )
          )}
          {capturing && capture.index == null ? (
            <span className="kb-chip listening"><i className="kb-dot" style={{ background: pickedHex }} />Press a key… (Esc cancels)</span>
          ) : picking ? (
            <span className="kb-colors-pick">
              <span className="dim small">Colour:</span>
              {colors.map((c) => (
                <button key={c.color} className="kb-dot-btn" style={{ background: c.hex }} title={MARKER_COLORS[c.color] ? MARKER_COLORS[c.color].label : c.color} onClick={() => { setPicking(false); setConflict(null); setCapture({ id: c.a.id, index: null }) }} />
              ))}
              <button className="kb-x" onClick={() => setPicking(false)} title="Cancel">×</button>
            </span>
          ) : (
            <button className="kb-add" onClick={() => setPicking(true)} title="Add a key — pick its colour first">＋</button>
          )}
          {!colors.some((c) => c.keys.length) && !capturing && !picking && <span className="dim small">no keys yet</span>}
        </span>
        <span className="kb-reset" />
      </div>
    )
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !capture && closeModal()}>
      <div className="modal wide kb-modal">
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={closeModal}>×</button>
        </div>
        <div className="kb-top">
          <div className="seg kb-mode">
            <button className={mode === 'review' ? 'on' : ''} onClick={() => { setMode('review'); setCapture(null); setConflict(null) }}>Review keys</button>
            <button className={edit ? 'on' : ''} onClick={() => { setMode('edit'); setCapture(null); setConflict(null) }}>Edit keys</button>
            <button className={voice ? 'on' : ''} onClick={() => { setMode('voiceover'); setCapture(null); setConflict(null) }}>Voiceover keys</button>
          </div>
          <input ref={searchRef} className="lib-search" placeholder="Search actions or keys… (e.g. marker, speed, Shift+M)" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="dim small">Click a key to change it · ＋ adds another · × removes</span>
        </div>
        {conflict && (
          <div className="kb-conflict">
            <b>{prettyCombo(conflict.combo)}</b> is already used by <b>{labelOf(conflict.otherId)}</b>.
            <button className="btn small primary" onClick={() => { apply(conflict.id, conflict.index, conflict.combo, conflict.otherId, conflict.tracks); setConflict(null) }}>
              Use it for “{labelOf(conflict.id, conflict.tracks)}” instead
            </button>
            <button className="btn small ghost" onClick={() => setConflict(null)}>Cancel</button>
          </div>
        )}
        <div className="kb-list">
          {sections.map(({ cat, list }) => {
            const shut = !text && folded.includes(cat)
            const changed = list.filter(({ a, colors, mutes }) => { const sub = colors || mutes; return sub ? sub.some((c) => Array.isArray(overrides[c.a.id])) : Array.isArray(overrides[a.id]) }).length
            return (
              <div key={cat} className={'kb-section' + (shut ? ' shut' : '')}>
                <button className="kb-sec-head" onClick={() => toggleFold(cat)} title={shut ? 'Show these' : 'Fold these away'}>
                  <span className="kb-chev">▾</span>
                  <b>{cat}</b>
                  <span className="dim small">{list.length}{changed ? ' · ' + changed + ' changed' : ''}</span>
                </button>
                {!shut && list.map((row) => (row.colors ? renderColors(row) : row.mutes ? renderMutes(row) : row.voDrop ? renderVoDrop(row) : renderRow(row)))}
              </div>
            )
          })}
          {!rows.length && <div className="lib-empty dim">No actions match “{q}”.</div>}
        </div>
        <div className="kb-foot">
          <span className="dim small">{voice ? 'Voiceover' : edit ? 'Edit mode' : 'Review mode'} · {ACTIONS.length} actions · {customized ? `${customized} customized` : 'all default'}</span>
          <button className="btn small ghost" disabled={!customized} onClick={() => { if (window.confirm('Reset every ' + (voice ? 'Voiceover' : edit ? 'Edit' : 'Review') + ' shortcut to its default?')) resetAllKeybinds() }}>Reset all to defaults</button>
        </div>
      </div>
    </div>
  )
}

// The current key for an action, short form, for button hints ("⇧M").
export function useKeyHint(id) {
  const overrides = useStore((s) => s.settings.keybinds)
  const keys = reviewBindingsFor(id, overrides)
  return keys.length ? shortCombo(keys[0]) : ''
}
