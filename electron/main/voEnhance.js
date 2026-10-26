// Voice enhance: an "enhanced" copy of each voiceover take, made with ffmpeg —
// the original recording is never touched.
//
//   <project>/voiceover/audio/<take>.wav        the recording, as made
//   <project>/voiceover/audio/<take>.enh.wav    its enhanced copy (same format)
//   <project>/voiceover/audio/<take>.enh.pk2    its waveform peaks
//   <project>/voiceover/audio/<take>.enh.json   {v, gainDb, …}: the version it
//                                               was made with, and how much
//                                               louder it is than the original
//
// The chain, in order: rumble filter → RNNoise (a small neural network that
// takes noise out of speech) → a light expander for the pauses → a touch of EQ
// (less mud, more presence and air) → de-esser → compressor → loudness to
// -16 LUFS (the spoken-word norm) → a safety limiter. Delays the filters add
// (RNNoise 480 samples, the limiter 239) are taken back out, so the enhanced
// copy lines up with the original to the sample — that's what lets the player
// blend the two with a slider.
//
// The player mixes original and enhanced live (strength = the blend), and the
// Premiere export points at the enhanced file (or bakes the blend, below).
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'
import { spawn } from 'child_process'
import * as vo from './voiceover.js'

export const VERSION = 2 // bump to re-make every enhanced copy
const TARGET = -16 // LUFS the measuring pass aims for (the render itself matches each take's own loudness)
const MODEL = 'rnnoise-bd.rnnn' // "beguiling-drafter": recorded voice, keeps breaths and laughs

const resDir = () => (app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'))
const audioPath = (folder, take, ext) => path.join(vo.audioDir(folder), take + ext)
export const enhFile = (folder, take) => audioPath(folder, take, '.enh.wav')
const metaFile = (folder, take) => audioPath(folder, take, '.enh.json')

// ---- what's ready ----
// {take: {gainDb}} for the takes that have a current enhanced copy.
export function status(folder, takes) {
  const out = {}
  for (const take of takes || []) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile(folder, take), 'utf8'))
      if (meta.v === VERSION && fs.existsSync(enhFile(folder, take))) out[take] = { gainDb: meta.gainDb || 0 }
    } catch { /* not made (yet) */ }
  }
  return out
}

// ---- the filter chain ----
function chains(first, fallback) {
  // (afftdn, without RNNoise, is 1200 samples late)
  const denoise = fallback ? ['afftdn=nr=40:nf=-30:tn=1:tr=1', 'apad=pad_len=1200', 'atrim=start_sample=1200', 'asetpts=PTS-STARTPTS'] : ['arnndn=m=' + MODEL, 'apad=pad_len=480', 'atrim=start_sample=480', 'asetpts=PTS-STARTPTS']
  return [
    ...(first ? ['aresample=48000'] : []),
    'highpass=f=80:p=2',
    ...denoise,
    'equalizer=f=250:t=q:w=1:g=-1', // a little less mud
    'equalizer=f=3000:t=q:w=1.0:g=1', // a little presence
    'deesser=i=0.4:m=0.4:f=0.5',
    'acompressor=threshold=-28dB:ratio=1.6:attack=30:release=300:knee=8:makeup=1' // a light touch, no pumping
  ].join(',')
}
// loudnorm runs at 192 kHz inside ffmpeg, so back to 48 kHz before the limiter
// (whose look-ahead delay is then 239 samples to take back out).
const POST = 'aresample=48000,alimiter=limit=0.95:attack=5:release=60:level=disabled,apad=pad_len=239,atrim=start_sample=239,asetpts=PTS-STARTPTS'

