// In-app setup for the optional tools, on Windows and macOS:
//   ffmpeg   — file info, waveforms, audio prep (needed; Macs rarely have it)
//   whisper  — transcripts: a Python venv with faster-whisper (+ the CUDA
//              libraries on a PC with an NVIDIA card; otherwise the CPU,
//              e.g. a Mac) and the large-v3-turbo model
//   llm      — AI summaries: llama.cpp's llama-server (CUDA build with an
//              NVIDIA card, Vulkan on other PCs, Metal on a Mac) and a Qwen3
//              model sized to the machine's graphics / unified memory
// Everything goes into ~/.bijou-footage (paths.js). One install runs at a
// time; progress goes to the window as 'setup:event'.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { once } from 'events'
import { spawn, execFile } from 'child_process'
import { isWin, isMac, WHISPER_HOME, LLM_HOME, FFMPEG_HOME, EXE, VENV_PYTHON } from './paths.js'

const LLAMA_BUILD = 'b11178' // the llama.cpp release this app is tested with
const llamaUrl = (asset) => `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${asset}`
const hf = (m) => `https://huggingface.co/Qwen/Qwen3-${m}-GGUF/resolve/main/Qwen3-${m}-Q4_K_M.gguf`
export const LLM_MODELS = {
  small: { label: 'Small (Qwen3 4B)', file: 'Qwen3-4B-Q4_K_M.gguf', url: hf('4B'), bytes: 2497280256 },
  medium: { label: 'Medium (Qwen3 8B)', file: 'Qwen3-8B-Q4_K_M.gguf', url: hf('8B'), bytes: 5027783488 },
  large: { label: 'Large (Qwen3 14B)', file: 'Qwen3-14B-Q4_K_M.gguf', url: hf('14B'), bytes: 9001752960 },
}
// Automated tests (the Mac CI job) use a tiny model instead.
if (process.env.BIJOU_SETUP_TEST) LLM_MODELS.test = { label: 'Test (Qwen3 0.6B)', file: 'Qwen3-0.6B-Q8_0.gguf', url: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf', bytes: 639446688 }
const WHISPER_MODEL = process.env.BIJOU_WHISPER_MODEL || 'large-v3-turbo'
const WHISPER_MARK = path.join(WHISPER_HOME, 'installed.json')

// ---- what's here ----
let gpuCache = null
function gpu() {
  if (gpuCache) return gpuCache
  gpuCache = new Promise((resolve) => {
    if (!isWin) return resolve({ nvidia: false, vramGB: 0 })
    execFile('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const mb = err ? 0 : Math.max(0, ...String(out).split(/\r?\n/).map((l) => parseInt(l, 10) || 0))
      resolve({ nvidia: mb > 0, vramGB: Math.round(mb / 1024) })
    })
  })
  return gpuCache
}

// The biggest model that fits: graphics memory on a PC (llama-server puts
// what doesn't fit on the CPU, which is slow), unified memory on a Mac.
function recommendLlm(g) {
  if (isMac) {
    const gb = os.totalmem() / 2 ** 30
    return gb >= 30 ? 'large' : gb >= 15 ? 'medium' : 'small'
  }
  return g.vramGB >= 12 ? 'large' : g.vramGB >= 8 ? 'medium' : 'small'
}

export function whisperInstalled() {
  if (!fs.existsSync(VENV_PYTHON)) return false
  if (fs.existsSync(WHISPER_MARK)) return true
  // installed by hand before this setup existed
  const lib = path.join(WHISPER_HOME, 'venv', isWin ? 'Lib' : 'lib')
  try {
    if (isWin) return fs.existsSync(path.join(lib, 'site-packages', 'faster_whisper'))
    return fs.readdirSync(lib).some((d) => fs.existsSync(path.join(lib, d, 'site-packages', 'faster_whisper')))
  } catch {
    return false
  }
}
function whisperInfo() {
  try { return JSON.parse(fs.readFileSync(WHISPER_MARK, 'utf8')) } catch { return null }
}

