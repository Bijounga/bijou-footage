// Auto-updates from GitHub Releases (github.com/Bijounga/bijou-footage).
// Pushing a vX.Y.Z tag builds Windows + Mac on GitHub (see
// .github/workflows/release.yml) and publishes them as a Release; installed
// copies check it on launch and every 4 hours, download in the background,
// then offer "Restart to update" (or install when you next quit).
//
// Windows: electron-updater does it all (NSIS). macOS: electron-updater
// only finds the update; downloading and swapping the app is done by
// macUpdate.js — no disk images, so nothing is left in Finder's sidebar.
// Nothing happens in dev — there's no installed app to update.
// BIJOU_UPDATE_FEED: check a test feed (a folder served over http with
// latest-mac.yml / latest.yml) instead of GitHub.
import { app, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import * as macUpdate from './macUpdate.js'

const { autoUpdater } = electronUpdater
const isMac = process.platform === 'darwin'
const RELEASES = 'https://github.com/Bijounga/bijou-footage/releases/latest'
const FEED = process.env.BIJOU_UPDATE_FEED || null

export function initUpdater(send) {
  let check = () => send('update:status', { state: 'dev' })
  const status = (s) => send('update:status', s)
  if (app.isPackaged) {
    if (FEED) autoUpdater.setFeedURL({ provider: 'generic', url: FEED })
    autoUpdater.autoDownload = !isMac
    autoUpdater.autoInstallOnAppQuit = !isMac // Windows: a downloaded update installs when you quit
    autoUpdater.on('checking-for-update', () => status({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => status({ state: 'up-to-date' }))
    autoUpdater.on('error', (err) => status({ state: 'error', message: String((err && err.message) || err).split('\n')[0] }))
    if (isMac) {
      autoUpdater.on('update-available', (info) => {
        if (!macUpdate.canSelfUpdate()) return status({ state: 'available-manual', version: info.version })
        status({ state: 'downloading', version: info.version })
        const base = FEED || `https://github.com/Bijounga/bijou-footage/releases/download/v${info.version}/`
        macUpdate
          .download(info, base, (percent) => status({ state: 'downloading', version: info.version, percent }))
          .then(() => status({ state: 'ready', version: info.version }))
          .catch((e) => status({ state: 'error', message: String(e.message || e) }))
      })
      // Quitting with an update waiting installs it (without reopening).
      app.on('will-quit', () => { if (macUpdate.isReady()) macUpdate.installAndRelaunch(false) })
    } else {
      autoUpdater.on('update-available', (info) => status({ state: 'downloading', version: info.version }))
      autoUpdater.on('download-progress', (p) => status({ state: 'downloading', percent: Math.round(p.percent) }))
      autoUpdater.on('update-downloaded', (info) => status({ state: 'ready', version: info.version }))
    }
    check = () => autoUpdater.checkForUpdates().catch(() => {}) // reported through 'error'
    setTimeout(check, 8000) // let the app finish opening first
    setInterval(check, 4 * 60 * 60 * 1000)
  }
  ipcMain.handle('update:check', () => check())
  // Install, then the app reopens (silently on Windows).
  ipcMain.handle('update:install', () => (isMac ? macUpdate.installAndRelaunch(true) : autoUpdater.quitAndInstall(true, true)))
  ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES))
  ipcMain.handle('app:version', () => app.getVersion())
}
