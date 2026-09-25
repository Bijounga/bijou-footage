// h:mm:ss (or m:ss under an hour). `frac` adds tenths for the precise
// readouts next to the player.
export function fmtTime(t, frac = false) {
  if (!isFinite(t) || t < 0) t = 0
  const whole = Math.floor(t)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const base = (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0')
  return frac ? base + '.' + Math.floor((t - whole) * 10) : base
}

export function fmtDuration(t) {
  if (!t) return '—'
  const h = Math.floor(t / 3600)
  const m = Math.round((t % 3600) / 60)
  if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm'
  if (t < 60) return Math.round(t) + 's'
  return m + 'm'
}

export function fmtHours(t) {
  const h = t / 3600
  return h >= 10 ? Math.round(h) + 'h' : h.toFixed(1) + 'h'
}

// Parses "1:02:03", "62:03", "3723", "1h2m3s" into seconds; null if invalid.
export function parseTime(str) {
  const s = String(str).trim()
  if (!s) return null
  const hms = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i.exec(s)
  if (hms && (hms[1] || hms[2] || hms[3])) return (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0)
  const parts = s.split(':')
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

// Merges [start, end] intervals (sorted or not) into a minimal sorted list.
export function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export function rangesTotal(ranges) {
  return ranges.reduce((a, r) => a + (r[1] - r[0]), 0)
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export const fmtDay = (ms) => DAY.format(new Date(ms))
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
export const fmtShortDay = (ms) => SHORT_DAY.format(new Date(ms)) // "Apr 10"
export const fmtClock = (ms) => CLOCK.format(new Date(ms))
