import { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream'
import { locateFfmpeg, forgetFfmpeg } from './ffmpeg.js'
import * as setup from './setup.js'
import { initLibrary, scanFolders } from './library.js'
import * as waveform from './waveform.js'
import * as transcribe from './transcribe.js'
import * as llm from './llm.js'
import * as projects from './projects.js'
import * as bijou from './bijou.js'
import { buildXml, buildCsv, buildSequenceXml } from './premiereXml.js'
import { initUpdater } from './updater.js'
import * as macUpdate from './macUpdate.js'

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'

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
// The viewer window copies the main window's video: keep that video
// decoding and drawing even when the main window is minimized or covered.
app.commandLine.appendSwitch('disable-background-media-suspend')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if (isDev) app.commandLine.appendSwitch('remote-debugging-port', '9223')

protocol.registerSchemesAsPrivileged([
  { scheme: 'footage', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
])

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4a': 'audio/mp4', '.png': 'image/png' }

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

// A notes file that can't be read for a moment (Windows: a save replacing
// it, an antivirus scan) must never look like "no notes yet" — the app would
// start empty and its next save would replace the real file. So: retry, then
// keep the unreadable file and start from the newest backup that reads.
// Only a file that isn't there at all means a first launch.
function loadReviews() {
  const file = dataFile()
  if (!fs.existsSync(file)) return null
  for (let i = 0; i < 20; i++) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
  const dir = path.join(userData(), 'backups')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(file, path.join(dir, `unreadable-${Date.now()}.json`))
  } catch {}
  try {
    for (const b of fs.readdirSync(dir).filter((n) => n.startsWith('reviews-')).sort().reverse()) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, b), 'utf8'))
      } catch {}
    }
  } catch {}
  return null
}

// Every save goes through here: write a temp file, then swap it in. A save
// that would shrink the file to a fraction of itself (projects and notes
// gone) first keeps a copy of what it replaces — whatever caused it.
function writeData(json) {
  const file = dataFile()
  try {
    const old = fs.statSync(file).size
    if (old > 4096 && json.length < old * 0.3) {
      const dir = path.join(userData(), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(file, path.join(dir, `before-shrink-${Date.now()}.json`))
      const old5 = fs.readdirSync(dir).filter((n) => n.startsWith('before-shrink-')).sort().slice(0, -5)
      old5.forEach((n) => fs.unlinkSync(path.join(dir, n)))
    }
  } catch {}
  fs.writeFileSync(file + '.tmp', json, 'utf8')
  fs.renameSync(file + '.tmp', file)
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

// The sketch window (SketchEditor.jsx) opens maximized on a chosen display —
// by default the one with the most real pixels (a 4K drawing tablet, even
// when Windows scales it to look like 1080p), else the app's own.
let sketchWin = null
let sketchDisplayId = null // the user's pick (settings.sketchDisplay)
function sketchDisplay() {
  const all = screen.getAllDisplays()
  const picked = all.find((d) => String(d.id) === String(sketchDisplayId))
  if (picked) return picked
  const px = (d) => d.size.width * d.scaleFactor * d.size.height * d.scaleFactor
  return all.slice().sort((a, b) => px(b) - px(a))[0] || screen.getPrimaryDisplay()
}
function placeSketch(w, d) {
  if (!w || w.isDestroyed()) return
  if (w.isMaximized()) w.unmaximize()
  w.setBounds(d.workArea)
  setTimeout(() => { if (!w.isDestroyed()) { w.setBounds(d.workArea); w.maximize() } }, 60) // twice: other-DPI monitors
}

// Sketch notes go with a Premiere export: copied into "<name> sketches"
// beside the XML (so the project finds them wherever it's opened), and the
// notes pointed at the copies.
function copySketches(xmlPath, notes) {
  if (!notes.some((n) => n.sketch)) return notes
  const dir = xmlPath.replace(/\.xml$/i, '') + ' sketches'
  fs.mkdirSync(dir, { recursive: true })
  return notes.map((n) => {
    if (!n.sketch || !fs.existsSync(n.sketch)) return n
    const to = path.join(dir, path.basename(n.sketch))
    try { fs.copyFileSync(n.sketch, to) } catch { return n }
    return { ...n, sketch: to }
  })
}

// The viewer window's size and place, kept between sessions. First time:
// the biggest other monitor if there is one, else a good size on this one.
const viewerFile = () => path.join(userData(), 'viewer-window.json')
let viewerMaximized = false
let viewerBounds = null
function viewerOptions() {
  let saved = null
  try { saved = JSON.parse(fs.readFileSync(viewerFile(), 'utf8')) } catch { /* first time */ }
  // Only where a monitor still is (it may have been unplugged).
  const onScreen = saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea
    const b = saved.bounds
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 80 && b.y + b.height > a.y
  })
  viewerMaximized = !!(onScreen && saved.maximized)
  let bounds = onScreen ? saved.bounds : null
  if (!bounds) {
    const main = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
    const others = screen.getAllDisplays().filter((d) => d.id !== main.id).sort((a, b) => b.workArea.width * b.workArea.height - a.workArea.width * a.workArea.height)
    const a = (others[0] || main).workArea
    const w = Math.round(a.width * 0.7)
    const h = Math.round(Math.min(a.height * 0.8, (w * 9) / 16))
    bounds = { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h }
  }
  viewerBounds = bounds
  return {
    ...bounds,
    minWidth: 240,
    minHeight: 135,
    title: 'Bijou Footage — Viewer',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: true,
    icon: path.join(__dirname, '../../build/icon.ico'),
    webPreferences: { backgroundThrottling: false },
  }
}
function saveViewerState(w) {
  try {
    if (w.isDestroyed() || w.isFullScreen()) return
    fs.writeFileSync(viewerFile(), JSON.stringify({ bounds: w.getNormalBounds(), maximized: w.isMaximized() }))
  } catch { /* not important */ }
}
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

