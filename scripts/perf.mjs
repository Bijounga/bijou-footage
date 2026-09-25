// Dev-only: measures the running renderer over CDP (port 9223).
//   node scripts/perf.mjs idle 5        — 5 s paused
//   node scripts/perf.mjs play 5        — 5 s playing
// Prints main-thread time spent in script / layout / style per second, heap,
// and the top self-time functions from a CPU profile.
'use strict'

const PORT = 9223
const [, , mode = 'idle', secsArg = '5'] = process.argv
const secs = Number(secsArg)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const my = id++
    const on = (ev) => {
      const d = JSON.parse(ev.data)
      if (d.id !== my) return
      ws.removeEventListener('message', on)
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result)
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
const evalJs = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })

await send('Performance.enable')
await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 200 })
if (mode === 'play') await evalJs('window.__player.play()')
await new Promise((r) => setTimeout(r, 500))
const m0 = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
await send('Profiler.start')
await evalJs(`(async()=>{window.__frames=0;let run=true;const f=()=>{window.__frames++;if(run)requestAnimationFrame(f)};requestAnimationFrame(f);await new Promise(r=>setTimeout(r,${secs * 1000}));run=false;return 1})()`)
const { profile } = await send('Profiler.stop')
const m1 = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const frames = (await evalJs('window.__frames')).result.value
if (mode === 'play') await evalJs('window.__player.pause()')

const per = (k) => (((m1[k] - m0[k]) * 1000) / secs).toFixed(1) + ' ms/s'
console.log(`mode=${mode} ${secs}s  fps=${(frames / secs).toFixed(0)}`)
console.log(`  task ${per('TaskDuration')}  script ${per('ScriptDuration')}  layout ${per('LayoutDuration')}  style ${per('RecalcStyleDuration')}`)
console.log(`  layouts ${((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(1)}/s  styleRecalcs ${((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs).toFixed(1)}/s  heap ${(m1.JSHeapUsedSize / 1e6).toFixed(0)} MB  nodes ${m1.Nodes}`)

// Self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i])
  const f = n.callFrame
  if (f.functionName === '(idle)' || f.functionName === '(program)') continue
  const k = `${f.functionName || '(anon)'}  ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`
  self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000)
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
for (const [k, ms] of top) console.log(`  ${(ms / secs).toFixed(2).padStart(7)} ms/s  ${k}`)
ws.close()
