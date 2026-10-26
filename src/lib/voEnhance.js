// Voice enhance, as the player and the waveforms see it (the rendering itself
// is electron/main/voEnhance.js). This module has no store in it — the players
// and the waveform cache import it — so it holds just: the setting for the
// open project ({on, amount}), which takes have an enhanced copy (and how many
// dB louder it is), and the background job's progress.
//
// Strength is a blend of the original and the enhanced copy. Loudness slides
// smoothly in dB with the slider while noise and tone cross-fade:
//   original × (1-a)·10^(a·g/20)   +   enhanced × a·10^(-(1-a)·g/20)
// (g = how much louder the enhanced copy is). 0% is the recording as it was,
// 100% the enhanced copy exactly.
const api = window.footage

const cfg = { on: false, amount: 1 }
const ready = new Map() // take id -> gainDb
let job = { take: null, fraction: 0, left: 0, error: null }
let folder = null
const subs = new Set()
const readySubs = new Set()
let snap = null

const make = () => ({ on: cfg.on, amount: cfg.amount, ready: ready.size, left: job.left, take: job.take, fraction: job.fraction, error: job.error })
const notify = () => {
  snap = make()
  subs.forEach((fn) => fn())
}
snap = make()

export const subscribe = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}
// useSyncExternalStore wants the same object until something changes
export const getSnapshot = () => snap
export const onReady = (fn) => {
  readySubs.add(fn)
  return () => readySubs.delete(fn)
}

export const config = () => cfg
export function setConfig(next) {
  const on = !!next.on
  const amount = Math.max(0, Math.min(1, next.amount == null ? 1 : next.amount))
  if (on === cfg.on && amount === cfg.amount) return
  cfg.on = on
  cfg.amount = amount
  notify()
}
export const isReady = (take) => ready.has(take)
export const gainDbOf = (take) => (ready.has(take) ? ready.get(take) : null)
// Is this take to be heard enhanced right now?
export const wanted = (take) => cfg.on && ready.has(take)

// The mix for a take with gain g at strength a: linear gains for original / enhanced.
export function blend(a, g) {
  return { dry: (1 - a) * Math.pow(10, (a * g) / 20), wet: a * Math.pow(10, (-(1 - a) * g) / 20) }
}
export const gainsFor = (take) => blend(cfg.on ? cfg.amount : 0, ready.get(take) || 0)

// The project's folder, and which takes have an enhanced copy now.
export async function setFolder(f) {
  if (f === folder) return
  folder = f
  ready.clear()
  job = { take: null, fraction: 0, left: 0, error: null }
  notify()
}
export async function refresh(takes) {
  if (!folder || !takes.length) return
  const st = await api.voEnhStatus(folder, takes).catch(() => ({}))
  let changed = false
  for (const t of Object.keys(st)) {
    if (ready.get(t) !== st[t].gainDb) {
      ready.set(t, st[t].gainDb)
      changed = true
      readySubs.forEach((fn) => fn(folder, t))
    }
  }
  if (changed) notify()
}
// Make what's missing (in the background).
export async function request(takes) {
  if (!folder || !takes.length) return 0
  job.error = null
  return api.voEnhRequest(folder, takes).catch(() => 0)
}
export const cancel = () => folder && api.voEnhCancel(folder)

if (api && api.onVoEnhance) {
  api.onVoEnhance((ev) => {
    if (ev.folder && folder && ev.folder !== folder) return
    if (ev.type === 'done') {
      ready.set(ev.take, ev.gainDb || 0)
      job = { take: null, fraction: 0, left: ev.left || 0, error: null }
      readySubs.forEach((fn) => fn(folder, ev.take))
    } else if (ev.type === 'start' || ev.type === 'progress') {
      job = { take: ev.take, fraction: ev.fraction || 0, left: ev.left || 0, error: null }
    } else if (ev.type === 'queued') job = { ...job, left: ev.left || job.left }
    else if (ev.type === 'idle') job = { take: null, fraction: 0, left: 0, error: job.error }
    else if (ev.type === 'error') job = { take: null, fraction: 0, left: ev.left || 0, error: ev.message || 'Could not enhance' }
    notify()
  })
}
if (typeof window !== 'undefined') window.__voEnhance = { cfg, ready, state: () => snap } // for tests (scripts/cdp.mjs)
