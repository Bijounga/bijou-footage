import { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream'
import { locateFfmpeg } from './ffmpeg.js'
import { initLibrary, scanFolders } from './library.js'
import * as waveform from './waveform.js'
import * as transcribe from './transcribe.js'
import * as llm from './llm.js'
import * as projects from './projects.js'
import * as bijou from './bijou.js'
import { buildXml, buildCsv, buildSequenceXml } from './premiereXml.js'
import { initUpdater } from './updater.js'

const isDev = !app.isPackaged

// App data (notes, projects, settings, transcripts, waveform + audio caches)
// lives in ~/.bijou-footage/app, next to the Whisper install — not in
// %APPDATA%. Launched from some sandboxed hosts, Windows silently redirects
// new %APPDATA% folders into that host's private storage, and the installed
// app (launched normally) would then open with none of your data. One path
// outside AppData is the same for every launch. Must run before anything
// reads userData (including the single-instance lock).
// BIJOU_FOOTAGE_DATA: a different data folder (e.g. to test a dev build while
// the installed app is open — the one-copy-at-a-time lock is per data folder).
const DATA_DIR = process.env.BIJOU_FOOTAGE_DATA || path.join(os.homedir(), '.bijou-footage', 'app')
const OLD_DATA_DIR = path.join(app.getPath('appData'), 'bijou-footage')
app.setPath('userData', DATA_DIR)
migrateOldData()

// First start with the new location: bring the old data over. Small files
// are copied (the old copy stays as a fallback); the caches are moved if
// Windows allows a cheap rename, otherwise copied — except the extracted
// audio, which is rebuilt in the background rather than copying gigabytes.
function migrateOldData() {
  try {
    if (fs.existsSync(path.join(DATA_DIR, 'reviews.json'))) return
    if (!fs.existsSync(path.join(OLD_DATA_DIR, 'reviews.json'))) return
    fs.mkdirSync(DATA_DIR, { recursive: true })
    for (const file of ['probe-cache.json', 'window.json', 'reviews.json']) {
      const from = path.join(OLD_DATA_DIR, file)
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DATA_DIR, file))
    }
    for (const dir of ['backups', 'transcripts', 'waveforms', 'audio-cache']) {
      const from = path.join(OLD_DATA_DIR, dir)
      const to = path.join(DATA_DIR, dir)
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      try {
        fs.renameSync(from, to)
      } catch {
        if (dir !== 'audio-cache') fs.cpSync(from, to, { recursive: true })
      }
    }
  } catch (e) {
    console.error('Data migration failed:', e)
  }
}

// Chromium can already demux every audio track in an OBS recording, it just
// hides the API that picks between them behind this flag. With it on, the
// player gives each track its own <audio> element (same file, a different
// track enabled in each) and mixes them through Web Audio — so multi-track
// playback needs no extraction or preprocessing at all.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')
if (isDev) app.commandLine.appendSwitch('remote-debugging-port', '9223')

protocol.registerSchemesAsPrivileged([
  { scheme: 'footage', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
])

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4a': 'audio/mp4' }

// Serves local video files with proper HTTP range support — seeking in a
// multi-GB recording only ever reads the bytes around the seek point.
function handleFootage(req) {
  const file = decodeURIComponent(new URL(req.url).pathname.slice(1))
  const mime = MIME[path.extname(file).toLowerCase()]
  if (!mime) return new Response('Not a video', { status: 403 })
  let size
  try {
    size = fs.statSync(file).size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
  let start = 0
  let end = size - 1
  if (m) {
    if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, size - Number(m[2]))
    } else {
      start = Number(m[1] || 0)
      if (m[2] !== '') end = Math.min(size - 1, Number(m[2]))
    }
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 1024 * 1024 })
  return new Response(Readable.toWeb(stream), {
    status: m ? 206 : 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    }
  })
}

let win = null
const userData = () => app.getPath('userData')
const dataFile = () => path.join(userData(), 'reviews.json')

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function loadReviews() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'))
  } catch {
    return null
  }
}

// Keeps one backup per day of the notes file, last 7 days — cheap insurance
// for something the user may pour hundreds of hours of review into.
function rotateBackup() {
  try {
    if (!fs.existsSync(dataFile())) return
    const dir = path.join(userData(), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const target = path.join(dir, `reviews-${today}.json`)
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target)
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('reviews-')).sort().slice(0, -7)
    old.forEach((f) => fs.unlinkSync(path.join(dir, f)))
  } catch (e) {
    console.error('backup failed', e)
  }
}

// "Hide title bar" (Settings): no Windows title bar; the min/max/close
// buttons are drawn over the app's top-right corner instead, colored to
// match the theme. A window's frame can only be chosen when it's created,
// so switching it rebuilds the window in place (window:recreate).
let frameless = false
const OVERLAY_H = 40

