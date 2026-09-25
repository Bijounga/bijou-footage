// Auto-updates from GitHub Releases (github.com/Bijounga/bijou-footage).
// Pushing a vX.Y.Z tag builds the installer on GitHub (see
// .github/workflows/release.yml) and publishes it as a Release; installed
// copies check it on launch and every 4 hours.
//
// Windows: downloads in the background, then the app offers "Restart to
// update". macOS (once there's a Mac build): electron-updater's installer
// path there needs a code-signed app, which this project doesn't have, so
// it only tells you a new version exists and links to the Release.
// Nothing happens in dev — there's no installed app to update.
import { app, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
const isMac = process.platform === 'darwin'
const RELEASES = 'https://github.com/Bijounga/bijou-footage/releases/latest'

export function initUpdater(send) {
  let check = () => send('update:status', { state: 'dev' })
  if (app.isPackaged) {
    autoUpdater.autoDownload = !isMac
    autoUpdater.autoInstallOnAppQuit = true // a downloaded update installs next time you quit anyway
    autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }))
    autoUpdater.on('update-available', (info) => send('update:status', { state: isMac ? 'available-manual' : 'downloading', version: info.version }))
    autoUpdater.on('update-not-available', () => send('update:status', { state: 'up-to-date' }))
    autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => send('update:status', { state: 'ready', version: info.version }))
    autoUpdater.on('error', (err) => send('update:status', { state: 'error', message: String((err && err.message) || err).split('\n')[0] }))
    check = () => autoUpdater.checkForUpdates().catch(() => {}) // reported through 'error'
    setTimeout(check, 8000) // let the app finish opening first
    setInterval(check, 4 * 60 * 60 * 1000)
  }
  ipcMain.handle('update:check', () => check())
  // Silent install, then the app reopens.
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true))
  ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES))
  ipcMain.handle('app:version', () => app.getVersion())
}
