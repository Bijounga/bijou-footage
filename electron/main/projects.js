// Projects on disk. You choose a projects folder once (Settings / first time
// you open Edit); every project is a folder in it:
//
//   <projects folder>/Omniwield/project.json        — name, its recordings,
//                                                     project notes (pad)
//   <projects folder>/Omniwield/sections/<id>.json  — one small file per
//                                                     edit section (the cut)
//
// Footage is only ever referenced (by path), never copied. Deleting a
// project or section sends its folder/file to the Recycle Bin.
import fs from 'fs'
import path from 'path'
import { shell } from 'electron'

const safeName = (name) => (String(name || 'Project').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Project')

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1), 'utf8')
  fs.renameSync(file + '.tmp', file)
}

function uniqueDir(dir, base) {
  let p = path.join(dir, base)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})`)
  return p
}

export function listProjects(dir) {
  const out = []
  let names = []
  try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const d of names) {
    if (!d.isDirectory()) continue
    const folder = path.join(dir, d.name)
    try {
      const p = JSON.parse(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'))
      out.push({ id: p.id, name: p.name, clipKeys: p.clipKeys || [], bijouScriptId: p.bijouScriptId || null, createdAt: p.createdAt || 0, pad: p.pad || null, folder })
    } catch { /* not a project folder */ }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

// Writes project.json; creates the folder on first save and renames it
// when the project is renamed. Returns the (possibly new) folder.
export function saveProject(dir, p) {
  fs.mkdirSync(dir, { recursive: true })
  let folder = p.folder && fs.existsSync(p.folder) ? p.folder : null
  const want = safeName(p.name)
  if (!folder) folder = uniqueDir(dir, want)
  else if (path.basename(folder) !== want && path.dirname(folder) === path.resolve(dir)) {
    const target = path.join(dir, want)
    if (!fs.existsSync(target)) {
      try {
        fs.renameSync(folder, target)
        folder = target
      } catch { /* folder in use (e.g. open in Explorer) — keep the old name */ }
    }
  }
  writeJson(path.join(folder, 'project.json'), { v: 1, id: p.id, name: p.name, clipKeys: p.clipKeys || [], bijouScriptId: p.bijouScriptId || null, createdAt: p.createdAt || Date.now(), pad: p.pad || null })
  return folder
}

export async function trashProject(folder) {
  if (folder && fs.existsSync(path.join(folder, 'project.json'))) await shell.trashItem(folder)
}

export function listSections(folder) {
  const dir = path.join(folder, 'sections')
  const out = []
  let names = []
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const f of names) {
    if (!f.endsWith('.json')) continue
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (s && s.id) out.push({ id: s.id, name: s.name || 'Section', order: s.order ?? 0, clips: s.clips || [], markers: s.markers || [], createdAt: s.createdAt || 0, updatedAt: s.updatedAt || 0 })
    } catch { /* skip a damaged file rather than fail the whole project */ }
  }
  return out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

export function saveSection(folder, s) {
  writeJson(path.join(folder, 'sections', s.id + '.json'), { v: 1, id: s.id, name: s.name, order: s.order ?? 0, clips: s.clips, markers: s.markers || [], createdAt: s.createdAt || Date.now(), updatedAt: Date.now() })
  return true
}

export async function trashSection(folder, id) {
  const f = path.join(folder, 'sections', id + '.json')
  if (fs.existsSync(f)) await shell.trashItem(f)
}
