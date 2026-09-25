// Local transcription (faster-whisper large-v3-turbo — on the GPU with an
// NVIDIA card, else the CPU, e.g. on a Mac), one audio track at a time. The
// Python side lives in resources/whisper_worker.py and runs from its own
// venv in ~/.bijou-footage/whisper (paths.js), set up by Settings → Tools
// (setup.js). The worker stays alive between jobs so the model loads once, and
// quits after IDLE_MS with nothing to do so the VRAM is given back.
//
// Transcripts: <userData>/transcripts/<clip hash>-t<track>.json
//   {v, model, lang, segments: [[start, end, text, [[ws, we, word], ...]], ...]}
// They're never evicted — they took GPU time to make.
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { app } from 'electron'
import { hashFor, audioFiles, status as prepStatus } from './waveform.js'
import { WHISPER_HOME, VENV_PYTHON } from './paths.js'
import { whisperInstalled } from './setup.js'

const PYTHON = VENV_PYTHON
const MODELS = path.join(WHISPER_HOME, 'models')
const IDLE_MS = 5 * 60 * 1000

let dir = null
let ffmpegPath = null
let emit = () => {}
const queue = [] // [{clip, track}]
let running = null // {clip, track, done, duration}
let worker = null // {proc, ready, buf}
let idleTimer = null
let lang = 'en'

export function initTranscribe(userDataDir, onEvent) {
  dir = path.join(userDataDir, 'transcripts')
  fs.mkdirSync(dir, { recursive: true })
  emit = onEvent
}

export function setFfmpeg(p) {
  ffmpegPath = p
}

export function setLanguage(l) {
  lang = l || null
}

function workerScript() {
  return app.isPackaged ? path.join(process.resourcesPath, 'whisper_worker.py') : path.join(app.getAppPath(), 'resources', 'whisper_worker.py')
}

const fileFor = (clip, track) => path.join(dir, hashFor(clip) + '-t' + track + '.json')

export function installed() {
  return whisperInstalled()
}

// Which tracks of each clip have a transcript: {key: [track, ...]}
export function doneMap(clips) {
  const out = {}
  for (const c of clips) {
    const n = ((c.probe && c.probe.audio) || []).length
    const t = []
    for (let i = 0; i < n; i++) if (fs.existsSync(fileFor(c, i))) t.push(i)
    if (t.length) out[c.key] = t
  }
  return out
}

export async function read(clip, track) {
  try {
    return JSON.parse(await fs.promises.readFile(fileFor(clip, track), 'utf8'))
  } catch {
    return null
  }
}

export function remove(clip, track) {
  try { fs.unlinkSync(fileFor(clip, track)) } catch { /* already gone */ }
  index.delete(fileFor(clip, track))
}

export function queueState() {
  return {
    installed: installed(),
    running: running && { key: running.clip.key, track: running.track, done: running.done, duration: running.duration, loading: !worker || !worker.ready },
    queue: queue.map((j) => ({ key: j.clip.key, track: j.track }))
  }
}
const pushState = () => emit({ type: 'state', ...queueState() })

// Adds each (clip, track) that isn't transcribed or queued already.
// front: these go first (the recording you just opened).
export function request(jobs, front = false) {
  const add = []
  for (const { clip, track } of jobs) {
    if (!clip.probe || !clip.probe.duration) continue
    if (fs.existsSync(fileFor(clip, track))) continue
    if (running && running.clip.key === clip.key && running.track === track) continue
    const i = queue.findIndex((j) => j.clip.key === clip.key && j.track === track)
    if (i !== -1) {
      if (!front) continue
      queue.splice(i, 1)
    }
    add.push({ clip, track })
  }
  if (front) queue.unshift(...add)
  else queue.push(...add)
  pushState()
  pump()
}

export function cancel(key) {
  // key given: drop that recording's jobs; otherwise everything.
  for (let i = queue.length - 1; i >= 0; i--) if (!key || queue[i].clip.key === key) queue.splice(i, 1)
  if (running && (!key || running.clip.key === key)) killWorker() // the model reloads for the next job
  pushState()
}

function killWorker() {
  if (!worker) return
  try { worker.proc.kill() } catch { /* gone */ }
  worker = null
  running = null
}

export function shutdown() {
  queue.length = 0
  killWorker()
}

