import React from 'react'
import { useStore, fmtBytes } from '../state/store.js'

// Premiere-style: the media cache went over its limit (Settings → Storage).
// Nothing is deleted without asking; background prep is paused meanwhile.
export default function CacheReminder() {
  const cache = useStore((s) => s.cache)
  const hidden = useStore((s) => s.cacheReminderHidden)
  if (!cache.over || cache.mode !== 'remind' || hidden) return null
  const st = useStore.getState
  return (
    <div className="cache-reminder">
      <span className="cr-icon">⚠</span>
      <span className="cr-text">
        Media cache is <b>{fmtBytes(cache.size)}</b> — over your {fmtBytes(cache.limit)} limit. Background prep is paused.
      </span>
      <button className="btn small" onClick={() => st().trimCache()} title="Delete the prepared audio of the recordings you opened longest ago, until it fits">Delete oldest to fit</button>
      <button className="btn small ghost" onClick={() => st().emptyCache()} title="Delete all prepared audio and waveforms (the open recording is kept)">Empty cache</button>
      <button className="btn small ghost" onClick={() => st().openModal('settings')}>Change limit…</button>
      <button className="icon-btn small" onClick={() => useStore.setState({ cacheReminderHidden: true })} title="Hide until next time the app starts">×</button>
    </div>
  )
}