export async function status({ ffmpeg, llm }) {
  const g = await gpu()
  return {
    platform: process.platform,
    arch: process.arch,
    memGB: Math.round(os.totalmem() / 2 ** 30),
    gpu: g,
    ffmpeg: { path: ffmpeg.ffmpeg, ffprobe: ffmpeg.ffprobe, managed: fs.existsSync(path.join(FFMPEG_HOME, 'bin', 'ffmpeg' + EXE)) },
    whisper: { installed: whisperInstalled(), device: (whisperInfo() || {}).device || (isWin && g.nvidia ? 'cuda' : 'cpu') },
    llm: { installed: llm.installed(), model: llm.modelFile() },
    llmModels: LLM_MODELS,
    recommend: recommendLlm(g),
    running: job ? job.what : null,
  }
}

// ---- running a job ----
let job = null // {what, ac: AbortController, procs: Set}

export async function install(what, opts, emit) {
  if (job) throw new Error('Another setup is already running.')
  const steps = { ffmpeg: installFfmpeg, whisper: installWhisper, llm: installLlm }[what]
  if (!steps) throw new Error('Unknown tool: ' + what)
  const j = { what, ac: new AbortController(), procs: new Set() }
  job = j
  let last = 0
  const report = (patch) => {
    // progress at most ~6×/s; step changes and the end always go out
    const now = Date.now()
    if (patch.percent != null && !patch.step && now - last < 160) return
    last = now
    emit({ what, state: 'running', ...patch })
  }
  try {
    await steps(opts || {}, report, j)
    emit({ what, state: 'done' })
    return true
  } catch (e) {
    emit({ what, state: j.ac.signal.aborted ? 'cancelled' : 'error', message: j.ac.signal.aborted ? 'Cancelled.' : String((e && e.message) || e) })
    return false
  } finally {
    job = null
  }
}

export function cancel() {
  if (!job) return
  job.ac.abort()
  for (const p of job.procs) try { p.kill() } catch { /* gone */ }
}

const fmtMB = (b) => (b >= 2 ** 30 ? (b / 2 ** 30).toFixed(1) + ' GB' : Math.round(b / 2 ** 20) + ' MB')

async function download(j, url, dest, report, step) {
  report({ step, percent: 0 })
  const res = await fetch(url, { signal: j.ac.signal, redirect: 'follow' })
  if (!res.ok) throw Object.assign(new Error(`Download failed (${res.status}): ${url}`), { status: res.status })
  const total = Number(res.headers.get('content-length')) || 0
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = dest + '.part'
  const out = fs.createWriteStream(part)
  let got = 0
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await once(out, 'drain')
      got += chunk.length
      report({ percent: total ? (got / total) * 100 : null, detail: fmtMB(got) + (total ? ' of ' + fmtMB(total) : '') })
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  if (j.ac.signal.aborted) throw new Error('Cancelled.')
  if (total && got !== total) throw new Error('The download was cut short — try again.')
  fs.renameSync(part, dest)
}

// Runs a program; each output line goes to onLine. Rejects with its last
// lines of output if it fails.
function run(j, cmd, args, { cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    j.procs.add(p)
    let tail = ''
    let buf = ''
    const take = (d) => {
      const s = d.toString('utf8')
      tail = (tail + s).slice(-2000)
      buf += s
      const parts = buf.split(/\r\n|\r|\n/)
      buf = parts.pop()
      for (const l of parts) if (l.trim() && onLine) onLine(l.trim())
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', reject)
    p.on('close', (code) => {
      j.procs.delete(p)
      if (code === 0) resolve(tail)
      else reject(new Error(j.ac.signal.aborted ? 'Cancelled.' : tail.trim().split(/\r?\n/).slice(-3).join(' ') || `${path.basename(cmd)} exited with ${code}`))
    })
  })
}

// tar handles .zip too: Windows 10+ ships bsdtar as System32\tar.exe — called
// by its full path, since another tar on PATH (Git's GNU tar) reads "C:" in
// a path as a network host.
const TAR = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const extract = (j, archive, dir) => {
  fs.mkdirSync(dir, { recursive: true })
  return run(j, TAR, ['-xf', archive, '-C', dir])
}
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isFile() && e.name === name) return p
    if (e.isDirectory()) {
      const f = findFile(p, name)
      if (f) return f
    }
  }
  return null
}
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })

