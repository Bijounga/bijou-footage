// Speech in an edit section, in timeline time: the ⇥ tracks' speech
// detection (lib/speech.js) of each clip's recording, cut to the clip and
// moved to where the clip sits. Used by Ctrl+→ / Ctrl+← and Skip silence
// in Edit. Recomputed only when the cut or the settings change.
import * as EM from './editModel.js'
import { mergedSpeech, hasWave } from './speech.js'

let cache = { clips: null, id: null, ranges: [], missing: 0 }

function compute(st, clips) {
  const skip = st.settings.speechSkip || []
  const sens = st.settings.speechSensitivity ?? 0.5
  const ranges = []
  let missing = 0
  for (const it of EM.layout(clips).items) {
    if (!hasWave(it.key)) { missing++; continue }
    const clip = st.clips.find((c) => c.key === it.key)
    const audio = (clip && clip.probe && clip.probe.audio) || []
    const tracks = audio.map((a, i) => i).filter((i) => skip[i] && !audio[i].likelySilent)
    if (!tracks.length) continue
    for (const [a, b] of mergedSpeech(it.key, tracks, sens)) {
      if (b <= it.in || a >= it.out) continue
      ranges.push([it.start + Math.max(a, it.in) - it.in, it.start + Math.min(b, it.out) - it.in, a >= it.in])
    }
  }
  ranges.sort((x, y) => x[0] - y[0])
  return { ranges, missing }
}

// [[start, end, startsInClip]] in timeline time, sorted.
export function speechInCut(st) {
  const sec = st.currentSection()
  if (!sec) return []
  // The cut is compared by reference (every edit makes a new clip list).
  const id = JSON.stringify(st.settings.speechSkip) + '|' + st.settings.speechSensitivity
  if (cache.clips !== sec.clips || cache.id !== id || cache.missing) {
    const r = compute(st, sec.clips)
    cache = { clips: sec.clips, id, ranges: r.ranges, missing: r.missing }
  }
  return cache.ranges
}
