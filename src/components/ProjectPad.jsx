// Project notes: a free-form pad (text, checklists, headings, bullets) for
// the whole project, the same in Review and Edit. Each line is a block:
//
//   Enter             new block of the same kind (splits at the caret)
//   Shift+Enter       line break inside the block
//   Backspace at 0    un-checkbox / un-heading, then joins with the one above
//   Tab / Shift+Tab   indent / outdent
//   Ctrl+Enter        tick / untick (makes it a checkbox first)
//   ↑ / ↓             move between blocks at the first / last line
//   typing "[] " "# " "- " at the start turns a text block into that kind
//
// Typing is kept locally and saved a moment later, so the rest of the app
// doesn't re-render per keystroke.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'

const EMPTY = []
const KINDS = [
  { kind: 'check', icon: '☐', label: 'Checkbox', hint: '[] ' },
  { kind: 'head', icon: 'H', label: 'Heading', hint: '# ' },
  { kind: 'bullet', icon: '•', label: 'Bullet', hint: '- ' },
  { kind: 'text', icon: '¶', label: 'Text', hint: '' },
]
const newId = () => 'b' + Math.random().toString(36).slice(2, 10)
const block = (kind = 'text', text = '', indent = 0) => ({ id: newId(), kind, text, done: false, indent })

