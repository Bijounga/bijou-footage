// The window's title bar, drawn by the app so it can wear the theme (the
// same bar as Bijou Doodle / BijouDocs / BijouMusic). Windows: our own
// minimize / maximize / close; Mac: room for the native traffic lights.
// Not shown with "Hide the title bar" (Settings), nor in full screen.
import { useEffect, useState } from 'react'
import icon from '../assets/icon.png'

const api = window.footage
const isMac = /Mac/i.test(navigator.platform)

const MAXIMIZE = 'M.5 .5h9v9h-9z'
const RESTORE = 'M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z'

export default function TitleBar() {
  const [frameless, setFrameless] = useState(null) // null until known
  const [state, setState] = useState({ maximized: false, fullscreen: false })

  useEffect(() => {
    api.isFrameless().then((f) => setFrameless(!!f)).catch(() => setFrameless(true))
    api.windowState().then(setState).catch(() => {})
    return api.onWindowState(setState)
  }, [])

  const shown = frameless === false && !state.fullscreen
  useEffect(() => { document.body.classList.toggle('has-titlebar', shown) }, [shown])
  if (!shown) return null

  return (
    <header className={'titlebar' + (isMac ? ' mac' : '')} onDoubleClick={isMac ? () => api.windowCaption('maximize') : undefined}>
      <img className="titlebar-icon" src={icon} alt="" draggable="false" />
      <span className="titlebar-title">Bijou Footage</span>
      {!isMac && (
        <div className="titlebar-captions">
          <button className="titlebar-caption" title="Minimize" aria-label="Minimize" onClick={() => api.windowCaption('minimize')}>
            <svg viewBox="0 0 10 10"><path d="M0 5.5h10" /></svg>
          </button>
          <button className="titlebar-caption" title={state.maximized ? 'Restore Down' : 'Maximize'} aria-label={state.maximized ? 'Restore Down' : 'Maximize'} onClick={() => api.windowCaption('maximize')}>
            <svg viewBox="0 0 10 10"><path d={state.maximized ? RESTORE : MAXIMIZE} /></svg>
          </button>
          <button className="titlebar-caption titlebar-close" title="Close" aria-label="Close" onClick={() => api.windowCaption('close')}>
            <svg viewBox="0 0 10 10"><path d="M.5 .5l9 9M9.5 .5l-9 9" /></svg>
          </button>
        </div>
      )}
    </header>
  )
}
