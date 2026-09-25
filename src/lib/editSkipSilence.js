// "Skip silence" while playing a section in Edit (the button next to Snap,
// Shift+X): jumps over stretches of the cut where nobody on the ⇥ tracks is
// talking — same rules as Review (lib/skipSilence.js): short pauses stay,
// longer ones are skipped, landing just before the next person speaks.
import { seqPlayer } from './seqPlayer.js'
import { useStore } from '../state/store.js'
import { speechInCut } from './editSpeech.js'
import { onTick } from './hooks.js'

const MIN_GAP = 1.2
const LEAD = 0.25

let cooldownUntil = 0
export function startEditSkipSilence() {
  return onTick(80, () => {
    const st = useStore.getState()
    if (!st.settings.editSkipSilence || st.settings.workspace !== 'edit' || !seqPlayer.playing) return
    const now = performance.now()
    if (now < cooldownUntil) return
    const ranges = speechInCut(st)
    if (!ranges.length) return
    const t = seqPlayer.getTime()
    let lo = 0
    let hi = ranges.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (ranges[m][1] <= t) lo = m + 1
      else hi = m
    }
    const next = ranges[lo]
    if (!next) return
    if (next[0] - LEAD <= t || next[0] - t < MIN_GAP) return
    seqPlayer.seek(next[0] - LEAD)
    cooldownUntil = now + 500
  })
}
