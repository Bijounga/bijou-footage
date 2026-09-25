// Background media prep, one file at a time (it's disk-bound — running
// several in parallel on the same drive just makes them all slower).
// Playback never waits on this: a clip plays instantly, and this just makes
// it better once it's done. One ffmpeg pass reads the recording once and:
//
// 1. Builds per-track waveform peaks: every audio track decoded at once
//    (amerge'd into one N-channel stream at a low sample rate), reduced to
//    PEAKS_PER_SEC max-amplitude values per track, sqrt-curved into a byte
//    so quiet voice is still visible next to loud game audio.
//    Cache file: "BWF1" | u32 trackCount | u32 peaksPerSec | u32 length,
//    then trackCount × length bytes, track-major.
//
// 2. Copies each non-empty track out to its own small .m4a (stream copy,
//    no re-encode). Before this exists, each extra track's player has to
//    read the full multi-GB video file just to get its audio, and every
//    seek makes all of them fight the video decoder for the same disk —
//    measured at 2-3× slower seeks. With the .m4a, an audio seek is a few
//    KB read, and the video element can drop audio altogether.
//    The media cache has a user-set limit (Settings → Storage). Over it,
//    either the least-recently-opened recordings' files are deleted
//    ("auto"), or ("remind", the default) nothing is deleted: background
//    prep pauses and the app shows a reminder to trim or empty the cache.
//    Recordings you open are always prepared either way.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'

export const PEAKS_PER_SEC = 50
const SAMPLE_RATE = 2000
const BUCKET = SAMPLE_RATE / PEAKS_PER_SEC
let cacheLimit = 20 * 1024 ** 3 // bytes, audio + waveforms
let cacheMode = 'remind' // 'remind' | 'auto'
let cacheSize = null // bytes, audio + waveforms (null = not measured yet)

let cacheDir = null
let audioDir = null
let ffmpegPath = null
let emit = () => {}
const queue = [] // [{clip}]
let running = null // {clip, proc}

export function initWaveforms(userDataDir, onEvent) {
  cacheDir = path.join(userDataDir, 'waveforms')
  audioDir = path.join(userDataDir, 'audio-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.mkdirSync(audioDir, { recursive: true })
  emit = onEvent
}

export function setFfmpeg(p) {
  ffmpegPath = p
}

export function hashFor(clip) {
  return crypto.createHash('sha1').update(clip.key + '|' + clip.size).digest('hex')
}

function fileFor(clip) {
  return path.join(cacheDir, hashFor(clip) + '.bwf')
}

function audioFileFor(clip, i) {
  return path.join(audioDir, hashFor(clip) + '-a' + i + '.m4a')
}

// Tracks worth extracting: every one that isn't known to be empty (MKVs
// have no bitrate info → unknown → extract). Track 1 included: once it has
// its own file, the video element stops decoding audio entirely, which
// makes a seek-while-playing resume ~30-40% sooner.
function extraTracks(clip) {
  const audio = (clip.probe && clip.probe.audio) || []
  const out = []
  for (let i = 0; i < audio.length; i++) if (audio[i].likelySilent !== true) out.push(i)
  return out
}

function isComplete(clip) {
  return fs.existsSync(fileFor(clip)) && extraTracks(clip).every((i) => fs.existsSync(audioFileFor(clip, i)))
}

export function readCached(clip) {
  try {
    return fs.readFileSync(fileFor(clip))
  } catch {
    return null
  }
}

// {trackIndex: path} for every extracted track that exists. Touches the
// files so the LRU eviction knows this recording is in use.
export function audioFiles(clip) {
  const out = {}
  const now = new Date()
  for (let i = 0; i < ((clip.probe && clip.probe.audio) || []).length; i++) {
    const f = audioFileFor(clip, i)
    if (fs.existsSync(f)) {
      out[i] = f
      try { fs.utimesSync(f, now, now) } catch { /* read-only is fine */ }
    }
  }
  return out
}

export function status(clip) {
  if (isComplete(clip)) return 'ready'
  if (running && running.clip.key === clip.key) return 'running'
  if (queue.some((j) => j.clip.key === clip.key)) return 'queued'
  return 'none'
}

// front=true for the clip the user just opened, so it jumps the queue.
export function request(clip, front = false) {
  if (!clip.probe || !clip.probe.audio || !clip.probe.audio.length) return
  if (isComplete(clip)) return
  // Over the limit in "remind" mode: background prep waits (the recording
  // you open still gets prepared).
  if (!front && cacheMode === 'remind' && overLimit()) return
  if (running && running.clip.key === clip.key) return
  const existing = queue.findIndex((j) => j.clip.key === clip.key)
  if (existing !== -1) {
    if (!front) return
    queue.splice(existing, 1)
  }
  if (front) queue.unshift({ clip, front: true })
  else queue.push({ clip })
  emit({ type: 'queued', key: clip.key, queueLength: queue.length })
  pump()
}

export function clearQueue() {
  queue.length = 0
  emit({ type: 'queue', queueLength: 0 })
}

function pump() {
  if (running || !queue.length || !ffmpegPath) return
  const job = queue.shift()
  // A background job queued before the cache filled up: skip it now.
  if (!job.front && cacheMode === 'remind' && overLimit()) {
    pump()
    return
  }
  run(job.clip)
    .then(() => afterJob(job.clip))
    .catch((e) => emit({ type: 'error', key: job.clip.key, message: String(e.message || e) }))
    .finally(() => {
      running = null
      pump()
    })
}

// ---- media cache: size, limit, trim, empty ----

function listCache() {
  const out = []
  for (const [dir, ext] of [[audioDir, '.m4a'], [cacheDir, '.bwf']]) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const f of names) {
      if (!f.endsWith(ext)) continue
      const p = path.join(dir, f)
      try {
        const st = fs.statSync(p)
        out.push({ p, f, dir, size: st.size, used: st.mtimeMs, hash: f.slice(0, 40) })
      } catch { /* vanished */ }
    }
  }
  return out
}

