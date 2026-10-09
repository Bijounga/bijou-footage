// Edit's Voiceover strip plays on its own (voSrc), like a source monitor next
// to the sequence in Premiere. Whichever one you clicked last has the focus
// (store.editFocus): the same keys you use on the cut (whatever they're bound
// to in Keybinds) drive that one — play / shuttle / skip, previous / next cut
// (= the strip's clip edges), previous / next speech (= its transcript
// lines), start / end and zoom. Only one of the two plays at a time.
import { voSrc } from './voPlayer.js'
import { seqPlayer } from './seqPlayer.js'
import { useStore } from '../state/store.js'
import { bus } from './hooks.js'
import { buildLines } from './voTranscripts.js'

const seek = (t) => voSrc.seek(Math.max(0, Math.min(voSrc.total, t)))
const nudge = (d) => seek(voSrc.getTime() + d)
// jump to the next / previous of a sorted list of times
function jump(times, dir, osd, none) {
  const t = voSrc.getTime()
  const n = dir > 0 ? times.find((x) => x > t + 0.02) : [...times].reverse().find((x) => x < t - (voSrc.playing ? 0.6 : 0.02))
  if (n != null) seek(n)
  else osd(none)
}
const clipEdges = () => [...new Set(voSrc.items.flatMap((it) => [it.start, it.start + it.dur]))].sort((a, b) => a - b)
const lineStarts = () => buildLines(voSrc.items.map((it) => it.clip).filter(Boolean)).map((l) => l.start)
const rateLabel = () => (voSrc.rate === 1 ? '▶ 1×' : '▶ ' + voSrc.rate + '×')

// edit action id → what it does to the strip's player
const SRC = {
  'e.play': () => voSrc.toggle(),
  'e.stop': () => voSrc.pause(),
  'e.faster': ({ osd }) => {
    if (!voSrc.playing) voSrc.play()
    else voSrc.shuttleStep(1)
    osd(rateLabel())
  },
  'e.slower': ({ osd }) => {
    // no reverse for audio: slower, then stop
    if (!voSrc.playing) return
    if (voSrc.rate <= 0.5 + 1e-6) voSrc.pause()
    else voSrc.shuttleStep(-1)
    osd(voSrc.playing ? rateLabel() : 'Stopped')
  },
  'e.skipBack': ({ st }) => nudge(-(st.settings.skipSmall || 5)),
  'e.skipFwd': ({ st }) => nudge(st.settings.skipSmall || 5),
  'e.skipBackBig': ({ st }) => nudge(-(st.settings.skipBig || 30)),
  'e.skipFwdBig': ({ st }) => nudge(st.settings.skipBig || 30),
  'e.frameBack': () => { voSrc.pause(); nudge(-0.05) },
  'e.frameFwd': () => { voSrc.pause(); nudge(0.05) },
  'e.prevCut': ({ osd }) => jump(clipEdges(), -1, osd, 'At the start'),
  'e.nextCut': ({ osd }) => jump(clipEdges(), 1, osd, 'No more clips'),
  'e.prevSpeech': ({ osd }) => jump(lineStarts(), -1, osd, 'No earlier line'),
  'e.nextSpeech': ({ osd }) => jump(lineStarts(), 1, osd, 'No more lines'),
  'e.zoomIn': () => bus.emit('voSrcZoom', 1),
  'e.zoomOut': () => bus.emit('voSrcZoom', -1),
  'e.zoomFit': () => bus.emit('voSrcZoom', 0),
  'e.start': () => seek(0),
  'e.end': () => seek(voSrc.total)
}

// (for the Keybinds window: which Edit keys also drive the strip)
export const SOURCE_KEY_IDS = new Set(Object.keys(SRC))

// Run an Edit key on the strip instead, if it has the focus and the key is
// one of its playback keys. true = handled.
export function runOnSource(action, osd) {
  const st = useStore.getState()
  if (st.editFocus !== 'vosrc') return false
  // the strip has been hidden since: the keys go back to the cut
  if (!document.querySelector('.vo-strip')) {
    st.setEditFocus('cut')
    return false
  }
  const fn = SRC[action.id]
  if (!fn) return false
  fn({ st, osd })
  return true
}

// One plays at a time: starting either pauses the other.
let linked = false
export function linkSourcePlayer() {
  if (linked) return
  linked = true
  voSrc.on('state', () => { if (voSrc.playing && seqPlayer.playing) seqPlayer.pause() })
  seqPlayer.on('state', () => { if (seqPlayer.playing && voSrc.playing) voSrc.pause() })
}
