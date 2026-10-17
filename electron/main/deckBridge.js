// The Stream Deck plugin's line to the app (streamdeck/ in this repo), the
// same way BijouHub does it: line-delimited JSON over a TCP socket on
// 127.0.0.1 only. The plugin asks ({type, id, …} → {type: 'reply', id, …}),
// and the app pushes {type: 'state', …} whenever what a key shows changes
// (recording, the POVs, which view is big, the workspace).
//
// The renderer owns all of that: it sends its state here (deck:state) and
// runs what a key asks for (deck:command). This file only carries it.
//
// deck-bridge.json in the data folder tells the plugin the port and where
// the app is, so a key can start Bijou Footage when it isn't running.
import net from 'net'
import fs from 'fs'
import path from 'path'

export const DECK_PORT = 47824 // BijouHub's is 47823

let server = null
const clients = new Set()
let lastState = null
let nextCmd = 1
const waiting = new Map() // command id -> {socket, id}

export function startDeckBridge({ dataDir, exePath, sendToRenderer, focusWindow }) {
  try {
    fs.writeFileSync(path.join(dataDir, 'deck-bridge.json'), JSON.stringify({ port: DECK_PORT, exePath }, null, 1))
  } catch { /* the data folder is read-only? the plugin falls back to the default port */ }
  server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    clients.add(socket)
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        handle(socket, msg, sendToRenderer, focusWindow)
      }
    })
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => {})
  })
  // A second copy of the app (a dev build next to the installed one) can't
  // have the port too — the first one keeps the deck.
  server.on('error', () => { server = null })
  server.listen(DECK_PORT, '127.0.0.1')
}

function write(socket, obj) {
  if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n')
}

function handle(socket, msg, sendToRenderer, focusWindow) {
  if (msg.type === 'state') return write(socket, { type: 'reply', id: msg.id, ...(lastState || { ready: false }) })
  // BijouDocs' Footage tab opening a note: come to the front for it.
  if (msg.type === 'open' && focusWindow) focusWindow()
  // anything else is something for the app to do (or a list it knows)
  const cid = nextCmd++
  waiting.set(cid, { socket, id: msg.id })
  setTimeout(() => {
    const w = waiting.get(cid)
    if (!w) return
    waiting.delete(cid)
    write(w.socket, { type: 'reply', id: w.id, error: 'Bijou Footage didn’t answer' })
  }, 5000)
  sendToRenderer('deck:command', { cid, ...msg })
}

// The renderer answers a command.
export function deckReply(cid, result) {
  const w = waiting.get(cid)
  if (!w) return
  waiting.delete(cid)
  write(w.socket, { type: 'reply', id: w.id, ...(result || {}) })
}

// The renderer's state changed: every key that cares redraws.
export function deckState(state) {
  lastState = state
  for (const s of clients) write(s, { type: 'state', ...state })
}

export function stopDeckBridge() {
  for (const s of clients) s.destroy()
  if (server) server.close()
}
