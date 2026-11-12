// Export a piece of a recording as its own video file: in point → out point,
// optionally with every audio track mixed down to one (Discord and most
// players only play the first track), optionally shrunk to fit a size limit.
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const AUDIO_KBPS = 128
const SIZE_LIMITS = { discord10: 10, discord50: 50 } // MB

let running = null // {proc, out}

// The rungs we step down while the bitrate is too thin for the picture size.
const LADDER = [1080, 720, 540, 480, 360]

// Video settings that land under `mb` megabytes: a bitrate for the length, and
// the largest size / frame rate that still gets a decent number of bits per pixel.
export function fitToSize(mb, seconds, src) {
  const totalBits = mb * 1e6 * 8 * 0.9 // 10% under, the encoder never hits it exactly
  const kbps = Math.max(100, Math.floor(totalBits / Math.max(1, seconds) / 1000 - AUDIO_KBPS))
  const sw = src.width || 1920
  const sh = src.height || 1080
  const fps0 = src.fps || 30
  const bpp = (h, fps) => (kbps * 1000) / (((sw * h) / sh) * h * fps)
  const heights = [sh, ...LADDER.filter((h) => h < sh)]
  for (const fps of fps0 > 30.5 ? [fps0, 30] : [fps0]) {
    for (const h of heights) if (bpp(h, fps) >= 0.07) return { kbps, height: h, fps }
  }
  return { kbps, height: Math.min(sh, 360), fps: Math.min(fps0, 30) }
}

// ffmpeg arguments for one export. Pure, so it can be checked without running anything.
export function buildArgs(o) {
  const len = Math.max(0.1, o.end - o.start)
  const args = ['-hide_banner', '-nostats', '-y', '-ss', o.start.toFixed(3), '-i', o.path, '-t', len.toFixed(3)]
  const src = o.probe || {}
  const hasVideo = !!src.vcodec

  // audio: the tracks that count, each with its gain (0 or less = left out)
  const used = (o.gains || []).map((g, i) => ({ i, g })).filter((t) => t.g > 0.001 && t.i < ((src.audio || []).length))
  const filters = []
  const maps = []
  let audioArgs = []
  if (used.length) {
    if (o.audio === 'one') {
      // every track to stereo at its fader level, summed, then a limiter so loud sums don't clip
      const n = used.length
      used.forEach((t, k) => filters.push(`[0:a:${t.i}]aformat=channel_layouts=stereo,volume=${t.g.toFixed(4)}[m${k}]`))
      const ins = used.map((_, k) => `[m${k}]`).join('')
      // amix divides by the number of inputs; volume=n puts the level back
      filters.push(`${ins}amix=inputs=${n}:duration=longest:dropout_transition=0,volume=${n},alimiter=limit=0.9[aout]`)
      maps.push('-map', '[aout]')
      audioArgs = ['-c:a', 'aac', '-b:a', AUDIO_KBPS + 'k', '-ac', '2']
    } else {
      for (const t of used) maps.push('-map', `0:a:${t.i}`)
      audioArgs = ['-c:a', 'aac', '-b:a', '192k']
    }
  }

  let videoArgs = []
  if (hasVideo) {
    maps.unshift('-map', '0:v:0')
    const vf = []
    let crf = '17'
    let rate = []
    if (o.fit) {
      vf.push(`scale=-2:${o.fit.height}`)
      if (o.fit.fps && src.fps && o.fit.fps < src.fps - 0.5) vf.push(`fps=${o.fit.fps}`)
      rate = ['-b:v', o.fit.kbps + 'k', '-maxrate', Math.round(o.fit.kbps * 1.4) + 'k', '-bufsize', Math.round(o.fit.kbps * 2) + 'k']
      crf = null
    }
    videoArgs = ['-c:v', 'libx264', '-preset', o.fit ? 'medium' : 'veryfast', ...(crf ? ['-crf', crf] : []), ...rate, '-pix_fmt', 'yuv420p']
    if (vf.length) videoArgs.push('-vf', vf.join(','))
  }

  if (filters.length) args.push('-filter_complex', filters.join(';'))
  args.push(...maps, ...videoArgs, ...audioArgs, '-movflags', '+faststart', '-progress', 'pipe:1', o.out)
  return args
}

function run(ffmpeg, args, len, onProgress) {
  return new Promise((resolve) => {
    let err = ''
    let proc
    try {
      proc = spawn(ffmpeg, args, { windowsHide: true })
    } catch (e) { return resolve({ error: String(e.message || e) }) }
    running = { proc }
    let buf = ''
    proc.stdout.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop()
      for (const l of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(l)
        if (m) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / len))
      }
    })
    proc.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000) })
    proc.on('error', (e) => resolve({ error: String(e.message || e) }))
    proc.on('close', (code) => {
      const cancelled = running && running.cancelled
      running = null
      if (cancelled) return resolve({ cancelled: true })
      if (code === 0) return resolve({ ok: true })
      const line = err.split(/\r?\n/).filter((l) => l.trim()).pop() || 'ffmpeg failed'
      resolve({ error: line })
    })
  })
}

// opts: {path, probe, start, end, audio: 'one'|'all', gains: [per track], size: 'original'|'discord10'|'discord50', out}
export async function exportClip(ffmpeg, opts, emit) {
  if (running) return { error: 'An export is already running' }
  if (!ffmpeg) return { error: 'ffmpeg was not found — set it up in Settings → General → Tools' }
  const len = opts.end - opts.start
  if (!(len > 0)) return { error: 'The end has to be after the start' }
  const mb = SIZE_LIMITS[opts.size]
  let fit = mb && opts.probe && opts.probe.vcodec ? fitToSize(mb, len, opts.probe) : null
  let r = await run(ffmpeg, buildArgs({ ...opts, fit }), len, (f) => emit({ fraction: f }))
  // one retry if the file still came out over the limit (the encoder only aims at a bitrate)
  if (r.ok && mb && fit) {
    const size = fs.statSync(opts.out).size
    if (size > mb * 1e6) {
      const scale = (mb * 1e6 * 0.88) / size
      fit = { ...fit, kbps: Math.max(80, Math.floor(fit.kbps * scale)) }
      emit({ fraction: 0, retry: true })
      r = await run(ffmpeg, buildArgs({ ...opts, fit }), len, (f) => emit({ fraction: f }))
    }
  }
  if (!r.ok) { try { fs.unlinkSync(opts.out) } catch { /* not written */ } return r }
  return { ok: true, path: opts.out, bytes: fs.statSync(opts.out).size, limitMB: mb || null }
}

export function cancelExport() {
  if (running) {
    running.cancelled = true
    try { running.proc.kill() } catch { /* already gone */ }
  }
}
