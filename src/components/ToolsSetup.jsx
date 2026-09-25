// Settings → Tools: install ffmpeg, the transcriber and AI summaries from
// inside the app (electron/main/setup.js), with progress. Also the banner
// that asks for ffmpeg when it's missing (a new Mac, a new PC).
import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store.js'

// One listener for install progress, shared by whoever shows it.
let progress = {} // what -> {state, step, percent, detail, message}
const subs = new Set()
let started = false
function start() {
  if (started || !window.footage.onSetupEvent) return
  started = true
  window.footage.onSetupEvent((ev) => {
    const prev = progress[ev.what] || {}
    progress = { ...progress, [ev.what]: ev.state === 'running' ? { ...prev, ...ev, ...(ev.step ? { detail: ev.detail || '' } : {}) } : ev }
    subs.forEach((f) => f(progress))
    if (ev.state === 'done') afterInstall(ev.what)
  })
}
function useProgress() {
  const [p, set] = useState(progress)
  useEffect(() => {
    start()
    subs.add(set)
    return () => subs.delete(set)
  }, [])
  return p
}

// What changes once a tool is in.
async function afterInstall(what) {
  const st = useStore.getState()
  if (what === 'ffmpeg') {
    const tools = await window.footage.toolsStatus(st.settings.ffmpegDir || null)
    useStore.setState({ tools: { ...tools, checked: true } })
    st.rescan() // recordings found without ffprobe get read properly now
  }
  st.showToast({ ffmpeg: 'ffmpeg is installed.', whisper: 'Transcription is set up.', llm: 'AI summaries are set up.' }[what])
}

const GB = (b) => (b / 2 ** 30).toFixed(1) + ' GB'

export function ToolsSection() {
  const [s, setS] = useState(null)
  const p = useProgress()
  const running = Object.values(p).some((x) => x.state === 'running')
  const [model, setModel] = useState(null)
  const refresh = () => window.footage.setupStatus().then(setS)
  useEffect(() => { refresh() }, [])
  useEffect(() => { if (!running) refresh() }, [running])
  if (!s) return null
  const mac = s.platform === 'darwin'
  const install = (what, opts) => window.footage.setupInstall(what, opts)
  const chosen = model || (s.llm.installed ? Object.keys(s.llmModels).find((k) => s.llmModels[k].file === s.llm.model) : null) || s.recommend
  const whisperSize = s.gpu.nvidia ? 'about 3 GB' : 'about 1.8 GB'
  const llamaNote = mac ? 'runs on the Mac’s GPU (Metal)' : s.gpu.nvidia ? `NVIDIA GPU, ${s.gpu.vramGB} GB` : 'GPU via Vulkan'

  return (
    <section className="tools-setup">
      <h3>Tools</h3>
      <ToolRow
        name="ffmpeg"
        what="Reads your recordings, builds waveforms and prepares audio. Needed."
        ok={!!(s.ffmpeg.path && s.ffmpeg.ffprobe)}
        okText={s.ffmpeg.managed ? 'Installed' : 'Found on this computer'}
        p={p.ffmpeg}
        busy={running}
        action={`Install ffmpeg (${mac ? 'about 60 MB' : 'about 110 MB'})`}
        onInstall={() => install('ffmpeg')}
        reinstallText={s.ffmpeg.managed ? null : 'Install its own copy'}
      />
      <ToolRow
        name="Transcription"
        what={`Whisper, on this computer — ${s.gpu.nvidia ? 'on your NVIDIA GPU' : mac ? 'on the Mac’s CPU (slower than a PC with an NVIDIA card, still faster than real time)' : 'on the CPU'}.`}
        ok={s.whisper.installed}
        okText={'Set up · ' + (s.whisper.device === 'cuda' ? 'GPU' : 'CPU')}
        p={p.whisper}
        busy={running}
        action={`Set up transcription (${whisperSize})`}
        onInstall={() => install('whisper')}
      />
      <ToolRow
        name="AI summaries"
        what={`A local AI model that summarizes transcript selections (${llamaNote}). Nothing leaves your computer.`}
        ok={s.llm.installed}
        okText={'Set up · ' + (s.llm.model || '').replace(/-Q4_K_M\.gguf$/, '')}
        p={p.llm}
        busy={running}
        action={`Set up AI summaries (${GB(s.llmModels[chosen].bytes)})`}
        onInstall={() => install('llm', { model: chosen })}
        extra={
          <label className="inline small tools-model">
            Model
            <select value={chosen} onChange={(e) => setModel(e.target.value)} disabled={running}>
              {Object.entries(s.llmModels).map(([k, m]) => (
                <option key={k} value={k}>{m.label} · {GB(m.bytes)}{k === s.recommend ? ' — best fit here' : ''}</option>
              ))}
            </select>
          </label>
        }
        reinstallText={s.llm.installed && chosen && s.llmModels[chosen].file !== s.llm.model ? `Switch to ${s.llmModels[chosen].label}` : null}
      />
      <p className="dim small">Everything is saved in <code>~/.bijou-footage</code>, outside the app, so updates and reinstalls keep it.</p>
    </section>
  )
}

function ToolRow({ name, what, ok, okText, p, busy, action, onInstall, extra, reinstallText }) {
  const run = p && p.state === 'running'
  const failed = p && (p.state === 'error' || p.state === 'cancelled')
  return (
    <div className={'tool-row' + (ok ? ' ok' : '')}>
      <div className="tool-head">
        <span className={'tool-dot' + (ok ? ' ok' : '')} />
        <b>{name}</b>
        {ok && !run && <span className="dim small">{okText}</span>}
        <span className="grow" />
        {!run && !ok && <button className="btn small primary" disabled={busy} onClick={onInstall}>{action}</button>}
        {!run && ok && (
          <button className="link-btn" disabled={busy} onClick={onInstall} title="Download and install it again">{reinstallText || 'Reinstall'}</button>
        )}
        {run && <button className="btn small ghost" onClick={() => window.footage.setupCancel()}>Cancel</button>}
      </div>
      <div className="dim small tool-what">{what}</div>
      {extra && !run && <div className="tool-extra">{extra}</div>}
      {run && (
        <div className="tool-progress">
          <div className="tool-step small">{p.step}</div>
          <div className="tool-bar"><span className={p.percent == null ? 'indet' : ''} style={p.percent == null ? undefined : { width: Math.max(1, p.percent) + '%' }} /></div>
          {p.detail && <div className="dim small tool-detail">{p.detail}</div>}
        </div>
      )}
      {failed && (
        <div className="tool-error small">
          {p.message}
          {/Python/.test(p.message || '') && <> <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">python.org/downloads</a></>}
        </div>
      )}
    </div>
  )
}

// Shown when ffmpeg is missing: without it recordings can't be read.
export function ToolsBanner() {
  const tools = useStore((s) => s.tools)
  const modal = useStore((s) => s.modal) // not over Settings etc.
  const [hidden, setHidden] = useState(false)
  if (hidden || modal || !tools || !tools.checked || (tools.ffmpeg && tools.ffprobe)) return null
  return (
    <div className="cache-reminder tools-banner">
      <span className="cr-icon">⚠</span>
      <span className="cr-text">Bijou Footage needs <b>ffmpeg</b> to read your recordings and draw waveforms.</span>
      <button className="btn small primary" onClick={() => useStore.getState().openModal('settings')}>Set it up…</button>
      <button className="icon-btn small" onClick={() => setHidden(true)} title="Hide for now">×</button>
    </div>
  )
}
