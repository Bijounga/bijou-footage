// Finds video files in the user's footage folders and probes each one once
// with ffprobe. Probe results are cached on disk keyed by path + size +
// mtime, so re-scanning hundreds of hours of footage only probes files that
// are new or changed since last time.
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { readMp4Keyframes } from './keyframes.js'

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.webm'])
const MAX_DEPTH = 4
const PROBE_CONCURRENCY = 4
// A silent AAC track (OBS track with nothing routed to it, or a mic that
// was never used) encodes to ~2.27 kbps no matter how long the recording
// is. Anything under this is treated as "probably empty" without having to
// decode a single sample.
const SILENT_BITRATE = 4000
// Bump when the probe result gains fields, so cached entries get re-probed.
const PROBE_VERSION = 3

let cachePath = null
let probeCache = {} // cacheKey -> probe

export function clipKey(p) {
  const abs = path.resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export function initLibrary(userDataDir) {
  cachePath = path.join(userDataDir, 'probe-cache.json')
  try {
    probeCache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {}
    const prefix = 'v' + PROBE_VERSION + '|'
    for (const k of Object.keys(probeCache)) if (!k.startsWith(prefix)) delete probeCache[k]
  } catch {
    probeCache = {}
  }
}

let saveTimer = null
function saveCacheSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(cachePath + '.tmp', JSON.stringify(probeCache))
      fs.renameSync(cachePath + '.tmp', cachePath)
    } catch (e) {
      console.error('probe cache save failed', e)
    }
  }, 500)
}

function walk(dir, depth, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return // permission denied / unplugged drive — skip, don't fail the scan
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (depth < MAX_DEPTH && !ent.name.startsWith('.') && ent.name !== '$RECYCLE.BIN') walk(full, depth + 1, out)
    } else if (VIDEO_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full)
    }
  }
}

// OBS's default filename format is "YYYY-MM-DD HH-MM-SS". Using that as the
// recording time is more reliable than file timestamps, which change when
// footage gets copied between drives.
function recordedAtFor(name, stat) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})-(\d{2})-(\d{2})/.exec(name)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  return Math.min(stat.birthtimeMs || Infinity, stat.mtimeMs)
}

function parseRate(r) {
  if (!r || r === '0/0') return null
  const [n, d] = r.split('/').map(Number)
  return d ? n / d : n
}

// Keyframe positions let the player land "instant" seeks exactly on a
// keyframe — a single-frame decode instead of up to 250 frames. MP4/MOV:
// the exact list, read from the file's own index (keyframes.js). Other
// containers: estimate the interval from the first ~15s of packet headers
// (OBS is mostly periodic, but see keyframes.js for why that's only a
// fallback).
function probeKeyframes(ffprobe, file) {
  if (/\.(mp4|m4v|mov)$/i.test(file)) {
    const times = readMp4Keyframes(file)
    if (times && times.length > 1) return Promise.resolve({ times })
  }
  return probePeriodicKeyframes(ffprobe, file)
}

function probePeriodicKeyframes(ffprobe, file) {
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+15', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const kf = stdout
          .split(/\r?\n/)
          .filter((l) => /,K/.test(l))
          .map((l) => Number(l.split(',')[0]))
          .filter((n) => isFinite(n))
          .sort((a, b) => a - b)
        if (kf.length < 3) return resolve(null)
        const diffs = kf.slice(1).map((t, i) => t - kf[i]).sort((a, b) => a - b)
        const interval = diffs[Math.floor(diffs.length / 2)]
        // Only trust it if the spacing is actually regular.
        if (!(interval > 0.2) || diffs.some((d) => Math.abs(d - interval) > 0.05)) return resolve(null)
        resolve({ interval, phase: kf[0] % interval })
      }
    )
  })
}

function probeFile(ffprobe, file) {
  return Promise.all([probeStreams(ffprobe, file), probeKeyframes(ffprobe, file)]).then(([p, kf]) => (p.error ? p : { ...p, keyframes: kf }))
}

function probeStreams(ffprobe, file) {
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve({ error: String(err.message || err).split('\n')[0] })
        try {
          const j = JSON.parse(stdout)
          const streams = j.streams || []
          const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic))
          const audio = streams
            .filter((s) => s.codec_type === 'audio')
            .map((s) => {
              // MKV doesn't store per-stream bitrates; OBS writes them as
              // a BPS tag instead, when it writes them at all.
              const br = Number(s.bit_rate || (s.tags && (s.tags.BPS || s.tags['BPS-eng'])) || 0) || null
              return {
                codec: s.codec_name,
                channels: s.channels || 2,
                bitrate: br,
                likelySilent: br != null ? br < SILENT_BITRATE : null,
                title: (s.tags && s.tags.title) || null
              }
            })
          resolve({
            duration: Number(j.format && j.format.duration) || (v && Number(v.duration)) || 0,
            vcodec: v ? v.codec_name : null,
            width: v ? v.width : null,
            height: v ? v.height : null,
            fps: v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) : null,
            audio
          })
        } catch (e) {
          resolve({ error: 'Could not read ffprobe output' })
        }
      }
    )
  })
}

// Returns every clip immediately (probe: null for ones not yet probed), then
// probes the rest in the background, calling onProbed(clip) as each lands.
// `extraFiles`: individual recordings the user picked from anywhere (outside
// their library folders). Missing ones (unplugged drive) are just skipped.
export function scanFolders(folders, ffprobe, onProbed, extraFiles = []) {
  const files = []
  for (const f of folders) walk(f, 0, files)
  for (const f of extraFiles) if (VIDEO_EXTS.has(path.extname(f).toLowerCase())) files.push(f)
  const seen = new Set()
  const clips = []
  const toProbe = []
  for (const file of files) {
    const key = clipKey(file)
    if (seen.has(key)) continue
    seen.add(key)
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    const cacheKey = 'v' + PROBE_VERSION + '|' + key + '|' + stat.size + '|' + Math.round(stat.mtimeMs)
    const probe = probeCache[cacheKey] || null
    const clip = {
      key,
      path: file,
      name: path.basename(file),
      folder: path.dirname(file),
      size: stat.size,
      recordedAt: recordedAtFor(path.basename(file), stat),
      probe
    }
    clips.push(clip)
    if (!probe) toProbe.push({ clip, cacheKey })
  }

  if (ffprobe && toProbe.length) {
    let i = 0
    const worker = async () => {
      while (i < toProbe.length) {
        const job = toProbe[i++]
        const probe = await probeFile(ffprobe, job.clip.path)
        if (!probe.error) {
          probeCache[job.cacheKey] = probe
          saveCacheSoon()
        }
        onProbed({ ...job.clip, probe })
      }
    }
    for (let w = 0; w < PROBE_CONCURRENCY; w++) worker()
  }
  return clips
}