// A Mac always shows the app's menu bar, and text boxes only get ⌘C / ⌘V /
// ⌘Z / ⌘A through its Edit menu. The page sees each key first: the app's own
// shortcuts (⌘Z undoing an edit, ⌘A selecting clips…) take it and stop it
// there; in a text box the menu does the usual text editing. No View menu:
// its ⌘R (reload) and ⌘+/− (page zoom) would only get in the way.
function macMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: 'Bijou Footage on GitHub', click: () => shell.openExternal('https://github.com/Bijounga/bijou-footage') }] }
    ])
  )
}

function createWindow() {
  const saved = loadReviews()
  const winState = loadWindowState()
  frameless = !!(saved && saved.settings && saved.settings.hideTitleBar)
  win = new BrowserWindow({
    // No title bar: Windows draws its buttons over the app (overlay); a Mac
    // keeps its traffic lights, inset into the app's top-left corner.
    // Otherwise the app draws a themed title bar (components/TitleBar.jsx):
    // its own buttons on Windows, the traffic lights inset into it on a Mac.
    ...(frameless
      ? (isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } } : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#17181e', symbolColor: '#ece9e2', height: OVERLAY_H } })
      : (isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 9 } } : { titleBarStyle: 'hidden' })),
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
  // fires on every Alt+wheel timeline zoom. (A Mac's menu bar is the app's,
  // not the window's — see macMenu.)
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
  const sendWindowState = () => { if (win && !win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() }) }
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, sendWindowState)
  win.on('unmaximize', remember)
  win.on('close', () => saveWindowState(thisWin))
  if (isDev) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log('[renderer]', message, '(' + sourceId + ':' + line + ')')
    })
  }
  // The viewer (src/lib/viewer.js) is the one window the page may open;
  // every other link goes to the browser.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'bijou-viewer' && (url === 'about:blank' || url === '')) {
      return { action: 'allow', overrideBrowserWindowOptions: viewerOptions() }
    }
    if (frameName === 'bijou-sketch' && (url === 'about:blank' || url === '')) {
      const d = sketchDisplay()
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { ...d.workArea, title: 'Bijou Footage — Sketch', backgroundColor: '#08090c', autoHideMenuBar: true, show: true, icon: path.join(__dirname, '../../build/icon.ico'), webPreferences: { backgroundThrottling: false } },
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName === 'bijou-sketch') {
      sketchWin = child
      child.removeMenu()
      placeSketch(child, sketchDisplay())
      child.on('closed', () => { if (sketchWin === child) sketchWin = null })
      return
    }
    if (frameName !== 'bijou-viewer') return
    child.removeMenu()
    // Placed again once it exists: created straight onto a monitor with other
    // display scaling, Windows scales its size a second time (it opened at
    // double size on a 200% monitor).
    if (viewerBounds) { child.setBounds(viewerBounds); setTimeout(() => !child.isDestroyed() && child.setBounds(viewerBounds), 50) }
    let t = null
    const remember = () => { clearTimeout(t); t = setTimeout(() => saveViewerState(child), 400) }
    child.on('resize', remember)
    child.on('move', remember)
    child.on('maximize', remember)
    child.on('unmaximize', remember)
    child.on('close', () => saveViewerState(child))
    if (viewerMaximized) child.maximize()
  })
  // Closing the app's window closes the viewer too.
  win.on('close', () => { for (const w of BrowserWindow.getAllWindows()) if (w !== thisWin && !w.isDestroyed()) w.close() })
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
    writeData(json)
    return true
  })
  // Synchronous variant for the window-closing flush, where an async IPC
  // round trip might not finish before the renderer is torn down.
  ipcMain.on('data:saveSync', (e, json) => {
    try {
      writeData(json)
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

  // Settings → Tools: install ffmpeg / the transcriber / AI summaries.
  ipcMain.handle('setup:status', () => setup.status({ ffmpeg: tools(), llm }))
  ipcMain.handle('setup:install', async (_e, what, opts) => {
    // Nothing of the old copy may be running while it's replaced.
    if (what === 'whisper') transcribe.shutdown()
    if (what === 'llm') llm.shutdown()
    const ok = await setup.install(what, opts, (ev) => send('setup:event', ev))
    if (what === 'ffmpeg') {
      forgetFfmpeg()
      const t = tools()
      waveform.setFfmpeg(t.ffmpeg)
      transcribe.setFfmpeg(t.ffmpeg)
    }
    if (what === 'whisper') send('transcript:event', { type: 'state', ...transcribe.queueState() })
    return ok
  })
  ipcMain.handle('setup:cancel', () => setup.cancel())
  // Displays, for the sketch window's display picker.
  ipcMain.handle('displays:list', () => {
    const appD = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
    const cur = sketchWin && !sketchWin.isDestroyed() ? screen.getDisplayMatching(sketchWin.getBounds()) : sketchDisplay()
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      name: d.label || 'Display ' + (i + 1),
      px: Math.round(d.size.width * d.scaleFactor) + '×' + Math.round(d.size.height * d.scaleFactor),
      app: d.id === appD.id,
      current: d.id === cur.id,
    }))
  })
  ipcMain.handle('sketch:display', (_e, id) => {
    sketchDisplayId = id || null
    if (sketchWin && !sketchWin.isDestroyed()) placeSketch(sketchWin, sketchDisplay())
  })
  // Sketch notes: one PNG per note in <userData>/sketches (see SketchEditor.jsx).
  ipcMain.handle('sketch:save', (_e, id, dataUrl) => {
    const dir = path.join(userData(), 'sketches')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, String(id).replace(/[^\w-]/g, '') + '.png')
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'))
    return file
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
    const markers = copySketches(r.filePath, payload.markers || [])
    fs.writeFileSync(r.filePath, buildSequenceXml({ ...payload, markers }), 'utf8')
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
    const withSketches = kind === 'csv' ? clips : clips.map((c) => ({ ...c, notes: copySketches(r.filePath, c.notes || []) }))
    const body = kind === 'csv' ? buildCsv(clips) : buildXml(withSketches, (name || 'Footage notes') + ' ' + stamp)
    fs.writeFileSync(r.filePath, body, 'utf8')
    return r.filePath
  })

  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p))

  ipcMain.handle('bijou:customThemes', () => bijou.customThemes())
  ipcMain.handle('window:frameless', () => frameless)
  // The app-drawn title bar's buttons, and the state they show.
  ipcMain.handle('window:caption', (_e, action) => {
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else if (action === 'close') win.close()
  })
  ipcMain.handle('window:state', () => (win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : { maximized: false, fullscreen: false }))
  ipcMain.handle('window:overlayColors', (_e, colors) => {
    if (frameless && !isMac && win && win.setTitleBarOverlay) win.setTitleBarOverlay({ ...colors, height: OVERLAY_H })
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
    if (isMac) macMenu()
    createWindow()
    if (isMac && app.isPackaged) macUpdate.tidyOnLaunch() // eject the install disk image, drop old downloads
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    transcribe.shutdown()
    llm.shutdown()
  })
}
