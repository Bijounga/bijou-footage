// App updates (see electron/main/updater.js): a small banner when a new
// version is downloaded and ready, and the Settings → Updates section.
import React, { useEffect, useState } from 'react'

// One shared listener; components read the latest status from here.
let status = { state: 'idle' }
const subs = new Set()
let started = false
function start() {
  if (started || !window.footage.onUpdateStatus) return
  started = true
  window.footage.onUpdateStatus((s) => {
    // keep the version across progress events
    status = { ...s, version: s.version || (s.state === 'downloading' ? status.version : undefined) }
    subs.forEach((f) => f(status))
  })
}
function useUpdateStatus() {
  const [s, set] = useState(status)
  useEffect(() => {
    start()
    subs.add(set)
    return () => subs.delete(set)
  }, [])
  return s
}

export function UpdateBanner() {
  const s = useUpdateStatus()
  const [hidden, setHidden] = useState(null) // version the banner was dismissed for
  if (s.state === 'ready' && hidden !== s.version) {
    return (
      <div className="update-banner">
        <span>Bijou Footage <b>{s.version}</b> is ready.</span>
        <button className="btn small primary" onClick={() => window.footage.installUpdate()} title="Closes the app, installs the update and opens it again">Restart to update</button>
        <button className="icon-btn small" onClick={() => setHidden(s.version)} title="Later — it installs next time you close the app">×</button>
      </div>
    )
  }
  if (s.state === 'available-manual' && hidden !== s.version) {
    return (
      <div className="update-banner">
        <span>Bijou Footage <b>{s.version}</b> is out.</span>
        <button className="btn small primary" onClick={() => window.footage.openReleases()}>Download</button>
        <button className="icon-btn small" onClick={() => setHidden(s.version)}>×</button>
      </div>
    )
  }
  return null
}

const LABEL = {
  idle: '',
  dev: 'Updates only work in the installed app.',
  checking: 'Checking…',
  'up-to-date': 'You have the latest version.',
  downloading: 'Downloading the update…',
  ready: 'Update downloaded — restart to install.',
  'available-manual': 'A new version is out.',
  error: "Couldn't check for updates.",
}

export function UpdatesSection() {
  const s = useUpdateStatus()
  const [version, setVersion] = useState('')
  useEffect(() => { window.footage.appVersion().then(setVersion) }, [])
  const text = s.state === 'downloading' && s.percent != null ? `Downloading ${s.version || 'the update'}… ${s.percent}%` : s.state === 'ready' ? `Version ${s.version} is ready — restart to install.` : LABEL[s.state] || ''
  return (
    <section>
      <h3>Updates</h3>
      <div className="upd-row">
        <span>Version <b>{version}</b></span>
        {s.state === 'ready' ? (
          <button className="btn small primary" onClick={() => window.footage.installUpdate()}>Restart to update</button>
        ) : (
          <button className="btn small" disabled={s.state === 'checking' || s.state === 'downloading'} onClick={() => window.footage.checkForUpdates()}>Check for updates</button>
        )}
        <button className="link-btn" onClick={() => window.footage.openReleases()}>What's new</button>
      </div>
      {text && <p className={'dim small' + (s.state === 'error' ? ' upd-error' : '')} title={s.message || ''}>{text}</p>}
      <p className="dim small">New versions download by themselves in the background (checked when the app opens and every few hours).</p>
    </section>
  )
}
