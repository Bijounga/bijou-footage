// End-to-end test of a packaged build, used by .github/workflows/mac-test.yml
// on GitHub's macOS machines (also runs on Windows). Drives the running app
// over the DevTools protocol (port 9223) the same way scripts/cdp.mjs does:
//   1. the app opens and loads
//   2. Tools: installs ffmpeg, then reads a test recording made with it
//      (picture + two audio tracks: speech from macOS `say`, and a tone)
//   3. Review: the recording plays
//   4. Edit: a section with a cut plays across the cut
//   5. Tools: installs transcription (tiny model) and transcribes the speech
//   6. Tools: installs AI summaries (tiny model) and summarizes it
// Writes screenshots + results.json to OUT and exits non-zero if a required
// step failed.
//   node scripts/mac-smoke.mjs <out dir> <work dir>
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const OUT = path.resolve(process.argv[2] || 'smoke-out')
const WORK = path.resolve(process.argv[3] || 'smoke-work')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(WORK, { recursive: true })
const PORT = 9223
const results = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
let msgId = 1
const pending = new Map()
async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools'))
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        ws.onmessage = (ev) => {
          const d = JSON.parse(ev.data)
          const p = pending.get(d.id)
          if (p) { pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result) }
        }
        return
      }
    } catch { /* not up yet */ }
    await wait(1000)
  }
  throw new Error('The app never opened a window.')
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = msgId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text)
  return r.result.value
}
async function shot(name) {
  try {
    await send('Page.enable')
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'))
  } catch (e) { console.log('screenshot failed', e.message) }
}
async function step(name, required, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, secs: Math.round((Date.now() - t0) / 1000), detail })
    console.log(`ok    ${name}  ${JSON.stringify(detail) || ''}`)
    return detail
  } catch (e) {
    results.push({ name, ok: false, required, secs: Math.round((Date.now() - t0) / 1000), error: String(e.message || e) })
    console.log(`${required ? 'FAIL' : 'warn'}  ${name}  ${e.message || e}`)
    await shot('fail-' + name.replace(/\W+/g, '-'))
    return null
  }
}
// Runs a setup install inside the app and waits for it.
const install = (what, opts) => js(`
  const log = []
  const off = window.footage.onSetupEvent((e) => { if (e.step) log.push(e.step); if (e.state !== 'running') log.push(e.state + (e.message ? ': ' + e.message : '')) })
  const ok = await window.footage.setupInstall(${JSON.stringify(what)}, ${JSON.stringify(opts || {})})
  off()
  if (!ok) throw new Error(log.slice(-3).join(' | '))
  return log.filter((x, i) => log.indexOf(x) === i)
`)

await connect()

await step('app opens and loads', true, async () => {
  for (let i = 0; i < 60; i++) { if (await js('return !!(window.__store && window.__store.getState().loaded)')) break; await wait(500) }
  await wait(1500)
  await shot('01-opened')
  return js('return { platform: window.footage.platform, version: await window.footage.appVersion(), mac: document.body.classList.contains("mac") }')
})

await step('Settings → Tools shows', true, async () => {
  const txt = await js(`window.__store.getState().openModal('settings'); await new Promise(r => setTimeout(r, 1000)); return document.querySelector('.tools-setup') && document.querySelector('.tools-setup').innerText`)
  await shot('02-tools')
  if (!txt) throw new Error('no Tools section')
  return txt.split('\n').slice(0, 6)
})

const ff = await step('install ffmpeg', true, async () => {
  const log = await install('ffmpeg')
  const s = await js('return (await window.footage.setupStatus()).ffmpeg')
  if (!s.managed || !s.ffprobe) throw new Error('not found after install: ' + JSON.stringify(s))
  return { log, ...s }
})

// A 40 s test recording: moving picture, track 1 speech, track 2 a tone.
const media = path.join(WORK, 'media')
const rec = path.join(media, '2026-01-02 12-00-00.mp4')
await step('make a test recording', true, async () => {
  if (!ff) throw new Error('needs ffmpeg')
  fs.mkdirSync(media, { recursive: true })
  const speech = path.join(WORK, 'speech.aiff')
  const sentence = 'This is a test of Bijou Footage on a Mac. We found the treasure behind the waterfall, and then the dragon attacked the castle.'
  if (process.platform === 'darwin') execFileSync('say', ['-o', speech, sentence])
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=40']
  if (fs.existsSync(speech)) args.push('-i', speech)
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=40')
  args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=40', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '120', '-c:a', 'aac', '-ar', '48000', '-af', 'apad', '-t', '40', rec)
  execFileSync(ff.path, args)
  return { bytes: fs.statSync(rec).size }
})

await step('the library reads it (ffprobe)', true, async () => {
  const r = await js(`
    const st = window.__store.getState()
    st.closeModal()
    st.updateSettings({ folders: [${JSON.stringify(media)}] })
    await st.rescan()
    for (let i = 0; i < 40; i++) {
      const c = window.__store.getState().clips.find((x) => x.name.endsWith('.mp4'))
      if (c && c.probe && c.probe.duration) return { name: c.name, duration: c.probe.duration, tracks: (c.probe.audio || []).length, video: c.probe.video && c.probe.video.codec }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('never probed')
  `)
  if (r.tracks !== 2) throw new Error('expected 2 audio tracks, got ' + r.tracks)
  return r
})

