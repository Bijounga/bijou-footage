// Installs / updates the "Bijou Footage Rebuild" panel in Adobe Premiere Pro
// (premiere-panel/, shipped inside the app) — Windows and Mac.
//
// A panel is a folder in Adobe's per-user CEP extensions folder. Premiere only loads
// panels that aren't signed when "PlayerDebugMode" is on for its CEP version, so that
// is switched on too (the registry on Windows, `defaults` on a Mac). Premiere has to be
// restarted to see a new or updated panel.
//
// The panel is copied, not linked, so it keeps working if the app moves or updates; the
// app's version is written next to it, and a panel from an older app is refreshed when
// Bijou Footage starts. A panel that is a link to a development folder is left alone.
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'

const ID = 'com.bijounga.footagerebuild'
const STAMP = '.bijou-footage-version'
// the panel's own working files, never part of an install
const SKIP = new Set(['job.json', 'result.json', 'alive.txt', 'panel.log', 'install.ps1', STAMP])
const CSXS_VERSIONS = [9, 10, 11, 12]

const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'premiere-panel') : path.join(app.getAppPath(), 'premiere-panel'))
const extensionsDir = () =>
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions')
    : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions')
const targetDir = () => path.join(extensionsDir(), ID)

function premiereInstalled() {
  try {
    if (process.platform === 'darwin') return fs.readdirSync('/Applications').some((n) => /^Adobe Premiere Pro/.test(n))
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    return fs.readdirSync(path.join(pf, 'Adobe')).some((n) => /^Adobe Premiere Pro/.test(n))
  } catch {
    return false
  }
}

const readStamp = (dir) => { try { return fs.readFileSync(path.join(dir, STAMP), 'utf8').trim() } catch { return null } }

export function status() {
  const bundled = bundledDir()
  const target = targetDir()
  let installed = false
  let linked = false
  try {
    const st = fs.lstatSync(target)
    installed = true
    linked = st.isSymbolicLink()
  } catch { /* not there */ }
  const stamp = installed && !linked ? readStamp(target) : null
  return {
    platform: process.platform,
    available: fs.existsSync(path.join(bundled, 'CSXS', 'manifest.xml')),
    premiere: premiereInstalled(),
    installed,
    linked,
    appVersion: app.getVersion(),
    installedVersion: stamp,
    upToDate: installed && !linked && stamp === app.getVersion(),
    folder: target
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) {
    if (SKIP.has(name)) continue
    const a = path.join(from, name)
    const b = path.join(to, name)
    if (fs.statSync(a).isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  }
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true }, (err) => resolve(!err)))

// Premiere refuses panels that aren't signed unless this is on (for each CEP version).
async function allowUnsignedPanels() {
  for (const v of CSXS_VERSIONS) {
    if (process.platform === 'darwin') await run('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1'])
    else await run('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'])
  }
}

export async function install() {
  const s = status()
  if (!s.available) return { ok: false, message: 'The panel files are missing from this copy of Bijou Footage.' }
  if (s.linked) return { ok: false, message: 'The panel there is a link to a development folder, so it is left as it is.' }
  try {
    const target = targetDir()
    // a clean copy: files an older panel had and this one doesn't must not stay behind
    fs.rmSync(target, { recursive: true, force: true })
    copyDir(bundledDir(), target)
    fs.writeFileSync(path.join(target, STAMP), app.getVersion())
    await allowUnsignedPanels()
    return { ok: true, message: 'Installed. Restart Premiere Pro, then open Window → Extensions → Bijou Footage Rebuild.' }
  } catch (e) {
    return { ok: false, message: 'Could not install the panel: ' + (e && e.message ? e.message : e) }
  }
}

// At start-up: a panel that is installed but from an older app is brought up to date.
export async function updateIfOld() {
  const s = status()
  if (s.available && s.installed && !s.linked && !s.upToDate) return install()
  return null
}
