// Small line icons for the transport bars. They replace the ⏮ ⏭ characters,
// which some systems draw as coloured emoji (a blue square) instead of text.
import React from 'react'

const base = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true }

// |◀ — back to the start / the previous one
export const IconSkipStart = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3" width="1.8" height="10" rx="0.6" />
    <path d="M13 3.2v9.6a.6.6 0 0 1-.95.49L5.3 8.5a.6.6 0 0 1 0-.99l6.75-4.8A.6.6 0 0 1 13 3.2z" />
  </svg>
)
// ▶| — on to the end / the next one
export const IconSkipEnd = (p) => (
  <svg {...base} {...p}>
    <rect x="11.7" y="3" width="1.8" height="10" rx="0.6" />
    <path d="M3 3.2v9.6a.6.6 0 0 0 .95.49l6.75-4.79a.6.6 0 0 0 0-.99L3.95 2.71A.6.6 0 0 0 3 3.2z" />
  </svg>
)
// speaker, for the volume slider
export const IconVolume = ({ level = 1, ...p }) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2.5 6v4h2.7L9 13V3L5.2 6z" fill="currentColor" stroke="none" />
    {level > 0 && <path d="M11 5.8a3.2 3.2 0 0 1 0 4.4" />}
    {level > 0.6 && <path d="M12.6 4a5.6 5.6 0 0 1 0 8" />}
    {level === 0 && <path d="M11 6l3 4M14 6l-3 4" />}
  </svg>
)