await step('Review: it plays', true, async () => {
  const r = await js(`
    const st = window.__store.getState()
    const c = st.clips.find((x) => x.name.endsWith('.mp4'))
    st.setWorkspace('review')
    await new Promise((r) => setTimeout(r, 800))
    st.openClip(c.key, 5)
    await new Promise((r) => setTimeout(r, 2500))
    const P = window.__player
    const t0 = P.getTime()
    await P.play()
    await new Promise((r) => setTimeout(r, 2500))
    const t1 = P.getTime()
    P.pause()
    return { t0, t1, readyState: P.video.readyState, w: P.video.videoWidth }
  `)
  await shot('03-review')
  if (!(r.t1 - r.t0 > 1.5) || r.readyState < 2) throw new Error('did not play: ' + JSON.stringify(r))
  return r
})

await step('Edit: a section with a cut plays across it', true, async () => {
  const r = await js(`
    const st = () => window.__store.getState()
    const c = st().clips.find((x) => x.name.endsWith('.mp4'))
    if (!st().settings.projectsDir) st().updateSettings({ projectsDir: ${JSON.stringify(path.join(WORK, 'projects'))} })
    st().createProject('Smoke test')
    st().addToProject(st().settings.currentProjectId, [c.key])
    await new Promise((r) => setTimeout(r, 1500)) // saved to its folder
    st().setWorkspace('edit')
    await new Promise((r) => setTimeout(r, 1500))
    st().createSection('Smoke')
    await new Promise((r) => setTimeout(r, 500))
    st().addToSection(c.key, 2, 8)
    st().addToSection(c.key, 20, 26)
    await new Promise((r) => setTimeout(r, 2000))
    const SP = window.__seq
    await SP.seek(4)
    await new Promise((r) => setTimeout(r, 1000))
    await SP.play()
    await new Promise((r) => setTimeout(r, 4000))
    const t = SP.getTime(), cur = SP.cur
    SP.stop()
    return { clips: st().currentSection() && st().currentSection().clips.length, t, cur }
  `)
  await shot('04-edit')
  if (!(r.t > 7 && r.cur === 1)) throw new Error('did not play across the cut: ' + JSON.stringify(r))
  return r
})

await step('install transcription (tiny model)', false, async () => {
  const log = await install('whisper')
  return { log, status: await js('return (await window.footage.setupStatus()).whisper') }
})

let transcript = null
await step('transcribe the speech track', false, async () => {
  transcript = await js(`
    const st = window.__store.getState()
    const c = st.clips.find((x) => x.name.endsWith('.mp4'))
    const slim = { key: c.key, size: c.size, path: c.path, probe: { audio: c.probe.audio, duration: c.probe.duration } }
    await window.footage.requestWaveform(c, true)
    await window.footage.requestTranscripts([{ clip: slim, track: 0 }], 'en', true)
    for (let i = 0; i < 600; i++) {
      const t = await window.footage.readTranscript(slim, 0)
      if (t) return t.segments.map((s) => s[2]).join(' ')
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('no transcript after 10 minutes')
  `)
  if (!/treasure|dragon|castle|waterfall/i.test(transcript)) throw new Error('unexpected text: ' + transcript)
  return transcript
})

if (!process.env.SMOKE_SKIP_LLM) await step('install AI summaries (tiny model)', false, async () => {
  const log = await install('llm', { model: 'test' })
  return { log, status: await js('return (await window.footage.setupStatus()).llm') }
})

if (!process.env.SMOKE_SKIP_LLM) await step('summarize the transcript', false, async () => {
  if (!transcript) throw new Error('needs the transcript')
  const r = await js(`
    let text = ''
    let done = null
    const off = window.footage.onLlmEvent((e) => { if (e.id !== 'smoke') return; if (e.text) text = e.text; if (e.type === 'done' || e.type === 'error') done = e })
    const res = await window.footage.summarize('smoke', { title: 'Smoke test', lines: [{ t: '0:01', who: 'Bijou', text: ${JSON.stringify(transcript || '')} }] })
    for (let i = 0; i < 300 && !done; i++) await new Promise((r) => setTimeout(r, 1000))
    off()
    if (done && done.type === 'error') throw new Error(done.message)
    return { text: text.slice(0, 400) }
  `)
  const out = JSON.stringify(r)
  if (!/treasure|dragon|castle|waterfall|test/i.test(out)) throw new Error('no summary: ' + out.slice(0, 300))
  return r
})

await shot('09-end')
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok && r.required)
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed${failed.length ? ' — required failures: ' + failed.map((r) => r.name).join(', ') : ''}`)
try { await js('window.close()') } catch { /* closing */ }
process.exit(failed.length ? 1 : 0)
