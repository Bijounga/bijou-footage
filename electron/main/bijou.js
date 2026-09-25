// Sends footage beats into a BijouDocs script's mind map — the same on-disk
// contract the Beat Notes Premiere panel uses: read the script's JSON, only
// ever ADD idea nodes/edges to its mapLayout, write it back. BijouDocs'
// folder watcher picks the change up live if the script is open.
import fs from 'fs'
import path from 'path'
import os from 'os'

const NODE_W = 220
const ROW_GAP = 190
const COL_GAP = 320

const TITLE = { SETUP: 'Setup', AND_THEN: 'And Then', BECAUSE: 'Because', BUT: 'But', THEREFORE: 'Therefore', NOTE: 'Note' }

function bijouSettings() {
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  try {
    return JSON.parse(fs.readFileSync(path.join(base, 'bijoudocs', 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

// BijouDocs' custom color themes ([{id, name, colors}]) — offered in our
// Theme settings alongside its built-in ones.
export function customThemes() {
  const list = bijouSettings().customThemes
  return Array.isArray(list) ? list : []
}

export function storageDir() {
  return bijouSettings().storageDir || path.join(os.homedir(), 'Documents', 'BijouDocs')
}

// Beat Notes keeps the user's chosen beat colors here; reusing them keeps
// footage beats visually identical to ones made in Premiere.
export function beatColors() {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.beatnotes', 'prefs.json'), 'utf8')).colors || {}
  } catch {
    return {}
  }
}

function isHistoryFile(f) {
  return f.includes('.conflict-') || f.includes('.snapshot-')
}

export function listScripts() {
  const dir = storageDir()
  let files
  try {
    files = fs.readdirSync(dir)
  } catch {
    return { dir, scripts: [] }
  }
  const scripts = []
  for (const f of files) {
    if (!f.endsWith('.json') || isHistoryFile(f)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (raw && raw.id && Array.isArray(raw.sections)) {
        scripts.push({ id: raw.id, title: raw.title || 'Untitled', file: path.join(dir, f), updatedAt: raw.updatedAt || 0 })
      }
    } catch {
      /* partial/unreadable file — skip */
    }
  }
  scripts.sort((a, b) => b.updatedAt - a.updatedAt)
  return { dir, scripts }
}

function makeId() {
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function resolveColor(type, presets, colors) {
  if (type === 'BUT' || type === 'THEREFORE') {
    const want = TITLE[type].toLowerCase()
    const p = presets.find((x) => (x.label || '').toLowerCase() === want && x.color)
    if (p) return p.color
  }
  return colors[type] || null
}

function fmt(t) {
  t = Math.max(0, Math.floor(t))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0')
}

// beats: [{type, text, clipName, clipPath, t, end}] in story order, with
// {type:'BREAK'} entries between chains.
export function exportBeats({ targetId, newTitle, beats, includeSource }) {
  const dir = storageDir()
  fs.mkdirSync(dir, { recursive: true })
  let file
  let raw
  if (targetId) {
    const found = listScripts().scripts.find((s) => s.id === targetId)
    if (!found) throw new Error("That script isn't on disk anymore — it may have been deleted.")
    file = found.file
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else {
    raw = {
      id: makeId(),
      title: newTitle || 'Footage notes',
      updatedAt: Date.now(),
      sections: [{ id: makeId(), heading: 'Notes', lines: [] }],
      mapLayout: { nodes: {}, edges: [], mainThreadId: null, hideSummaries: false }
    }
    file = path.join(dir, raw.id + '.json')
  }
  raw.mapLayout = raw.mapLayout || {}
  raw.mapLayout.nodes = raw.mapLayout.nodes || {}
  raw.mapLayout.edges = raw.mapLayout.edges || []

  // New chains go in fresh columns to the right of everything already on
  // the map, so an export never lands on top of existing nodes.
  const existing = Object.values(raw.mapLayout.nodes)
  let x = existing.length ? Math.max(...existing.map((n) => (n.x || 0) + (n.width || NODE_W))) + COL_GAP / 2 : 60
  const top = existing.length ? Math.min(...existing.map((n) => n.y || 0)) : 60
  let y = top

  const presets = Array.isArray(bijouSettings().ideaNodePresets) ? bijouSettings().ideaNodePresets : []
  const colors = beatColors()
  let prev = null
  let first = null
  let count = 0
  const now = Date.now()
  for (const b of beats) {
    if (b.type === 'BREAK') {
      if (prev) {
        x += NODE_W + COL_GAP / 2
        y = top
      }
      prev = null
      continue
    }
    const id = makeId() + count
    let text = (b.text || '').trim()
    if (includeSource && b.clipName) {
      const at = fmt(b.t) + (b.end != null ? '–' + fmt(b.end) : '')
      text = (text ? text + '\n' : '') + '[' + b.clipName.replace(/\.[^.]+$/, '') + ' @ ' + at + ']'
    }
    raw.mapLayout.nodes[id] = {
      x,
      y,
      collapsed: false,
      type: 'idea',
      title: TITLE[b.type] || b.type,
      text,
      color: resolveColor(b.type, presets, colors),
      importedFrom: 'bijou-footage',
      importedAt: now,
      source: { path: b.clipPath, t: b.t, end: b.end ?? null }
    }
    if (prev) raw.mapLayout.edges.push({ id: makeId() + 'e' + count, from: prev, to: id })
    if (!first) first = id
    prev = id
    y += ROW_GAP
    count++
  }
  if (!raw.mapLayout.mainThreadId && first) raw.mapLayout.mainThreadId = first
  raw.updatedAt = Date.now()
  fs.writeFileSync(file + '.tmp', JSON.stringify(raw, null, 2), 'utf8')
  fs.renameSync(file + '.tmp', file)
  return { id: raw.id, title: raw.title, count, file }
}
