// "Skip silence" playback (the button next to Snap): while playing, jumps
// over stretches where nobody on the ⇥ tracks is talking — the same tracks
// and speech detection as Ctrl+→. Short pauses are kept so conversation
// still breathes; anything longer than MIN_GAP is skipped, landing just
// before the next person speaks. After the last speech it just plays on.
import { player } from './player.js'
import { useStore } from '../state/store.js'
import { mergedSpeech, hasWave } from './speech.js'
import { onTick } from './hooks.js'

const MIN_GAP = 1.2 // s of silence left before it's worth a jump
const LEAD = 0.25 // land this long before the next speech

let cache = { id: '', segs: [] }
function segmentsFor(st, clip) {
  const audio = (clip.probe && clip.probe.audio) || []
  const skip = st.settings.speechSkip || []
  const tracks = audio.map((a, i) => i).filter((i) => skip[i] && !(audio[i] && audio[i].likelySilent))
  const sens = st.settings.speechSensitivity ?? 0.5
  const id = clip.key + '|' + tracks.join(',') + '|' + sens
  if (cache.id !== id) cache = { id, segs: tracks.length ? mergedSpeech(clip.key, tracks, sens) : [] }
  return cache.segs
}

let cooldownUntil = 0
export function startSkipSilence() {
  return onTick(80, () => {
    const st = useStore.getState()
    if (!st.settings.skipSilence || !player.playing || player.skim || player.scrub || !st.currentKey) return
    const now = performance.now()
    if (now < cooldownUntil || !hasWave(st.currentKey)) return
    const clip = st.clips.find((c) => c.key === st.currentKey)
    if (!clip) return
    const segs = segmentsFor(st, clip)
    if (!segs.length) return
    const t = player.getTime()
    // First segment that hasn't ended yet.
    let lo = 0
    let hi = segs.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (segs[m][1] <= t) lo = m + 1
      else hi = m
    }
    const next = segs[lo]
    if (!next) return // past the last speech
    if (next[0] - LEAD <= t) return // someone's talking (or about to)
    if (next[0] - t < MIN_GAP) return // a short pause: keep it
    player.seek(next[0] - LEAD, { exact: true })
    cooldownUntil = now + 400
  })
}
