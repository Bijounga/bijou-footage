// Dev-only: attach to the running app over CDP, print every page error and
// console.error for N seconds while you (or a script) use it.
//   node scripts/cdp-watch.mjs 60
const PORT = Number(process.env.CDP_PORT) || 9223
const secs = Number(process.argv[2]) || 30
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools') && x.url !== 'about:blank')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 1
const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }))
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    console.log('EXCEPTION:', (d.exception && d.exception.description) || d.text)
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    console.log(m.params.type.toUpperCase() + ':', m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 1500))
  }
})
send('Runtime.enable')
setTimeout(() => process.exit(0), secs * 1000)
