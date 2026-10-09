// Voiceover on disk, inside the project's folder:
//
//   <project>/voiceover/sections/<id>.json   — one file per VO section: its
//                                               name, script and clips
//   <project>/voiceover/audio/<take>.wav     — every recording, as made
//   <project>/voiceover/audio/<take>.pk      — its waveform peaks
//
// Recordings are 32-bit float WAV (what the microphone gives, untouched —
// lossless, and Premiere reads it). Each one is written to disk as it's
// recorded, a chunk at a time, so a crash mid-take loses at most the last
// moment; the header's sizes are filled in when it stops (and fixed up on
// the next start if it never did). Clips only ever point into recordings
// (in/out), nothing is cut out of the files.
import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { spawn } from 'child_process'

const voDir = (folder) => path.join(folder, 'voiceover')
const secDir = (folder) => path.join(voDir(folder), 'sections')
export const audioDir = (folder) => path.join(voDir(folder), 'audio')

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1), 'utf8')
  fs.renameSync(file + '.tmp', file)
}

// ---- sections ----
export function listVoSections(folder) {
  const out = []
  let names = []
  try { names = fs.readdirSync(secDir(folder)) } catch { return out }
  for (const f of names) {
    if (!f.endsWith('.json')) continue
    try {
      const s = JSON.parse(fs.readFileSync(path.join(secDir(folder), f), 'utf8'))
      if (s && s.id) out.push({ id: s.id, name: s.name || 'Section', order: s.order ?? 0, script: s.script || '', clips: s.clips || [], createdAt: s.createdAt || 0 })
    } catch { /* a damaged file: skip it rather than lose the rest */ }
  }
  repairUnfinished(folder)
  return out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}
export function saveVoSection(folder, s) {
  writeJson(path.join(secDir(folder), s.id + '.json'), { v: 1, id: s.id, name: s.name, order: s.order ?? 0, script: s.script || '', clips: s.clips || [], createdAt: s.createdAt || Date.now(), updatedAt: Date.now() })
  return true
}
export async function trashVoSection(folder, id) {
  const f = path.join(secDir(folder), id + '.json')
  if (fs.existsSync(f)) await shell.trashItem(f)
}

// ---- WAV (32-bit IEEE float) ----
function wavHeader(sampleRate, channels, dataBytes) {
  const b = Buffer.alloc(44)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + dataBytes, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(3, 20) // IEEE float
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * channels * 4, 28)
  b.writeUInt16LE(channels * 4, 32)
  b.writeUInt16LE(32, 34)
  b.write('data', 36)
  b.writeUInt32LE(dataBytes, 40)
  return b
}

// A take whose header never got its sizes (the app closed mid-take):
// fill them in from the file's length so it plays and imports.
function repairUnfinished(folder) {
  let names = []
  try { names = fs.readdirSync(audioDir(folder)) } catch { return }
  for (const f of names) {
    if (!f.endsWith('.wav') || recordings.has(path.join(audioDir(folder), f))) continue
    const file = path.join(audioDir(folder), f)
    try {
      const fd = fs.openSync(file, 'r+')
      const head = Buffer.alloc(44)
      fs.readSync(fd, head, 0, 44, 0)
      const size = fs.fstatSync(fd).size
      if (head.readUInt32LE(40) !== size - 44) {
        const sr = head.readUInt32LE(24)
        const ch = head.readUInt16LE(22)
        fs.writeSync(fd, wavHeader(sr, ch, size - 44), 0, 44, 0)
      }
      fs.closeSync(fd)
    } catch { /* leave it */ }
  }
}

// ---- recording ----
const recordings = new Map() // file -> {fd, bytes, sampleRate, channels, peaks: []}

export function recStart(folder, take, sampleRate, channels = 1) {
  fs.mkdirSync(audioDir(folder), { recursive: true })
  const file = path.join(audioDir(folder), take + '.wav')
  const fd = fs.openSync(file, 'w')
  fs.writeSync(fd, wavHeader(sampleRate, channels, 0))
  recordings.set(file, { fd, bytes: 0, sampleRate, channels, peaks: [] })
  return file
}
// A chunk of samples (Float32, interleaved) and its peaks (0–255 bytes).
export function recChunk(file, samples, peaks) {
  const r = recordings.get(file)
  if (!r) return false
  const buf = Buffer.from(samples)
  fs.writeSync(r.fd, buf)
  r.bytes += buf.length
  if (peaks) r.peaks.push(Buffer.from(peaks))
  return true
}
export function recStop(file) {
  const r = recordings.get(file)
  if (!r) return null
  recordings.delete(file)
  fs.writeSync(r.fd, wavHeader(r.sampleRate, r.channels, r.bytes), 0, 44, 0)
  fs.closeSync(r.fd)
  const pk = Buffer.concat(r.peaks)
  fs.writeFileSync(file.replace(/\.wav$/, '.pk2'), pk)
  return { file, dur: r.bytes / 4 / r.channels / r.sampleRate }
}