function measure() {
  cacheSize = listCache().reduce((a, x) => a + x.size, 0)
  return cacheSize
}

const overLimit = () => (cacheSize == null ? measure() : cacheSize) > cacheLimit

function cacheEvent() {
  emit({ type: 'cache', size: cacheSize, limit: cacheLimit, mode: cacheMode, over: cacheSize > cacheLimit })
}

export function setCachePolicy(limitBytes, mode) {
  cacheLimit = Math.max(1024 ** 3, limitBytes || cacheLimit)
  cacheMode = mode === 'auto' ? 'auto' : 'remind'
  measure()
  if (cacheMode === 'auto') trimTo(cacheLimit, null)
  cacheEvent()
}

// Sizes for Settings → Storage.
export function cacheStats(transcriptsDir) {
  const files = listCache()
  const audio = files.filter((x) => x.dir === audioDir)
  const waves = files.filter((x) => x.dir === cacheDir)
  let transcripts = 0
  let transcriptFiles = 0
  try {
    for (const f of fs.readdirSync(transcriptsDir)) {
      transcripts += fs.statSync(path.join(transcriptsDir, f)).size
      transcriptFiles++
    }
  } catch { /* none yet */ }
  cacheSize = audio.reduce((a, x) => a + x.size, 0) + waves.reduce((a, x) => a + x.size, 0)
  return {
    audio: audio.reduce((a, x) => a + x.size, 0),
    audioFiles: audio.length,
    waveforms: waves.reduce((a, x) => a + x.size, 0),
    waveformFiles: waves.length,
    recordings: new Set(files.map((x) => x.hash)).size,
    transcripts,
    transcriptFiles,
    total: cacheSize,
    limit: cacheLimit,
    mode: cacheMode,
    folder: path.dirname(audioDir)
  }
}

// Delete least-recently-opened recordings' cache files until the cache is
// under `target` bytes. keepKey's files (the open recording) are kept.
// Files in use (playing) can't be deleted on Windows; those are skipped.
function trimTo(target, keepHash) {
  const files = listCache()
  let total = files.reduce((a, x) => a + x.size, 0)
  // Whole recordings at a time (its audio + waveform), oldest use first.
  const byRec = new Map()
  for (const x of files) {
    const r = byRec.get(x.hash) || { hash: x.hash, used: 0, files: [] }
    r.used = Math.max(r.used, x.used)
    r.files.push(x)
    byRec.set(x.hash, r)
  }
  let freed = 0
  let skipped = 0
  for (const r of [...byRec.values()].sort((a, b) => a.used - b.used)) {
    if (total <= target) break
    if (r.hash === keepHash) continue
    for (const x of r.files) {
      try {
        fs.unlinkSync(x.p)
        total -= x.size
        freed += x.size
      } catch {
        skipped++
      }
    }
  }
  cacheSize = total
  return { freed, skipped }
}

export function trimCache(keepClip) {
  const res = trimTo(cacheLimit * 0.9, keepClip ? hashFor(keepClip) : null) // a little headroom
  emit({ type: 'cacheCleared' })
  cacheEvent()
  return res
}

