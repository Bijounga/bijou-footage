// Dev-only helper: drives/inspects the running Electron renderer over the
// Chrome DevTools Protocol instead of OS-level mouse automation (which is
// fragile across multi-monitor setups and steals the user's real cursor).
// Usage:
//   node scripts/cdp.mjs eval "document.querySelector('.new-script-btn').click()"
//   node scripts/cdp.mjs screenshot out.png
//   node scripts/cdp.mjs keys '["hello", {"key":"Enter"}, {"key":"Enter","mods":["ctrl"]}]'
//     real keyboard input to whatever has focus: strings are typed,
//     {key, mods} are key presses (Enter, Backspace, Tab, ArrowUp, …)
'use strict'

const PORT = 9223

async function findTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  return list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', reject)
  })
}

let msgId = 1
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++
    function onMsg(ev) {
      const data = JSON.parse(ev.data)
      if (data.id === id) {
        ws.removeEventListener('message', onMsg)
        if (data.error) reject(new Error(JSON.stringify(data.error)))
        else resolve(data.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function main() {
  const [, , cmd, arg] = process.argv
  const target = await findTarget()
  if (!target) {
    console.error('No renderer target found on port', PORT)
    process.exit(1)
  }
  const ws = await connect(target.webSocketDebuggerUrl)

  if (cmd === 'eval') {
    const result = await send(ws, 'Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true })
    console.log(JSON.stringify(result, null, 2))
  } else if (cmd === 'screenshot') {
    await send(ws, 'Page.enable')
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const fs = await import('fs')
    fs.writeFileSync(arg || 'screenshot.png', Buffer.from(shot.data, 'base64'))
    console.log('saved to', arg || 'screenshot.png')
  } else if (cmd === 'keys') {
    const CODES = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }
    const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
    for (const step of JSON.parse(arg)) {
      if (typeof step === 'string') {
        for (const ch of step) {
          await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
          await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
        }
        continue
      }
      const modifiers = (step.mods || []).reduce((a, m) => a | MODS[m], 0)
      const code = CODES[step.key] || 0
      const text = step.key === 'Enter' && !modifiers ? String.fromCharCode(13) : undefined
      await send(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: step.key, code: step.key, windowsVirtualKeyCode: code, modifiers })
      if (text) await send(ws, 'Input.dispatchKeyEvent', { type: 'char', key: step.key, text, modifiers })
      await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: step.key, code: step.key, windowsVirtualKeyCode: code, modifiers })
    }
    console.log('ok')
  } else {
    console.error('Unknown command. Use "eval <expr>" or "screenshot <path>".')
  }
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
