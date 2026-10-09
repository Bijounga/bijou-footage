// If something in the interface throws while it's drawing, React would
// remove the whole app and leave an empty window. This catches it, says what
// happened (so it can be fixed), and lets you carry on: "Try again" redraws
// the app (nothing is lost — your notes and projects are saved as you go),
// "Reload" restarts the page.
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    this.setState({ info })
    const text = String((error && error.stack) || error) + '\n\nComponent stack:' + ((info && info.componentStack) || '')
    window.__lastCrash = text
    try { localStorage.setItem('lastCrash', new Date().toISOString() + '\n' + text) } catch { /* private window */ }
    console.error('[crash]', text)
  }
  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    const text = String((error && error.stack) || error) + (info ? '\n\nComponent stack:' + info.componentStack : '')
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <p>Your notes, projects and recordings are saved. You can carry on:</p>
        <div className="crash-btns">
          <button className="btn primary" onClick={() => this.setState({ error: null, info: null })}>Try again</button>
          <button className="btn" onClick={() => window.location.reload()}>Reload the app</button>
          <button className="btn ghost" onClick={() => navigator.clipboard && navigator.clipboard.writeText(text)}>Copy the error</button>
        </div>
        <pre>{text.slice(0, 2500)}</pre>
      </div>
    )
  }
}
