// Layout for working with the viewer window on another screen:
//   Hide player — the video area goes (the controls stay); the timeline
//     takes the room. The panel then runs full height.
//   Full-height panel — Notes / Transcript as a column from top to bottom,
//     beside the player and the timeline.
// Both are settings, shared by Review and Edit.
import React from 'react'
import { useStore } from '../state/store.js'

export function PlayerHideButton() {
  const hidden = useStore((s) => !!s.settings.playerHidden)
  return (
    <button
      className={'t-btn layout-btn' + (hidden ? ' on' : '')}
      onClick={() => useStore.getState().updateSettings({ playerHidden: !hidden })}
      title={hidden ? 'Show the player here again' : 'Hide the player here (e.g. while it\u2019s in the viewer window) — more room for the timeline'}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="1.5" y="3" width="13" height="9" rx="1.2" />
        {hidden ? <path d="M5 7.5h6" /> : <path d="M2 14.5l12-13" />}
      </svg>
    </button>
  )
}

export function PanelFullButton() {
  const full = useStore((s) => !!s.settings.panelFull)
  const forced = useStore((s) => !!s.settings.playerHidden)
  return (
    <button
      className={'icon-btn small layout-btn' + (full || forced ? ' on' : '')}
      disabled={forced}
      onClick={() => useStore.getState().updateSettings({ panelFull: !full })}
      title={forced ? 'Full height while the player is hidden' : full ? 'Back to sitting beside the player' : 'Run this panel the full height, beside the timeline too'}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.2" />
        <path d="M10 1.5v13" />
        {!full && !forced && <path d="M1.5 9h8.5" />}
      </svg>
    </button>
  )
}

// Panel beside everything (a grid column), or inside the top half.
export const usePanelOutside = () => useStore((s) => !!s.settings.panelFull || !!s.settings.playerHidden)
