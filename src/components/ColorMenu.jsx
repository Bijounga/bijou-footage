import React, { useEffect, useRef } from 'react'
import { useStore } from '../state/store.js'
import { MARKER_COLORS } from '../lib/beats.js'

// Right-click color picker for markers. Opened from a marker on the
// timeline or in the notes list (recolors that marker), or from the Marker
// button (sets the color for new markers). Either way the picked color is
// what the next markers you drop will use.
export default function ColorMenu() {
  const menu = useStore((s) => s.colorMenu)
  const markerColor = useStore((s) => s.settings.markerColor || 'yellow')
  const reviews = useStore((s) => s.reviews)
  const ref = useRef(null)

  useEffect(() => {
    if (!menu) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) useStore.getState().closeColorMenu() }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); useStore.getState().closeColorMenu() } }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [menu])

  if (!menu) return null
  const note = menu.noteId && menu.clipKey && reviews[menu.clipKey] ? reviews[menu.clipKey].notes.find((n) => n.id === menu.noteId) : null
  const current = note ? note.color || 'yellow' : markerColor
  // Keep it on screen.
  const left = Math.min(menu.x, window.innerWidth - 176)
  const top = Math.min(menu.y, window.innerHeight - 120)

  function pick(color) {
    const st = useStore.getState()
    if (note) st.setMarkerColor(note.id, color, menu.clipKey)
    else st.updateSettings({ markerColor: color })
    st.closeColorMenu()
  }

  return (
    <div className="color-menu" ref={ref} style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <div className="color-menu-title">{note ? 'Marker color' : 'Color for new markers'}</div>
      <div className="color-menu-grid">
        {Object.entries(MARKER_COLORS).map(([k, c]) => (
          <button key={k} className={'mk-swatch' + (current === k ? ' on' : '')} style={{ '--c': c.hex }} title={c.label} onClick={() => pick(k)} />
        ))}
      </div>
      {note && <div className="color-menu-hint">New markers will use this color too</div>}
    </div>
  )
}
