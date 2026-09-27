// Opens / closes the viewer window (lib/viewer.js) — lit while it's open.
import React, { useEffect, useState } from 'react'
import { bus } from '../lib/hooks.js'
import { toggleViewer, viewerOpen } from '../lib/viewer.js'

export default function ViewerButton({ className = 't-btn' }) {
  const [open, setOpen] = useState(viewerOpen())
  useEffect(() => bus.on('viewer', setOpen), [])
  return (
    <button
      className={className + ' viewer-btn' + (open ? ' on' : '')}
      onClick={() => toggleViewer()}
      title={open ? 'Close the viewer window (Ctrl+Shift+V)' : 'Viewer window — put the picture on another monitor, as big as you like (Ctrl+Shift+V)'}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="1.5" y="4" width="9" height="7.5" rx="1.2" />
        <path d="M6 2h7.3a1.2 1.2 0 0 1 1.2 1.2V9" />
      </svg>
    </button>
  )
}