function startWorker() {
  const proc = spawn(PYTHON, ['-u', workerScript()], {
    cwd: WHISPER_HOME,
    env: { ...process.env, BIJOU_WHISPER_MODELS: MODELS, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true
  })
  const w = { proc, ready: false, buf: '', err: '' }
  worker = w
  proc.stdout.on('data', (d) => {
    w.buf += d.toString('utf8')
    let i
    while ((i = w.buf.indexOf('\n')) !== -1) {
      const line = w.buf.slice(0, i).trim()
      w.buf = w.buf.slice(i + 1)
      if (line) { try { onMessage(w, JSON.parse(line)) } catch { /* stray print */ } }
    }
  })
  proc.stderr.on('data', (d) => { w.err = (w.err + d.toString('utf8')).slice(-4000) })
  proc.on('exit', () => {
    if (worker !== w) return
    worker = null
    if (running) {
      emit({ type: 'error', key: running.clip.key, track: running.track, message: 'Transcriber stopped: ' + (w.err.trim().split('\n').pop() || 'unknown error') })
      running = null
    }
    pushState()
    pump()
  })
}

function send(job) {
  const src = audioFiles(job.clip)[job.track]
  worker.proc.stdin.write(JSON.stringify({
    id: job.clip.key + '|' + job.track,
    src: src || job.clip.path,
    stream: src ? 0 : job.track, // the extracted .m4a has just the one track
    duration: job.clip.probe.duration,
    out: fileFor(job.clip, job.track),
    ffmpeg: ffmpegPath,
    lang
  }) + '\n')
}

function onMessage(w, m) {
  if (m.type === 'ready') {
    w.ready = true
    if (running) send(running)
    pushState()
  } else if (m.type === 'fatal') {
    const r = running
    running = null
    queue.length = 0
    emit({ type: 'error', key: r && r.clip.key, track: r && r.track, message: 'Could not start the transcriber: ' + m.message })
    killWorker()
    pushState()
  } else if (m.type === 'progress' && running) {
    running.done = m.done
    pushState()
  } else if (m.type === 'done' && running) {
    const r = running
    running = null
    index.delete(fileFor(r.clip, r.track))
    emit({ type: 'done', key: r.clip.key, track: r.track, segments: m.segments })
    pushState()
    pump()
  } else if (m.type === 'error' && running) {
    const r = running
    running = null
    emit({ type: 'error', key: r.clip.key, track: r.track, message: m.message })
    pushState()
    pump()
  }
}

function pump() {
  clearTimeout(idleTimer)
  if (running) return
  if (!queue.length) {
    idleTimer = setTimeout(killWorker, IDLE_MS)
    return
  }
  if (!installed() || !ffmpegPath) return
  // Prefer jobs whose track is already extracted to its own small audio
  // file. One still waiting for audio prep (queued/running) waits, rather
  // than making ffmpeg read the whole multi-GB video next to playback.
  let at = queue.findIndex((j) => audioFiles(j.clip)[j.track] || !['queued', 'running'].includes(prepStatus(j.clip)))
  if (at === -1) {
    idleTimer = setTimeout(pump, 3000)
    return
  }
  running = { ...queue.splice(at, 1)[0], done: 0 }
  running.duration = running.clip.probe.duration
  if (!worker) startWorker()
  else if (worker.ready) send(running)
  pushState()
}

// ---- search ----
// Transcripts are loaded into memory once (re-read only if the file
// changes), slimmed down to what search needs: each line's text plus its
// word start times as a Float32Array (~4 bytes a word instead of an array
// per word). Files are read asynchronously, yielding between them, because
// this is the main process — the same one that streams video to the
// player — and the first search over a big library reads tens of MB.
// Whole-word-start match, so "iron" finds "iron", "irons", "Iron's" but
// not "environment".
const index = new Map() // file -> {mtime, segments: [{s, e, text, lower, ws}]}
const yieldNow = () => new Promise((r) => setImmediate(r))

async function segmentsFor(clip, track) {
  const f = fileFor(clip, track)
  let st
  try { st = await fs.promises.stat(f) } catch { return null }
  const hit = index.get(f)
  if (hit && hit.mtime === st.mtimeMs) return hit.segments
  let data
  try { data = JSON.parse(await fs.promises.readFile(f, 'utf8')) } catch { return null }
  const segments = data.segments.map(([s, e, text, words]) => ({
    s,
    e,
    text,
    lower: text.toLowerCase(),
    ws: words && words.length ? Float32Array.from(words, (w) => w[0]) : null
  }))
  index.set(f, { mtime: st.mtimeMs, segments })
  await yieldNow()
  return segments
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function search(query, clips, limit = 1000) {
  const q = query.trim().toLowerCase()
  if (!q) return { hits: [], total: 0 }
  const re = new RegExp("(^|[^\\p{L}\\p{N}'])" + esc(q), 'u')
  const hits = []
  let total = 0
  for (const c of clips) {
    const n = ((c.probe && c.probe.audio) || []).length
    for (let track = 0; track < n; track++) {
      const segs = await segmentsFor(c, track)
      if (!segs) continue
      for (const seg of segs) {
        const m = re.exec(seg.lower)
        if (!m) continue
        total++
        if (hits.length >= limit) continue
        // Land on the matched word itself, not the start of the line: the
        // line's text is its words joined, so the Nth space-separated token
        // is word N.
        let t = seg.s
        if (seg.ws) {
          const before = seg.lower.slice(0, m.index + m[1].length)
          let k = before.split(/\s+/).filter(Boolean).length
          if (before && !/\s$/.test(before)) k-- // match starts mid-token ("well-iron")
          if (k >= 0 && k < seg.ws.length) t = Math.round(seg.ws[k] * 100) / 100
        }
        hits.push({ key: c.key, track, t, s: seg.s, e: seg.e, text: seg.text })
      }
    }
  }
  return { hits, total }
}
