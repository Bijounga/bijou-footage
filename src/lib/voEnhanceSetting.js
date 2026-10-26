// The voice-enhance setting of the open project (settings.voEnhanceBy[id] =
// {on, amount}) — read and changed from the controls and from the keys.
import { useStore } from '../state/store.js'

export const enhanceOf = (st = useStore.getState()) => {
  const id = st.settings.currentProjectId
  const v = id && st.settings.voEnhanceBy && st.settings.voEnhanceBy[id]
  return { id, on: !!(v && v.on), amount: v && v.amount != null ? v.amount : 1 }
}
export function setEnhance(patch) {
  const st = useStore.getState()
  const id = st.settings.currentProjectId
  if (!id) return
  const all = st.settings.voEnhanceBy || {}
  const cur = all[id] || { on: false, amount: 1 }
  st.updateSettings({ voEnhanceBy: { ...all, [id]: { ...cur, ...patch } } })
}

// The switch.
export function toggleEnhance(on) {
  setEnhance({ on })
}
// For a key: flip it, and say so.
export function keyToggleEnhance(osd) {
  const st = useStore.getState()
  if (!st.currentProject()) return
  const on = !enhanceOf(st).on
  toggleEnhance(on)
  if (osd) osd(on ? 'Voice clean-up on' : 'Voice clean-up off')
}