// Window size/position/maximized, remembered between launches.
const windowFile = () => path.join(userData(), 'window.json')
function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(windowFile(), 'utf8'))
    // Only if it's still on a connected screen (monitor unplugged, etc.).
    const area = screen.getDisplayMatching(st.bounds).workArea
    const visible = st.bounds.x < area.x + area.width - 100 && st.bounds.x + st.bounds.width > area.x + 100 && st.bounds.y >= area.y - 20 && st.bounds.y < area.y + area.height - 100
    return visible ? st : null
  } catch {
    return null
  }
}
function saveWindowState(w) {
  try {
    if (w.isDestroyed() || w.isFullScreen()) return
    fs.writeFileSync(windowFile(), JSON.stringify({ bounds: w.getNormalBounds(), maximized: w.isMaximized() }))
  } catch { /* not important */ }
}

function createWindow() {
  const saved = loadReviews()
  const winState = loadWindowState()
  frameless = !!(saved && saved.settings && saved.settings.hideTitleBar)
  win = new BrowserWindow({
    ...(frameless ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#17181e', symbolColor: '#ece9e2', height: OVERLAY_H } } : {}),
    width: winState ? winState.bounds.width : 1500,
    height: winState ? winState.bounds.height : 920,
    ...(winState ? { x: winState.bounds.x, y: winState.bounds.y } : {}),
    minWidth: 980,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1014',
    title: 'Bijou Footage',
    icon: path.join(__dirname, '../../build/icon.ico'), // footage-review/build (scripts/make-icon.mjs)
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  // No menu bar at all: with autoHideMenuBar, pressing Alt pops it up, which
  // fires on every Alt+wheel timeline zoom.
  win.removeMenu()
  const thisWin = win
  win.on('ready-to-show', () => {
    // First launch (nothing saved yet): start maximized.
    if (!winState || winState.maximized) thisWin.maximize()
    thisWin.show()
  })
  let boundsTimer = null
  const remember = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => saveWindowState(thisWin), 500) }
  win.on('resize', remember)
  win.on('move', remember)
  win.on('maximize', remember)
  win.on('unmaximize', remember)
  win.on('close', () => saveWindowState(thisWin))
  if (isDev) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log('[renderer]', message, '(' + sourceId + ':' + line + ')')
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

let ffmpegOverride = null
function tools() {
  return locateFfmpeg(ffmpegOverride)
}

function registerIpc() {
  ipcMain.handle('data:load', () => loadReviews())
  ipcMain.handle('data:save', (_e, json) => {
    fs.writeFileSync(dataFile() + '.tmp', json, 'utf8')
    fs.renameSync(dataFile() + '.tmp', dataFile())
    return true
  })
  // Synchronous variant for the window-closing flush, where an async IPC
  // round trip might not finish before the renderer is torn down.
  ipcMain.on('data:saveSync', (e, json) => {
    try {
      fs.writeFileSync(dataFile() + '.tmp', json, 'utf8')
      fs.renameSync(dataFile() + '.tmp', dataFile())
      e.returnValue = true
    } catch {
      e.returnValue = false
    }
  })

  ipcMain.handle('tools:status', (_e, overrideDir) => {
    ffmpegOverride = overrideDir || null
    const t = tools()
    waveform.setFfmpeg(t.ffmpeg)
    transcribe.setFfmpeg(t.ffmpeg)
    return { ffmpeg: t.ffmpeg, ffprobe: t.ffprobe }
  })

  ipcMain.handle('library:scan', (_e, folders, files) => {
    const t = tools()
    return scanFolders(folders, t.ffprobe, (clip) => send('library:probed', clip), files || [])
  })
  ipcMain.handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add recordings',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'm4v', 'webm'] }]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('waveform:get', (_e, clip) => {
    const buf = waveform.readCached(clip)
    return buf ? new Uint8Array(buf) : null
  })
  ipcMain.handle('waveform:request', (_e, clip, front) => {
    waveform.request(clip, front)
    return waveform.status(clip)
  })
  ipcMain.handle('waveform:requestMany', (_e, clips) => {
    clips.forEach((c) => waveform.request(c, false))
  })
  ipcMain.handle('waveform:clearQueue', () => waveform.clearQueue())
  ipcMain.handle('media:audioFiles', (_e, clip) => waveform.audioFiles(clip))
  ipcMain.handle('cache:setPolicy', (_e, limitGB, mode) => waveform.setCachePolicy(limitGB * 1024 ** 3, mode))
  ipcMain.handle('cache:stats', () => waveform.cacheStats(path.join(userData(), 'transcripts')))
  ipcMain.handle('cache:trim', (_e, keepClip) => waveform.trimCache(keepClip))
  ipcMain.handle('cache:empty', (_e, keepClip) => waveform.emptyCache(keepClip))
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p))

  ipcMain.handle('transcript:state', () => transcribe.queueState())
  ipcMain.handle('transcript:doneMap', (_e, clips) => transcribe.doneMap(clips))
  ipcMain.handle('transcript:read', (_e, clip, track) => transcribe.read(clip, track))
  ipcMain.handle('transcript:request', (_e, jobs, language, front) => { transcribe.setLanguage(language); transcribe.request(jobs, front) })
  ipcMain.handle('transcript:cancel', (_e, key) => transcribe.cancel(key))
  ipcMain.handle('transcript:remove', (_e, clip, track) => transcribe.remove(clip, track))
  ipcMain.handle('projects:list', (_e, dir) => projects.listProjects(dir))
  ipcMain.handle('projects:save', (_e, dir, p) => projects.saveProject(dir, p))
  ipcMain.handle('projects:trash', (_e, folder) => projects.trashProject(folder))
  ipcMain.handle('sections:list', (_e, folder) => projects.listSections(folder))
  ipcMain.handle('sections:save', (_e, folder, s) => projects.saveSection(folder, s))
  ipcMain.handle('sections:trash', (_e, folder, id) => projects.trashSection(folder, id))
  ipcMain.handle('dialog:pickProjectsDir', async (_e, current) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose where Bijou Footage saves projects',
      defaultPath: current || path.join(app.getPath('documents'), 'Bijou Footage Projects'),
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('app:defaultProjectsDir', () => path.join(app.getPath('documents'), 'Bijou Footage Projects'))
  ipcMain.handle('export:section', async (_e, payload) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${(payload.name || 'Section').replace(/[\\/:*?"<>|]/g, '-')}.xml`,
      filters: [{ name: 'Premiere / FCP XML', extensions: ['xml'] }]
    })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, buildSequenceXml(payload), 'utf8')
    return r.filePath
  })
  ipcMain.handle('llm:installed', () => llm.installed())
  ipcMain.handle('llm:summarize', (_e, id, payload) => llm.summarize(id, payload).catch(() => null))
  ipcMain.handle('transcript:search', (_e, query, clips) => transcribe.search(query, clips))

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a recordings folder (subfolders are included)', properties: ['openDirectory', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('bijou:listScripts', () => bijou.listScripts())
  ipcMain.handle('bijou:beatColors', () => bijou.beatColors())
  ipcMain.handle('bijou:export', (_e, opts) => bijou.exportBeats(opts))

  ipcMain.handle('export:premiere', async (_e, clips, kind, name) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const ext = kind === 'csv' ? 'csv' : 'xml'
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${(name || 'footage-notes').replace(/[\\/:*?"<>|]/g, '-')} ${stamp}.${ext}`,
      filters: [kind === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Premiere / FCP XML', extensions: ['xml'] }]
    })
    if (r.canceled || !r.filePath) return null
    const body = kind === 'csv' ? buildCsv(clips) : buildXml(clips, (name || 'Footage notes') + ' ' + stamp)
    fs.writeFileSync(r.filePath, body, 'utf8')
    return r.filePath
  })

  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p))

  ipcMain.handle('bijou:customThemes', () => bijou.customThemes())
  ipcMain.handle('window:frameless', () => frameless)
  ipcMain.handle('window:overlayColors', (_e, colors) => {
    if (frameless && win && win.setTitleBarOverlay) win.setTitleBarOverlay({ ...colors, height: OVERLAY_H })
  })
  ipcMain.handle('window:toggleFullscreen', () => {
    if (win) win.setFullScreen(!win.isFullScreen())
    return win ? win.isFullScreen() : false
  })
  // Rebuild the window with the current title-bar setting, keeping its
  // size/position. The new window is made before the old one closes so the
  // app never has zero windows (which would quit it).
  ipcMain.handle('window:recreate', () => {
    const old = win
    const bounds = old.getNormalBounds()
    const wasMax = old.isMaximized()
    const wasFull = old.isFullScreen()
    createWindow()
    win.setBounds(bounds)
    if (wasMax) win.maximize()
    if (wasFull) win.setFullScreen(true)
    old.destroy()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    protocol.handle('footage', handleFootage)
    initLibrary(userData())
    waveform.initWaveforms(userData(), (ev) => send('waveform:event', ev))
    waveform.setFfmpeg(tools().ffmpeg)
    transcribe.initTranscribe(userData(), (ev) => send('transcript:event', ev))
    llm.initLlm((ev) => send('llm:event', ev))
    transcribe.setFfmpeg(tools().ffmpeg)
    rotateBackup()
    registerIpc()
    initUpdater(send)
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    transcribe.shutdown()
    llm.shutdown()
  })
}