// Markdown-ish shortcuts typed at the start of a text block.
const SHORTCUTS = [
  [/^\[[xX]\]\s/, { kind: 'check', done: true }],
  [/^\[ ?\]\s/, { kind: 'check', done: false }],
  [/^#\s/, { kind: 'head' }],
  [/^[-*]\s/, { kind: 'bullet' }],
]

export default function ProjectPad() {
  const key = useStore((s) => s.settings.currentProjectId || 'all')
  const projectName = useStore((s) => {
    const p = s.settings.currentProjectId && s.projects.find((x) => x.id === s.settings.currentProjectId)
    return p ? p.name : null
  })
  const items = useStore((s) => s.pads[key] || EMPTY)
  const hideDone = useStore((s) => !!s.settings.padHideDone)
  const canUndo = useStore((s) => s.padUndo.some((u) => u.key === key))
  const [focus, setFocus] = useState(null) // {id, pos, n}
  const [dragging, setDragging] = useState(null) // {id, over}
  const listRef = useRef(null)

  // Unsaved typing, per block. Anything structural flushes it first.
  const drafts = useRef(new Map())
  const timer = useRef(null)
  const keyRef = useRef(key)
  function latest() {
    const k = keyRef.current
    const base = useStore.getState().pads[k] || EMPTY
    if (!drafts.current.size) return base
    const d = drafts.current
    const out = base.map((it) => (d.has(it.id) && d.get(it.id) !== it.text ? { ...it, text: d.get(it.id) } : it))
    d.clear()
    return out
  }
  function flush() {
    clearTimeout(timer.current)
    if (!drafts.current.size) return
    const next = latest()
    useStore.getState().setPad(keyRef.current, next)
  }
  function commit(next, undoable = false) {
    clearTimeout(timer.current)
    drafts.current.clear()
    useStore.getState().setPad(keyRef.current, next, undoable)
  }
  function typed(id, text) {
    drafts.current.set(id, text)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }
  // Switching project (or leaving the tab) saves what was being typed.
  useEffect(() => {
    keyRef.current = key
    return () => flush()
  }, [key])

  const focusOn = (id, pos) => setFocus({ id, pos, n: Date.now() })

  // ---- block operations (all work on the latest text) ----
  function update(id, patch, undoable = false) {
    const cur = latest()
    commit(cur.map((it) => (it.id === id ? { ...it, ...patch } : it)), undoable)
  }
  function split(id, at) {
    const cur = latest()
    const i = cur.findIndex((it) => it.id === id)
    if (i < 0) return
    const it = cur[i]
    // Enter on an empty list line leaves the list, like every editor.
    if (!it.text && it.kind !== 'text') {
      commit(cur.map((x) => (x.id === id ? { ...x, kind: 'text', done: false } : x)))
      focusOn(id, 0)
      return
    }
    const kind = it.kind === 'head' ? 'text' : it.kind
    const nb = block(kind, it.text.slice(at), it.indent || 0)
    const next = cur.slice()
    next[i] = { ...it, text: it.text.slice(0, at) }
    next.splice(i + 1, 0, nb)
    commit(next)
    focusOn(nb.id, 0)
  }
  function backspaceAtStart(id) {
    const cur = latest()
    const i = cur.findIndex((it) => it.id === id)
    const it = cur[i]
    if (it.kind !== 'text') return update(id, { kind: 'text', done: false })
    if (it.indent) return update(id, { indent: it.indent - 1 })
    if (i === 0) return
    const prev = visibleBefore(cur, i)
    if (!prev) return
    const pos = prev.text.length
    const next = cur.filter((x) => x.id !== id).map((x) => (x.id === prev.id ? { ...x, text: x.text + it.text } : x))
    commit(next, !!it.text)
    focusOn(prev.id, pos)
  }
  function deleteAtEnd(id) {
    const cur = latest()
    const i = cur.findIndex((it) => it.id === id)
    const nx = visibleAfter(cur, i)
    if (!nx) return
    const pos = cur[i].text.length
    commit(cur.filter((x) => x.id !== nx.id).map((x) => (x.id === id ? { ...x, text: x.text + nx.text } : x)), !!nx.text)
    focusOn(id, pos)
  }
  function remove(id) {
    const cur = latest()
    commit(cur.filter((x) => x.id !== id), true)
  }
  function indent(id, d) {
    const cur = latest()
    const it = cur.find((x) => x.id === id)
    if (!it) return
    const n = Math.max(0, Math.min(4, (it.indent || 0) + d))
    if (n !== (it.indent || 0)) commit(cur.map((x) => (x.id === id ? { ...x, indent: n } : x)))
  }
  function setKind(kind) {
    const el = document.activeElement
    const id = el && el.dataset && el.dataset.block
    const cur = latest()
    if (id && cur.some((x) => x.id === id)) {
      const pos = el.selectionStart
      commit(cur.map((x) => (x.id === id ? { ...x, kind: x.kind === kind && kind !== 'text' ? 'text' : kind, done: false } : x)))
      focusOn(id, pos)
      return
    }
    addAtEnd(kind)
  }
  function addAtEnd(kind = 'text') {
    const cur = latest()
    const last = cur[cur.length - 1]
    if (last && !last.text && last.kind === kind) return focusOn(last.id, 0)
    const nb = block(kind)
    commit([...cur, nb])
    focusOn(nb.id, 0)
  }
  function toggle(id) {
    const cur = latest()
    const it = cur.find((x) => x.id === id)
    if (!it) return
    if (it.kind !== 'check') update(id, { kind: 'check', done: false })
    else update(id, { done: !it.done })
  }
  function clearDone() {
    const cur = latest()
    const n = cur.filter((x) => x.kind === 'check' && x.done).length
    if (!n) return
    commit(cur.filter((x) => !(x.kind === 'check' && x.done)), true)
    useStore.getState().showToast(`Cleared ${n} done item${n === 1 ? '' : 's'} — ↶ brings them back`)
  }
  function undo() {
    flush()
    useStore.getState().undoPad(keyRef.current)
  }

  const shown = hideDone ? items.filter((it) => !(it.kind === 'check' && it.done)) : items
  const visibleBefore = (cur, i) => {
    for (let k = i - 1; k >= 0; k--) if (!(hideDone && cur[k].kind === 'check' && cur[k].done)) return cur[k]
    return null
  }
  const visibleAfter = (cur, i) => {
    for (let k = i + 1; k < cur.length; k++) if (!(hideDone && cur[k].kind === 'check' && cur[k].done)) return cur[k]
    return null
  }
  function move(id, dir) {
    const i = shown.findIndex((x) => x.id === id)
    const target = shown[i + dir]
    if (target) focusOn(target.id, dir > 0 ? 0 : target.text.length)
  }

  // ---- drag to reorder (by the handle) ----
  function dragDown(e, id) {
    if (e.button !== 0) return
    e.preventDefault()
    flush()
    let over = null
    const move = (ev) => {
      const rows = [...listRef.current.querySelectorAll('.pad-row')]
      over = rows.length
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) { over = k; break }
      }
      setDragging({ id, over })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('dragging-row')
      setDragging(null)
      if (over == null) return
      const cur = latest()
      const it = cur.find((x) => x.id === id)
      const beforeShown = shown[over] // drop above this one (undefined = at the end)
      if (!it || (beforeShown && beforeShown.id === id)) return
      const rest = cur.filter((x) => x.id !== id)
      const at = beforeShown ? rest.findIndex((x) => x.id === beforeShown.id) : rest.length
      rest.splice(at < 0 ? rest.length : at, 0, it)
      commit(rest, true)
    }
    document.body.classList.add('dragging-row')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const checks = items.filter((it) => it.kind === 'check')
  const done = checks.filter((it) => it.done).length

  return (
    <div className="pad">
      <div className="pad-bar">
        <div className="pad-kinds">
          {KINDS.map((k) => (
            <button key={k.kind} className={'pad-kind k-' + k.kind} onMouseDown={(e) => e.preventDefault()} onClick={() => setKind(k.kind)} title={`${k.label}${k.hint ? ` — or type "${k.hint.trim()}" at the start of a line` : ''}`}>
              {k.icon}
            </button>
          ))}
        </div>
        {checks.length > 0 && (
          <span className={'pad-progress' + (done === checks.length ? ' all' : '')} title={`${done} of ${checks.length} ticked`}>
            <span className="pad-progress-bar"><span style={{ width: (done / checks.length) * 100 + '%' }} /></span>
            {done}/{checks.length}
          </span>
        )}
        <div className="grow" />
        {done > 0 && (
          <>
            <button className={'link-btn' + (hideDone ? ' on' : '')} onClick={() => useStore.getState().updateSettings({ padHideDone: !hideDone })} title="Hide ticked items">
              {hideDone ? 'Show done' : 'Hide done'}
            </button>
            <button className="link-btn" onClick={clearDone} title="Remove every ticked item (↶ brings them back)">Clear done</button>
          </>
        )}
        {canUndo && <button className="icon-btn small" onClick={undo} title="Undo the last delete / move / clear">↶</button>}
      </div>
      <div className="pad-scope dim small">{projectName ? `For the whole project · ${projectName}` : 'General notes · no project open (each project has its own)'}</div>

      <div className="pad-list" ref={listRef}>
        {shown.map((it, i) => (
          <Block
            key={it.id}
            it={it}
            focus={focus && focus.id === it.id ? focus : null}
            dropAbove={dragging && dragging.over === i && dragging.id !== it.id}
            lifted={dragging && dragging.id === it.id}
            onType={(t) => typed(it.id, t)}
            onBlur={flush}
            onKind={(patch) => update(it.id, patch)}
            onSplit={(at) => split(it.id, at)}
            onBackspace={() => backspaceAtStart(it.id)}
            onDeleteEnd={() => deleteAtEnd(it.id)}
            onIndent={(d) => indent(it.id, d)}
            onToggle={() => toggle(it.id)}
            onRemove={() => remove(it.id)}
            onMove={(d) => move(it.id, d)}
            onDragDown={(e) => dragDown(e, it.id)}
          />
        ))}
        {dragging && dragging.over === shown.length && <div className="pad-drop end" />}
        {!items.length && (
          <div className="pad-empty">
            <p>Checklists, to-dos and ideas for the whole project — the same notes in Review and Edit.</p>
            <p className="dim small">Type <kbd>[]</kbd> for a checkbox, <kbd>#</kbd> a heading, <kbd>-</kbd> a bullet · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ticks · <kbd>Tab</kbd> indents</p>
            <div className="pad-empty-btns">
              <button className="btn" onClick={() => addAtEnd('check')}>☐ Start a checklist</button>
              <button className="btn ghost" onClick={() => addAtEnd('text')}>¶ Write a note</button>
            </div>
          </div>
        )}
        {items.length > 0 && (
          <div className="pad-fill" onMouseDown={(e) => { e.preventDefault(); const last = items[items.length - 1]; addAtEnd(last && last.kind === 'check' ? 'check' : 'text') }} title="Click to add a line" />
        )}
      </div>
    </div>
  )
}

