// Local summaries of transcript selections: llama.cpp's llama-server (CUDA
// build) running Qwen3-14B on the GPU, from ~/.bijou-footage/llm (outside
// %APPDATA% for the same reason as Whisper — see transcribe.js).
//
// The server is started on the first request and kept warm; it exits after
// IDLE_MS unused so its ~14 GB of graphics memory is given back. Summaries
// stream: each piece of text is sent to the window as it's generated.
import fs from 'fs'
import os from 'os'
import net from 'net'
import path from 'path'
import { spawn } from 'child_process'

export const LLM_HOME = path.join(os.homedir(), '.bijou-footage', 'llm')
const SERVER = path.join(LLM_HOME, 'bin', 'llama-server.exe')
const MODEL = path.join(LLM_HOME, 'models', 'Qwen3-14B-Q4_K_M.gguf')
// Tokens the model sees at once. 16k with a q8 KV cache keeps the whole
// thing around 11 GB of graphics memory, so it still fits with Premiere /
// After Effects open; longer selections are summarized in parts.
const CTX = 16384
const IDLE_MS = 10 * 60 * 1000
const CHUNK_CHARS = 36000 // ~10k tokens of transcript per pass (fits CTX with the prompt + answer)

let emit = () => {}
let server = null // {proc, port, ready: Promise}
let idleTimer = null
let busy = 0

export function initLlm(onEvent) {
  emit = onEvent
}

export function installed() {
  return fs.existsSync(SERVER) && fs.existsSync(MODEL)
}

export function shutdown() {
  if (server) try { server.proc.kill() } catch { /* gone */ }
  server = null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

async function ensureServer() {
  clearTimeout(idleTimer)
  if (server) return server.ready
  const port = await freePort()
  // No -ngl: --fit puts as many layers on the GPU as there's room for (the
  // rest run on the CPU) instead of overflowing graphics memory, which
  // Windows would page to system RAM and make everything crawl.
  const proc = spawn(SERVER, ['-m', MODEL, '-c', String(CTX), '-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0', '--fit', 'on', '--host', '127.0.0.1', '--port', String(port), '--jinja'], {
    cwd: path.dirname(SERVER),
    windowsHide: true
  })
  let log = ''
  proc.stderr.on('data', (d) => { log = (log + d.toString()).slice(-3000) })
  proc.stdout.on('data', (d) => { log = (log + d.toString()).slice(-3000) })
  const s = { proc, port }
  server = s
  proc.on('exit', () => { if (server === s) server = null })
  s.ready = (async () => {
    for (let i = 0; i < 240; i++) {
      if (server !== s) throw new Error('The summarizer stopped while loading: ' + (log.trim().split('\n').pop() || 'unknown error'))
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`)
        if (r.ok) return s
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('The summarizer took too long to load.')
  })()
  return s.ready
}

function scheduleIdle() {
  clearTimeout(idleTimer)
  if (!busy) idleTimer = setTimeout(shutdown, IDLE_MS)
}

const SYSTEM = `You summarize sections of transcripts from long gaming recording sessions (friends playing together, talking over voice chat). A YouTuber reviews these to find moments for videos.

Write:
1. One or two sentences on what happens overall in this section.
2. Then 3–8 short bullet points of the key moments, in order, each starting with its timestamp in square brackets exactly as it appears in the transcript, e.g. [1:02:03].

Refer to people by the speaker names given. Call out anything funny, dramatic, surprising or a good story beat. Be concise and concrete — no filler, no preamble, no closing remarks. The transcript is automatic and may contain mistakes; don't mention that.`

async function complete(s, messages, id, stream) {
  const res = await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: 900,
      stream,
      chat_template_kwargs: { enable_thinking: false }
    })
  })
  if (!res.ok) throw new Error('Summarizer error ' + res.status + ': ' + (await res.text()).slice(0, 300))
  if (!stream) {
    const j = await res.json()
    return cleanup(j.choices[0].message.content || '')
  }
  // Server-sent events: "data: {...}\n\n" … "data: [DONE]"
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const piece = JSON.parse(data).choices[0].delta.content
        if (piece) {
          text += piece
          emit({ type: 'text', id, text: cleanup(text) })
        }
      } catch { /* keep-alive etc. */ }
    }
  }
  return cleanup(text)
}

// Qwen3 may still emit an (empty) thinking block; never show it.
const cleanup = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart()

// lines: [{t: '1:02:03', who: 'Bijou', text}], title: e.g. the recording.
export async function summarize(id, { lines, title }) {
  if (!installed()) throw new Error("The summarizer isn't installed yet (~/.bijou-footage/llm).")
  busy++
  try {
    emit({ type: 'status', id, status: server ? 'thinking' : 'loading' })
    const s = await ensureServer()
    emit({ type: 'status', id, status: 'thinking' })
    const body = lines.map((l) => `[${l.t}] ${l.who}: ${l.text}`).join('\n')
    const head = `Recording: ${title}\nSection: ${lines[0].t} – ${lines[lines.length - 1].t}\n\nTranscript:\n`
    let text
    if (body.length <= CHUNK_CHARS) {
      text = await complete(s, [{ role: 'system', content: SYSTEM }, { role: 'user', content: head + body }], id, true)
    } else {
      // Too long for one pass: summarize each part, then combine the notes.
      const parts = []
      let cur = ''
      for (const ln of body.split('\n')) {
        if (cur.length + ln.length > CHUNK_CHARS && cur) { parts.push(cur); cur = '' }
        cur += ln + '\n'
      }
      if (cur) parts.push(cur)
      const notes = []
      for (let i = 0; i < parts.length; i++) {
        emit({ type: 'status', id, status: `reading part ${i + 1} of ${parts.length}` })
        notes.push(await complete(s, [{ role: 'system', content: SYSTEM }, { role: 'user', content: head + parts[i] }], id, false))
      }
      emit({ type: 'status', id, status: 'thinking' })
      text = await complete(
        s,
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: head + 'This section was long, so here are summaries of its consecutive parts. Combine them into one summary in the same format (keep the most important moments and their timestamps):\n\n' + notes.join('\n\n---\n\n') }
        ],
        id,
        true
      )
    }
    emit({ type: 'done', id, text })
    return text
  } catch (e) {
    emit({ type: 'error', id, message: String(e.message || e) })
    throw e
  } finally {
    busy--
    scheduleIdle()
  }
}
