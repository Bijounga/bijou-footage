// Recording voiceover straight over the cut, in Edit (R), and tapping lines
// into place while it plays (T).
//
// R: the cut rolls back by the pre-roll (the Voiceover tab's setting), plays,
// and the microphone starts recording the moment the picture reaches where
// the playhead was — so you talk over the footage as it plays. R again,
// Space or Esc stops. The take joins the end of the voiceover section shown
// in the strip (one is made if there's none), and lands on the voiceover
// track exactly where you said it, over whatever was there (like recording
// over audio in Premiere). The voiceover already on the track is muted while
// you record, so it doesn't bleed into the microphone.
//
// T: drops the next line from the strip that isn't on the track yet at the
// playhead — tap along while the cut plays.
import { useStore } from '../state/store.js'
import { useVo } from '../state/voStore.js'
import { seqPlayer } from './seqPlayer.js'
import { voMix } from './voPlayer.js'
import { voRec } from './voRecorder.js'
import { putPeaks } from './voPeaks.js'
import { requestTx } from './voTranscripts.js'
import * as VM from './voModel.js'
import * as VL from './voLane.js'
import { bus } from './hooks.js'

const st = () => useStore.getState()
const toast = (t, kind) => st().showToast(t, kind)
let offState = null

// The voiceover section new takes go into: the one open in the strip, else
// the first, else a new one named after this section.
function targetSection() {
  const vo = useVo.getState()
  const list = [...vo.sections].sort((a, b) => a.order - b.order)
  const pick = list.find((x) => x.id === st().settings.editVoSrc) || list.find((x) => x.clips.length) || list[0]
  if (pick) return pick.id
  const sec = st().currentSection()
  return vo.createSection(sec ? sec.name + ' — voiceover' : null)
}

export function editRecToggle() {
  const r = st().editRec
  if (r) return r.phase === 'recording' ? stopEditRec() : cancelEditRec()
  return startEditRec()
}

export async function startEditRec() {
  if (st().editRec) return
  const project = st().currentProject()
  const sec = st().currentSection()
  if (!project || !project.folder || !sec) return toast('Open a section of a project first')
  if (!sec.clips.length) return toast('Put some footage in the section first, then record over it')
  if (!(await voRec.open(st().settings.voMic || null))) return toast(voRec.error || 'The microphone didn’t open', 'error')
  const vsId = targetSection()
  if (!vsId) return
  const at = seqPlayer.getTime()
  const pre = st().settings.voPreroll ?? 3
  const take = { id: VM.takeId(), dur: 0, created: Date.now(), marks: [] }
  const token = {}
  useStore.setState({ editRec: { phase: 'preroll', at, start: null, take, vsId, token } })
  // keep the voiceover already on the track out of the microphone
  voMix.setVolume(0)
  st().setEditFocus('cut')
  seqPlayer.seek(Math.max(0, at - pre))
  await new Promise((res) => setTimeout(res, 150))
  if (st().editRec?.token !== token) return
  seqPlayer.play()
  // wait for the picture to reach the spot
  const t0 = performance.now()
  while (st().editRec?.token === token && seqPlayer.getTime() < at - 0.02 && performance.now() - t0 < (pre + 5) * 1000) {
    await new Promise((res) => setTimeout(res, 10))
  }
  if (st().editRec?.token !== token) return
  try {
    await voRec.start(project.folder, take.id)
  } catch (e) {
    cancelEditRec()
    return toast(String(e.message || e), 'error')
  }
  // where on the timeline the take's first sample is
  const start = seqPlayer.getTime()
  useStore.setState({ editRec: { ...st().editRec, phase: 'recording', start } })
  // pausing the cut (Space, K, the play button) ends the take too
  offState = seqPlayer.on('state', () => {
    if (st().editRec?.phase === 'recording' && !seqPlayer.playing) stopEditRec()
  })
}

export function cancelEditRec() {
  if (offState) { offState(); offState = null }
  useStore.setState({ editRec: null })
  seqPlayer.pause()
  restoreVo()
}

function restoreVo() {
  // the track's own volume / mute / solo come back (EditWorkspace applies them)
  useStore.setState((s) => ({ settings: { ...s.settings, voTrack: { ...(s.settings.voTrack || {}) } } }))
}

export async function stopEditRec() {
  const r = st().editRec
  if (!r || r.phase !== 'recording') return
  if (offState) { offState(); offState = null }
  useStore.setState({ editRec: { ...r, phase: 'saving' } })
  const res = await voRec.stop()
  seqPlayer.pause()
  useStore.setState({ editRec: null })
  restoreVo()
  if (!res || res.dur < 0.1) return toast('Nothing was recorded')
  const take = { ...r.take, dur: res.dur, pps: voRec.peaksPerSec }
  putPeaks(take.id, voRec.livePeaks().slice())
  const clip = useVo.getState().addTakeTo(r.vsId, take)
  if (!clip) return
  const sec = st().currentSection()
  const item = { id: VL.voId(), take: take.id, in: 0, out: take.dur, at: r.start, src: r.vsId, srcClip: clip.id }
  const vo = [...VL.clearRange((sec && sec.vo) || [], r.start, r.start + take.dur), item]
  st().setEditSel([])
  st().applyVo(vo, { select: [item.id] })
  st().updateSettings({ editVoSrc: r.vsId })
  seqPlayer.seek(r.start + take.dur)
  bus.emit('osd', 'Recorded ' + take.dur.toFixed(1) + ' s')
  // its words, for the label and the transcript
  const project = st().currentProject()
  if (project && st().settings.autoTranscribeOpen !== false && st().tx.installed) requestTx(project.folder, [take], st().settings.transcriptLang ?? 'en')
}

// T: the next line from the strip that isn't on the track yet, at the playhead.
export function tapPlace() {
  const vs = useVo.getState().sections
  const list = [...vs].sort((a, b) => a.order - b.order).filter((x) => x.clips.length)
  const src = list.find((x) => x.id === st().settings.editVoSrc) || list[0]
  if (!src) return bus.emit('osd', 'No voiceover yet')
  const sec = st().currentSection()
  const placed = new Set(((sec && sec.vo) || []).filter((v) => v.src === src.id).map((v) => v.srcClip))
  const items = VM.layoutVo(src.clips).items
  const next = items.findIndex((it) => !placed.has(it.id))
  if (next < 0) return bus.emit('osd', 'Every line is placed')
  if (st().placeVoClip(src.id, items[next].id, seqPlayer.getTime())) bus.emit('osd', 'Line ' + (next + 1) + ' placed')
}