export function emptyCache(keepClip) {
  queue.length = 0
  const res = trimTo(0, keepClip ? hashFor(keepClip) : null)
  emit({ type: 'cacheCleared' })
  emit({ type: 'queue', queueLength: 0 })
  cacheEvent()
  return res
}

function afterJob(justMade) {
  measure()
  if (cacheMode === 'auto' && cacheSize > cacheLimit) trimTo(cacheLimit, hashFor(justMade))
  cacheEvent()
}

function run(clip) {
  return new Promise((resolve, reject) => {
    const n = clip.probe.audio.length
    const duration = clip.probe.duration || 0
    const chain = (i) => `[0:a:${i}]aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`
    let filter
    if (n === 1) filter = chain(0).replace('[a0]', '[m]')
    else {
      const parts = []
      for (let i = 0; i < n; i++) parts.push(chain(i))
      filter = parts.join(';') + ';' + Array.from({ length: n }, (_, i) => `[a${i}]`).join('') + `amerge=inputs=${n}[m]`
    }
    const extras = extraTracks(clip).filter((i) => !fs.existsSync(audioFileFor(clip, i)))
    const args = ['-v', 'error', '-stats', '-y', '-i', clip.path, '-filter_complex', filter, '-map', '[m]', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1']
    for (const i of extras) args.push('-map', `0:a:${i}`, '-c', 'copy', '-f', 'mp4', audioFileFor(clip, i) + '.tmp')
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    running = { clip, proc }
    emit({ type: 'start', key: clip.key, queueLength: queue.length })

    const cap = Math.ceil(duration * PEAKS_PER_SEC) + PEAKS_PER_SEC * 10
    let tracks = Array.from({ length: n }, () => new Uint8Array(cap))
    let len = 0
    const bucketMax = new Int32Array(n)
    let inBucket = 0
    let leftover = null
    const frameBytes = 2 * n

    proc.stdout.on('data', (chunk) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % frameBytes)
      for (let off = 0; off < usable; off += frameBytes) {
        for (let c = 0; c < n; c++) {
          let s = buf.readInt16LE(off + c * 2)
          if (s < 0) s = -s
          if (s > bucketMax[c]) bucketMax[c] = s
        }
        if (++inBucket === BUCKET) {
          if (len >= tracks[0].length) tracks = tracks.map((t) => { const b = new Uint8Array(t.length * 2); b.set(t); return b })
          for (let c = 0; c < n; c++) {
            tracks[c][len] = Math.min(255, Math.round(Math.sqrt(bucketMax[c] / 32768) * 255))
            bucketMax[c] = 0
          }
          len++
          inBucket = 0
        }
      }
      leftover = usable < buf.length ? Buffer.from(buf.subarray(usable)) : null
    })

    let lastEmit = 0
    let errText = ''
    proc.stderr.on('data', (d) => {
      const s = d.toString()
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
      if (m && duration) {
        const t = +m[1] * 3600 + +m[2] * 60 + +m[3]
        const now = Date.now()
        if (now - lastEmit > 250) {
          lastEmit = now
          emit({ type: 'progress', key: clip.key, progress: Math.min(1, t / duration) })
        }
      } else if (!/frame=|size=/.test(s)) errText += s
    })

    const cleanupTmp = () => extras.forEach((i) => { try { fs.unlinkSync(audioFileFor(clip, i) + '.tmp') } catch { /* never created */ } })
    proc.on('error', (e) => { cleanupTmp(); reject(e) })
    proc.on('close', (code) => {
      if (code !== 0 || len === 0) {
        cleanupTmp()
        reject(new Error(errText.trim().split('\n').pop() || 'ffmpeg exited with ' + code))
        return
      }
      const header = Buffer.alloc(16)
      header.write('BWF1', 0, 'ascii')
      header.writeUInt32LE(n, 4)
      header.writeUInt32LE(PEAKS_PER_SEC, 8)
      header.writeUInt32LE(len, 12)
      const body = Buffer.concat(tracks.map((t) => Buffer.from(t.buffer, t.byteOffset, len)))
      const file = fileFor(clip)
      fs.writeFileSync(file + '.tmp', Buffer.concat([header, body]))
      fs.renameSync(file + '.tmp', file)
      for (const i of extras) fs.renameSync(audioFileFor(clip, i) + '.tmp', audioFileFor(clip, i))
      emit({ type: 'done', key: clip.key, queueLength: queue.length })
      resolve()
    })
  })
}