function Block({ it, focus, dropAbove, lifted, onType, onBlur, onKind, onSplit, onBackspace, onDeleteEnd, onIndent, onToggle, onRemove, onMove, onDragDown }) {
  const [text, setText] = useState(it.text)
  const ref = useRef(null)
  // The saved text wins whenever it changes (typing only changes it by
  // being saved, when it's already what's in the box).
  useEffect(() => setText(it.text), [it.text])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [text, it.kind])
  useLayoutEffect(() => {
    if (!focus || !ref.current) return
    const el = ref.current
    el.focus()
    const p = Math.min(focus.pos ?? el.value.length, el.value.length)
    el.setSelectionRange(p, p)
  }, [focus])

  function change(e) {
    let v = e.target.value
    if (it.kind === 'text') {
      for (const [re, patch] of SHORTCUTS) {
        if (re.test(v)) {
          v = v.replace(re, '')
          setText(v)
          onType(v)
          onKind({ ...patch, text: v })
          return
        }
      }
    }
    setText(v)
    onType(v)
  }
  function keyDown(e) {
    const el = e.currentTarget
    const a = el.selectionStart
    const b = el.selectionEnd
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onToggle()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onType(el.value.slice(0, a) + el.value.slice(b))
      onSplit(a)
    } else if (e.key === 'Backspace' && a === 0 && b === 0) {
      e.preventDefault()
      onBackspace()
    } else if (e.key === 'Delete' && a === el.value.length && b === a) {
      e.preventDefault()
      onDeleteEnd()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onIndent(e.shiftKey ? -1 : 1)
    } else if (e.key === 'ArrowUp' && a === b && !el.value.slice(0, a).includes('\n')) {
      e.preventDefault()
      onMove(-1)
    } else if (e.key === 'ArrowDown' && a === b && !el.value.slice(a).includes('\n')) {
      e.preventDefault()
      onMove(1)
    } else if (e.key === 'Escape') {
      el.blur()
    }
  }

  const done = it.kind === 'check' && it.done
  return (
    <div className={'pad-row k-' + it.kind + (done ? ' done' : '') + (lifted ? ' lifted' : '')} style={{ paddingLeft: (it.indent || 0) * 18 }}>
      {dropAbove && <div className="pad-drop" />}
      <span className="pad-grip" onMouseDown={onDragDown} title="Drag to move">⋮⋮</span>
      {it.kind === 'check' && <input type="checkbox" className="pad-check" checked={!!it.done} onChange={onToggle} title="Tick (Ctrl+Enter)" />}
      {it.kind === 'bullet' && <span className="pad-dot">•</span>}
      <textarea
        ref={ref}
        rows={1}
        data-block={it.id}
        className="pad-text"
        value={text}
        spellCheck
        placeholder={it.kind === 'head' ? 'Heading' : it.kind === 'check' ? 'To do…' : ''}
        onChange={change}
        onKeyDown={keyDown}
        onBlur={onBlur}
      />
      <button className="pad-x" onClick={onRemove} tabIndex={-1} title="Delete this line (↶ brings it back)">×</button>
    </div>
  )
}
