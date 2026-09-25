import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { ACTIONS as REVIEW_ACTIONS, ACTION_BY_ID as REVIEW_BY_ID, bindingsFor as reviewBindingsFor, comboFromEvent, prettyCombo, shortCombo } from '../lib/keybinds.js'
import { EDIT_ACTIONS, EDIT_BY_ID, editBindingsFor } from '../lib/editKeys.js'

// The shortcuts window: every action A–Z, searchable, each rebindable.
// Click a key to change it (then press the new one), ＋ to add another,
// × to remove one. Taking a key another action uses asks first.
export default function KeybindsModal() {
  // Review and Edit have their own keys; opens on the workspace you're in.
  const [mode, setMode] = useState(() => useStore.getState().settings.workspace === 'edit' ? 'edit' : 'review')
  const edit = mode === 'edit'
  const reviewOverrides = useStore((s) => s.settings.keybinds) || {}
  const editOverrides = useStore((s) => s.settings.editKeybinds) || {}
  const overrides = edit ? editOverrides : reviewOverrides
  const ACTIONS = edit ? EDIT_ACTIONS : REVIEW_ACTIONS
  const ACTION_BY_ID = edit ? EDIT_BY_ID : REVIEW_BY_ID
  const bindingsFor = edit ? editBindingsFor : reviewBindingsFor
  const setKeybinds = useStore((s) => (edit ? s.setEditKeybinds : s.setKeybinds))
  const resetKeybind = useStore((s) => (edit ? s.resetEditKeybind : s.resetKeybind))
  const resetAllKeybinds = useStore((s) => (edit ? s.resetAllEditKeybinds : s.resetAllKeybinds))
  const closeModal = useStore((s) => s.closeModal)
  const [q, setQ] = useState('')
  const [capture, setCapture] = useState(null) // {id, index} — index null = adding
  const [conflict, setConflict] = useState(null) // {id, index, combo, otherId}
  const searchRef = useRef(null)

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase()
    return ACTIONS.map((a) => ({ a, keys: bindingsFor(a.id, overrides) }))
      .filter(({ a, keys }) => !text || a.label.toLowerCase().includes(text) || a.cat.toLowerCase().includes(text) || keys.some((k) => k.toLowerCase().includes(text) || prettyCombo(k).toLowerCase().includes(text)))
      .sort((x, y) => x.a.label.localeCompare(y.a.label, undefined, { numeric: true }))
  }, [q, overrides, mode])

  function owner(combo, exceptId) {
    const hit = ACTIONS.find((a) => a.id !== exceptId && bindingsFor(a.id, overrides).includes(combo))
    return hit ? hit.id : null
  }

  function apply(id, index, combo, stealFrom) {
    if (stealFrom) setKeybinds(stealFrom, bindingsFor(stealFrom, overrides).filter((k) => k !== combo))
    const keys = [...bindingsFor(id, useStore.getState().settings[edit ? 'editKeybinds' : 'keybinds'])]
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
      else apply(capture.id, capture.index, combo)
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

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !capture && closeModal()}>
      <div className="modal wide kb-modal">
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={closeModal}>×</button>
        </div>
        <div className="kb-top">
          <div className="seg kb-mode">
            <button className={!edit ? 'on' : ''} onClick={() => { setMode('review'); setCapture(null); setConflict(null) }}>Review keys</button>
            <button className={edit ? 'on' : ''} onClick={() => { setMode('edit'); setCapture(null); setConflict(null) }}>Edit keys</button>
          </div>
          <input ref={searchRef} className="lib-search" placeholder="Search actions or keys… (e.g. marker, speed, Shift+M)" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="dim small">Click a key to change it · ＋ adds another · × removes</span>
        </div>
        {conflict && (
          <div className="kb-conflict">
            <b>{prettyCombo(conflict.combo)}</b> is already used by <b>{ACTION_BY_ID[conflict.otherId].label}</b>.
            <button className="btn small primary" onClick={() => { apply(conflict.id, conflict.index, conflict.combo, conflict.otherId); setConflict(null) }}>
              Use it for “{ACTION_BY_ID[conflict.id].label}” instead
            </button>
            <button className="btn small ghost" onClick={() => setConflict(null)}>Cancel</button>
          </div>
        )}
        <div className="kb-list">
          {rows.map(({ a, keys }) => {
            const isCustom = Array.isArray(overrides[a.id])
            return (
              <div key={a.id} className={'kb-row' + (capture && capture.id === a.id ? ' capturing' : '')}>
                <span className="kb-label">
                  {a.label}
                  {a.global && <span className="dim small"> · works while typing</span>}
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
          })}
          {!rows.length && <div className="lib-empty dim">No actions match “{q}”.</div>}
        </div>
        <div className="kb-foot">
          <span className="dim small">{edit ? 'Edit mode' : 'Review mode'} · {ACTIONS.length} actions · {customized ? `${customized} customized` : 'all default'}</span>
          <button className="btn small ghost" disabled={!customized} onClick={() => { if (window.confirm('Reset every ' + (edit ? 'Edit' : 'Review') + ' shortcut to its default?')) resetAllKeybinds() }}>Reset all to defaults</button>
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