// ---- reading back ----
// Samples [start, start+dur) seconds of a take, as Float32 (interleaved).
export function readPcm(file, start, dur) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(44)
    fs.readSync(fd, head, 0, 44, 0)
    const sr = head.readUInt32LE(24)
    const ch = head.readUInt16LE(22)
    const frame = ch * 4
    const size = fs.fstatSync(fd).size - 44
    const from = Math.max(0, Math.min(size, Math.floor(start * sr) * frame))
    const len = Math.max(0, Math.min(size - from, Math.ceil(dur * sr) * frame))
    const out = Buffer.alloc(len)
    fs.readSync(fd, out, 0, len, 44 + from)
    return { sr, ch, samples: out.buffer.slice(out.byteOffset, out.byteOffset + len) }
  } finally {
    fs.closeSync(fd)
  }
}
// Waveform peaks of a take: 200 per second, one byte each (the square root of
// the peak of that slice, so quiet detail survives). Written when the take is
// recorded; rebuilt from the WAV if the file is missing (an older take, a
// crash, a deleted cache).
const PPS = 200
// readPcm at another speed, pitch unchanged (ffmpeg's atempo, 0.5–100×).
export function readPcmTempo(file, start, dur, rate, ffmpeg) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return reject(new Error('ffmpeg isn\u2019t installed'))
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(44)
    fs.readSync(fd, head, 0, 44, 0)
    fs.closeSync(fd)
    const sr = head.readUInt32LE(24)
    const ch = head.readUInt16LE(22)
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'atempo=' + rate, '-f', 'f32le', '-ac', String(ch), '-ar', String(sr), 'pipe:1'], { windowsHide: true })
    const chunks = []
    p.stdout.on('data', (c) => chunks.push(c))
    p.on('error', reject)
    p.on('close', () => {
      const b = Buffer.concat(chunks)
      resolve({ sr, ch, samples: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) })
    })
  })
}

export function readPeaks(file) {
  const pkFile = file.replace(/\.wav$/, '.pk2')
  try {
    const b = fs.readFileSync(pkFile)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length)
  } catch { /* build it below */ }
  try {
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(44)
    fs.readSync(fd, head, 0, 44, 0)
    const sr = head.readUInt32LE(24)
    const ch = head.readUInt16LE(22)
    const every = Math.round(sr / PPS)
    const size = fs.fstatSync(fd).size - 44
    const frames = Math.floor(size / (4 * ch))
    const out = Buffer.alloc(Math.ceil(frames / every))
    const CH = every * 8192 // frames per read (a whole number of slices)
    const buf = Buffer.alloc(CH * 4 * ch)
    for (let f0 = 0; f0 < frames; f0 += CH) {
      const n = Math.min(CH, frames - f0)
      fs.readSync(fd, buf, 0, n * 4 * ch, 44 + f0 * 4 * ch)
      for (let k = 0; k < n; k += every) {
        let m = 0
        const end = Math.min(n, k + every)
        for (let j = k; j < end; j++) {
          const v = Math.abs(buf.readFloatLE(j * 4 * ch))
          if (v > m) m = v
        }
        out[(f0 + k) / every] = Math.min(255, Math.round(Math.sqrt(Math.min(1, m)) * 255))
      }
    }
    fs.closeSync(fd)
    fs.writeFileSync(pkFile, out)
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length)
  } catch {
    return null
  }
}

// A take's WAV format, for the Premiere export: {sampleRate, channels, dur}
// (our own 44-byte header, float32 samples). null if the file's missing.
export function wavInfo(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(44)
    fs.readSync(fd, b, 0, 44, 0)
    fs.closeSync(fd)
    const channels = b.readUInt16LE(22) || 1
    const sampleRate = b.readUInt32LE(24) || 48000
    const bytes = fs.statSync(file).size - 44
    return { sampleRate, channels, dur: bytes / 4 / channels / sampleRate }
  } catch {
    return null
  }
}