// ---- ffmpeg ----
async function installFfmpeg(_opts, report, j) {
  const tmp = path.join(FFMPEG_HOME, 'tmp')
  const bin = path.join(FFMPEG_HOME, 'bin')
  rmrf(tmp)
  fs.mkdirSync(bin, { recursive: true })
  try {
    if (isWin) {
      const zip = path.join(tmp, 'ffmpeg.zip')
      await download(j, 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', zip, report, 'Downloading ffmpeg')
      report({ step: 'Unpacking…', percent: null })
      await extract(j, zip, path.join(tmp, 'x'))
      for (const t of ['ffmpeg.exe', 'ffprobe.exe']) {
        const f = findFile(path.join(tmp, 'x'), t)
        if (!f) throw new Error(t + ' was not in the download.')
        fs.copyFileSync(f, path.join(bin, t))
      }
    } else if (isMac) {
      // Static, signed builds from ffmpeg.martin-riedl.de. The newest
      // release is sometimes missing for one architecture for a while;
      // then the newest snapshot is used.
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      for (const t of ['ffmpeg', 'ffprobe']) {
        const zip = path.join(tmp, t + '.zip')
        try {
          await download(j, `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/${t}.zip`, zip, report, 'Downloading ' + t)
        } catch (e) {
          if (!e.status) throw e
          await download(j, `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/snapshot/${t}.zip`, zip, report, 'Downloading ' + t)
        }
        await extract(j, zip, path.join(tmp, t))
        const f = findFile(path.join(tmp, t), t)
        if (!f) throw new Error(t + ' was not in the download.')
        fs.copyFileSync(f, path.join(bin, t))
        fs.chmodSync(path.join(bin, t), 0o755)
      }
    } else {
      throw new Error('Install ffmpeg with your package manager (e.g. apt install ffmpeg).')
    }
    report({ step: 'Checking it runs…', percent: null })
    await run(j, path.join(bin, 'ffprobe' + EXE), ['-version'])
  } finally {
    rmrf(tmp)
  }
}

// ---- whisper ----
// A Python 3.9–3.13 (faster-whisper's wheels) to make the venv from.
async function findPython(j) {
  const cands = []
  if (isWin) {
    for (const v of ['3.12', '3.11', '3.13', '3.10']) cands.push(['py', ['-' + v]])
    const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python')
    for (const v of ['312', '311', '313', '310']) cands.push([path.join(local, 'Python' + v, 'python.exe'), []])
    cands.push(['python', []], ['python3', []])
  } else {
    for (const v of ['3.12', '3.11', '3.13', '3.10', '3.9']) {
      cands.push([`/opt/homebrew/bin/python${v}`, []], [`/usr/local/bin/python${v}`, []], [`/Library/Frameworks/Python.framework/Versions/${v}/bin/python3`, []])
    }
    cands.push(['/opt/homebrew/bin/python3', []], ['/usr/local/bin/python3', []])
    // Apple's own python3 — but without the command line tools installed,
    // running it pops up an installer instead.
    const hasClt = await run(j, 'xcode-select', ['-p']).then(() => true, () => false)
    if (hasClt) cands.push(['/usr/bin/python3', []])
  }
  for (const [cmd, args] of cands) {
    if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) continue
    const out = await run(j, cmd, [...args, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])']).catch(() => null)
    const m = out && /(\d+)\.(\d+)/.exec(out)
    if (m && +m[1] === 3 && +m[2] >= 9 && +m[2] <= 13) return { cmd, args, version: m[0] }
  }
  const err = new Error(
    isMac
      ? 'Transcription needs Python 3 (3.9 to 3.13). Install Python 3.12 from python.org, or run "brew install python@3.12" in Terminal, then try again.'
      : 'Transcription needs Python 3 (3.9 to 3.13). Install Python 3.12 from python.org (tick "Add python.exe to PATH"), then try again.'
  )
  err.needPython = true
  throw err
}

