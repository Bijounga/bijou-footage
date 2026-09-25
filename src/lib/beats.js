// Same beat vocabulary as the Beat Notes Premiere panel, so footage beats
// and edit beats mean the same thing once they reach the BijouDocs map.
export const TYPES = ['SETUP', 'AND_THEN', 'BECAUSE', 'BUT', 'THEREFORE', 'NOTE']
export const LABEL = { SETUP: 'Setup', AND_THEN: 'And then', BECAUSE: 'Because', BUT: 'But', THEREFORE: 'Therefore', NOTE: 'Note', BREAK: 'Scene break', MARKER: 'Marker' }

// Markers: Premiere-style colored markers (for the Premiere export), not
// story beats. Same 8 colors as Premiere's marker palette.
export const MARKER_COLORS = {
  green: { label: 'Green', hex: '#5cc45f' },
  red: { label: 'Red', hex: '#e2483f' },
  purple: { label: 'Purple', hex: '#b15fd0' },
  orange: { label: 'Orange', hex: '#f08c2a' },
  yellow: { label: 'Yellow', hex: '#f2c230' },
  white: { label: 'White', hex: '#e8e8e8' },
  blue: { label: 'Blue', hex: '#4b8fe8' },
  cyan: { label: 'Cyan', hex: '#3fc8d8' }
}
export const DEFAULT_MARKER_COLOR = 'yellow'

// Color for any note: markers use their own color, beats the beat color.
export function noteHex(n, beatColors) {
  if (n.type === 'MARKER') return (MARKER_COLORS[n.color] || MARKER_COLORS[DEFAULT_MARKER_COLOR]).hex
  return (beatColors && beatColors[n.type]) || DEFAULT_COLORS[n.type] || '#888'
}
export const DEFAULT_COLORS = {
  SETUP: '#7fbf7f',
  AND_THEN: '#6b6b6b',
  BECAUSE: '#a374db',
  BUT: '#d99a2b',
  THEREFORE: '#4a90d9',
  NOTE: '#8a8d99',
  BREAK: '#4a4d57'
}

// Beat Notes' rule: after a break (or at the start) you're setting up;
// otherwise alternate But / Therefore to keep the story's causal chain going.
export function pickDefaultType(preceding) {
  const beats = preceding.filter((b) => b.type !== 'NOTE' && b.type !== 'MARKER')
  const prev = beats[beats.length - 1]
  if (!prev || prev.type === 'BREAK') return 'SETUP'
  let lastBreak = -1
  beats.forEach((b, i) => { if (b.type === 'BREAK') lastBreak = i })
  const since = beats.slice(lastBreak + 1)
  const buts = since.filter((b) => b.type === 'BUT').length
  const thers = since.filter((b) => b.type === 'THEREFORE').length
  return buts <= thers ? 'BUT' : 'THEREFORE'
}

export function cycleType(type, dir = 1) {
  const i = TYPES.indexOf(type)
  return TYPES[(i + dir + TYPES.length) % TYPES.length]
}

export function newId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
