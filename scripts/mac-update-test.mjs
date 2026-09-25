// Mac update + tidiness test (used by .github/workflows/mac-test.yml).
//   node scripts/mac-update-test.mjs <new version> <out dir>
// Expects: an older build installed at /Applications/Bijou Footage.app,
// running with BIJOU_UPDATE_FEED pointing at a folder that serves the newer
// build's latest-mac.yml + zip, and --remote-debugging-port=9223.
// Checks: it finds + downloads the update, "Restart to update" swaps the app
// in /Applications and reopens it, and no download / temp folder / disk
// image is left behind.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

const WANT = process.argv[2]
const OUT = path.resolve(process.argv[3] || 'update-out')
fs.mkdirSync(OUT, { recursive: true })
const APP = '/Applications/Bijou Footage.app'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const plistVersion = () => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(APP, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}  ${detail ? JSON.stringify(detail) : ''}`) }

// ---- CDP ----
let ws
let id = 1
const pending = new Map()
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9223/json')).json()
    const t = list.find((x) => x.type === 'page')
    if (t) {
      ws = new WebSocket(t.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    }
  } catch { /* not up */ }
  if (!ws) await wait(1000)
}
if (!ws) { console.log('FAIL  app never opened'); process.exit(1) }
ws.onmessage = (ev) => { const d = JSON.parse(ev.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); p(d.result) } }
const js = (expr) => new Promise((res) => { const i = id++; pending.set(i, (r) => res(r && r.result && r.result.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } })) })

const before = plistVersion()
check('old version installed', before !== WANT, { before })

// The app checks 8 s after opening; watch its status until it's ready.
const st = await js(`
  const seen = []
  let last = null
  await new Promise((resolve) => {
    const off = window.footage.onUpdateStatus((s) => { last = s; seen.push(s.state + (s.percent != null ? ' ' + s.percent + '%' : '')); if (s.state === 'ready' || s.state === 'error' || s.state === 'available-manual' || s.state === 'up-to-date') { off(); resolve() } })
    setTimeout(resolve, 180000)
  })
  return { last, seen: seen.filter((x, i) => seen.indexOf(x) === i).slice(-8) }
`)
check('finds and downloads the update', st && st.last && st.last.state === 'ready' && st.last.version === WANT, st)
const tmpDownloads = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('bijou-footage-update-'))
check('the download waits in one temp folder', tmpDownloads().length === 1, tmpDownloads())

// Restart to update
js('window.footage.installUpdate()').catch(() => {})
let now = before
for (let i = 0; i < 120; i++) {
  await wait(1000)
  try { now = plistVersion() } catch { /* mid-swap */ }
  if (now === WANT) break
}
check('the app in /Applications is the new version', now === WANT, { now })
await wait(6000)
const running = (() => { try { return execFileSync('pgrep', ['-fl', 'Bijou Footage.app/Contents/MacOS/Bijou Footage'], { encoding: 'utf8' }).trim() } catch { return '' } })()
check('it reopened', running.length > 0, running.split('\n')[0])
check('no update files left in temp', tmpDownloads().length === 0, tmpDownloads())
const vols = fs.readdirSync('/Volumes').filter((v) => v.startsWith('Bijou Footage'))
check('no Bijou Footage disk images mounted', vols.length === 0, vols)
check('no leftover old copy', !fs.existsSync(path.join(path.dirname(APP), 'Bijou Footage 2.app')) && fs.readdirSync('/Applications').filter((a) => a.startsWith('Bijou Footage')).length === 1, fs.readdirSync('/Applications').filter((a) => a.startsWith('Bijou')))

fs.writeFileSync(path.join(OUT, 'update-results.json'), JSON.stringify(results, null, 2))
try { execFileSync('pkill', ['-f', 'Bijou Footage.app/Contents/MacOS/Bijou Footage']) } catch { /* gone */ }
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
