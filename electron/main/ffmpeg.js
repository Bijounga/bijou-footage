// Locates ffmpeg/ffprobe. We only shell out to them for two things —
// probing a file's streams (fast, header-only) and building waveforms in the
// background — playback itself never touches ffmpeg (Chromium plays the
// original file directly, GPU-decoded).
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const COMMON_DIRS = ['C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

let cached = null

function findOnPath(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, [name], { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).find((l) => l.trim())
    return first ? first.trim() : null
  } catch {
    return null
  }
}

// `overrideDir` comes from the user's settings (a folder containing both).
export function locateFfmpeg(overrideDir) {
  if (cached && cached.overrideDir === overrideDir) return cached
  const exe = process.platform === 'win32' ? '.exe' : ''
  let ffmpeg = null
  let ffprobe = null
  const dirs = overrideDir ? [overrideDir, ...COMMON_DIRS] : COMMON_DIRS
  for (const d of dirs) {
    if (!ffmpeg && fs.existsSync(path.join(d, 'ffmpeg' + exe))) ffmpeg = path.join(d, 'ffmpeg' + exe)
    if (!ffprobe && fs.existsSync(path.join(d, 'ffprobe' + exe))) ffprobe = path.join(d, 'ffprobe' + exe)
  }
  ffmpeg = ffmpeg || findOnPath('ffmpeg')
  ffprobe = ffprobe || findOnPath('ffprobe')
  cached = { overrideDir, ffmpeg, ffprobe }
  return cached
}