async function installWhisper(_opts, report, j) {
  report({ step: 'Looking for Python…', percent: null })
  const py = await findPython(j)
  const g = await gpu()
  const cuda = isWin && g.nvidia
  const venv = path.join(WHISPER_HOME, 'venv')
  report({ step: `Setting up Python ${py.version}…`, percent: null })
  rmrf(WHISPER_MARK)
  rmrf(venv)
  fs.mkdirSync(WHISPER_HOME, { recursive: true })
  await run(j, py.cmd, [...py.args, '-m', 'venv', venv])
  const pip = (args, step) => {
    report({ step, percent: null })
    return run(j, VENV_PYTHON, ['-m', 'pip', ...args, '--disable-pip-version-check', '--no-input'], { onLine: (l) => report({ detail: l.slice(0, 140) }) })
  }
  await pip(['install', '--upgrade', 'pip'], 'Updating pip…')
  const pkgs = ['faster-whisper==1.2.1']
  if (cuda) pkgs.push('nvidia-cublas-cu12==12.9.*', 'nvidia-cudnn-cu12==9.*')
  await pip(['install', ...pkgs], cuda ? 'Installing faster-whisper + NVIDIA libraries (about 1.5 GB)…' : 'Installing faster-whisper…')
  // The model (~1.6 GB) now, with progress, instead of on the first transcript.
  report({ step: 'Downloading the Whisper model (about 1.6 GB)…', percent: 0 })
  const models = path.join(WHISPER_HOME, 'models')
  await run(j, VENV_PYTHON, ['-c', `from faster_whisper.utils import download_model; download_model(${JSON.stringify(WHISPER_MODEL)}, cache_dir=${JSON.stringify(models)})`], {
    env: { PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1' },
    onLine: (l) => {
      const m = /(\d{1,3})%\|/.exec(l)
      if (m) report({ percent: +m[1], detail: l.replace(/\|[^|]*\|/, ' ').slice(0, 140) })
    },
  })
  fs.writeFileSync(WHISPER_MARK, JSON.stringify({ v: 1, device: cuda ? 'cuda' : 'cpu', model: WHISPER_MODEL, python: py.version, at: Date.now() }))
}

// ---- llm ----
async function installLlm(opts, report, j) {
  const g = await gpu()
  const model = LLM_MODELS[opts.model] || LLM_MODELS[recommendLlm(g)]
  const bin = path.join(LLM_HOME, 'bin')
  const server = path.join(bin, 'llama-server' + EXE)
  const tmp = path.join(LLM_HOME, 'tmp')
  rmrf(tmp)
  try {
    if (!fs.existsSync(server) || opts.reinstallServer) {
      const assets = isMac
        ? [`llama-${LLAMA_BUILD}-bin-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`]
        : isWin
          ? g.nvidia
            ? [`llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`, 'cudart-llama-bin-win-cuda-12.4-x64.zip']
            : [`llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`]
          : null
      if (!assets) throw new Error('AI summaries are set up automatically on Windows and macOS only.')
      const parts = []
      for (const [i, a] of assets.entries()) {
        const file = path.join(tmp, a)
        await download(j, llamaUrl(a), file, report, `Downloading llama.cpp${assets.length > 1 ? ` (${i + 1} of ${assets.length})` : ''}`)
        report({ step: 'Unpacking…', percent: null })
        const dir = path.join(tmp, 'x' + i)
        await extract(j, file, dir)
        parts.push(dir)
      }
      const found = findFile(parts[0], 'llama-server' + EXE)
      if (!found) throw new Error('llama-server was not in the download.')
      const home = path.dirname(found)
      // The CUDA runtime DLLs go next to llama-server.
      for (const extra of parts.slice(1)) {
        for (const e of fs.readdirSync(extra)) if (!fs.statSync(path.join(extra, e)).isDirectory()) fs.copyFileSync(path.join(extra, e), path.join(home, e))
      }
      if (!isWin) for (const e of fs.readdirSync(home)) try { fs.chmodSync(path.join(home, e), 0o755) } catch { /* not ours */ }
      rmrf(bin)
      fs.renameSync(home, bin)
    }
    const dest = path.join(LLM_HOME, 'models', model.file)
    if (!fs.existsSync(dest)) await download(j, model.url, dest, report, `Downloading ${model.label}`)
    fs.writeFileSync(path.join(LLM_HOME, 'config.json'), JSON.stringify({ model: model.file }))
  } finally {
    rmrf(tmp)
  }
}