// ---- running ffmpeg ----
let current = null // the child process of the job under way
function run(ffmpeg, args, { onData } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { cwd: resDir(), windowsHide: true })
    current = p
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* not allowed: fine */ }
    let err = ''
    p.stderr.on('data', (c) => { if (err.length < 200000) err += c })
    if (onData) p.stdout.on('data', onData)
    else p.stdout.resume()
    p.on('error', reject)
    p.on('close', (code) => {
      if (current === p) current = null
      resolve({ code, err })
    })
  })
}
// loudnorm's measurement of what `af` makes of the file
async function measure(ffmpeg, src, af, target = TARGET) {
  const r = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', src, '-af', af + `,loudnorm=I=${target}:TP=-1.5:LRA=20:print_format=json`, '-f', 'null', '-'])
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(r.err)
  if (r.code !== 0 || !m) return { failed: r.err }
  try { return JSON.parse(m[0]) } catch { return { failed: r.err } }
}

// ---- making one ----
async function renderTake(folder, take, ffmpeg, onProgress, fallback = false) {
  const src = audioPath(folder, take, '.wav')
  const info = vo.wavInfo(src)
  if (!info) throw new Error('The recording is missing')
  const first = info.sampleRate !== 48000
  const pre = chains(first, fallback)

  // how loud the original is, and what the chain makes of it
  const dry = await measure(ffmpeg, src, first ? 'aresample=48000' : 'anull')
  if (dry.failed) throw new Error('Could not read the recording')
  const dryI = parseFloat(dry.input_i)
  let norm = ''
  let gainDb = 0
  if (Number.isFinite(dryI) && dryI > -70) {
    const m = await measure(ffmpeg, src, pre, dryI)
    if (m.failed) {
      if (!fallback && /arnndn/i.test(m.failed)) return renderTake(folder, take, ffmpeg, onProgress, true) // an ffmpeg without RNNoise
      throw new Error('Could not enhance the recording')
    }
    norm = `,loudnorm=I=${dryI}:TP=-1.5:LRA=20:measured_I=${m.input_i}:measured_LRA=${m.input_lra}:measured_TP=${m.input_tp}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    gainDb = 0 // same loudness as the recording: what changes is the sound, not the volume
  }

  // render to the enhanced WAV (our own 44-byte header, like the recordings)
  const out = enhFile(folder, take)
  const tmp = out + '.tmp'
  try { fs.rmSync(tmp, { force: true }) } catch { /* nothing */ }
  const fd = fs.openSync(tmp, 'w')
  let bytes = 0
  try {
    fs.writeSync(fd, vo.wavHeader(48000, 1, 0))
    const expect = Math.max(1, info.dur * 48000 * 4)
    const r = await run(ffmpeg, ['-v', 'error', '-nostats', '-i', src, '-af', pre + norm + ',' + POST + `,atrim=end_sample=${Math.round(info.dur * 48000)}`, '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], {
      onData: (c) => {
        fs.writeSync(fd, c)
        bytes += c.length
        onProgress(Math.min(0.99, bytes / expect))
      }
    })
    if (r.code !== 0 || !bytes) throw new Error(r.code === null ? 'Cancelled' : 'Could not enhance the recording') // (a killed process has no exit code)
    fs.writeSync(fd, vo.wavHeader(48000, 1, bytes), 0, 44, 0)
  } catch (e) {
    try { fs.closeSync(fd) } catch { /* closed */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* nothing */ }
    throw e
  }
  fs.closeSync(fd)
  fs.renameSync(tmp, out)
  try { fs.rmSync(out.replace(/\.wav$/, '.pk2'), { force: true }) } catch { /* nothing */ }
  vo.readPeaks(out) // builds <take>.enh.pk2
  fs.writeFileSync(metaFile(folder, take), JSON.stringify({ v: VERSION, model: fallback ? 'afftdn' : 'rnnoise-bd', gainDb, dryLufs: Number.isFinite(dryI) ? dryI : null, created: Date.now() }))
  return { gainDb }
}

// ---- the queue (one at a time, in the background) ----
const queue = [] // {folder, take}
let running = null
let emitFn = () => {}
let ffmpegPath = null
let stopped = false
export const setEmit = (fn) => { emitFn = fn || (() => {}) }

const left = () => queue.length + (running ? 1 : 0)
async function pump() {
  if (running || stopped) return
  const job = queue.shift()
  if (!job) return emitFn({ type: 'idle' })
  running = job
  emitFn({ type: 'start', folder: job.folder, take: job.take, left: left() })
  try {
    const r = await renderTake(job.folder, job.take, ffmpegPath, (fraction) => emitFn({ type: 'progress', folder: job.folder, take: job.take, fraction, left: left() }))
    emitFn({ type: 'done', folder: job.folder, take: job.take, gainDb: r.gainDb, left: left() - 1 })
  } catch (e) {
    emitFn({ type: 'error', folder: job.folder, take: job.take, message: String((e && e.message) || e), left: left() - 1 })
  }
  running = null
  pump()
}

// Make what's missing (takes that already have a current copy are skipped).
export function request(folder, takes, ffmpeg) {
  if (!ffmpeg) {
    emitFn({ type: 'error', folder, take: null, message: 'ffmpeg isn’t installed — Settings → Tools', left: 0 })
    return 0
  }
  ffmpegPath = ffmpeg
  const have = status(folder, takes)
  let n = 0
  for (const take of takes || []) {
    if (have[take] || (running && running.folder === folder && running.take === take) || queue.some((j) => j.folder === folder && j.take === take)) continue
    if (!fs.existsSync(audioPath(folder, take, '.wav'))) continue
    queue.push({ folder, take })
    n++
  }
  stopped = false
  if (n) emitFn({ type: 'queued', left: left() })
  pump()
  return n
}
export function cancel(folder) {
  for (let i = queue.length - 1; i >= 0; i--) if (!folder || queue[i].folder === folder) queue.splice(i, 1)
  if (current && running && (!folder || running.folder === folder)) { try { current.kill() } catch { /* gone */ } }
  emitFn({ type: 'idle' })
}
export function shutdown() {
  stopped = true
  queue.length = 0
  if (current) { try { current.kill() } catch { /* gone */ } }
}

// ---- the blend, for the export ----
// The player's mix, exactly: strength a, and the enhanced copy being g dB
// louder than the original. Loudness slides smoothly in dB with the slider
// (noise and tone cross-fade): the original at (1-a)·10^(a·g/20), the enhanced
// at a·10^(-(1-a)·g/20).
export function blendGains(a, g) {
  return { dry: (1 - a) * Math.pow(10, (a * g) / 20), wet: a * Math.pow(10, (-(1 - a) * g) / 20) }
}
const readF32 = (file) => {
  const b = fs.readFileSync(file)
  const body = b.subarray(44)
  return new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length - (body.length % 4)))
}
// The file the Premiere export should use for this take at strength `amount`:
// the enhanced copy at 100%, a baked blend in between, null (use the original)
// when there's nothing to use.
export function pathForExport(folder, take, amount) {
  const st = status(folder, [take])[take]
  if (!st || amount <= 0.005) return null
  const wetFile = enhFile(folder, take)
  if (amount >= 0.995) return wetFile
  const pct = Math.round(amount * 100)
  const out = audioPath(folder, take, '.mix' + pct + '.wav')
  try {
    if (fs.statSync(out).mtimeMs >= fs.statSync(wetFile).mtimeMs) return out
  } catch { /* bake it */ }
  const dryFile = audioPath(folder, take, '.wav')
  const dInfo = vo.wavInfo(dryFile)
  if (!dInfo || dInfo.sampleRate !== 48000 || dInfo.channels !== 1) return wetFile // can't line up: the enhanced copy
  const d = readF32(dryFile)
  const w = readF32(wetFile)
  const n = Math.min(d.length, w.length)
  const g = blendGains(amount, st.gainDb)
  const mix = new Float32Array(n)
  for (let i = 0; i < n; i++) mix[i] = d[i] * g.dry + w[i] * g.wet
  const tmp = out + '.tmp'
  fs.writeFileSync(tmp, Buffer.concat([vo.wavHeader(48000, 1, n * 4), Buffer.from(mix.buffer)]))
  fs.renameSync(tmp, out)
  return out
}
