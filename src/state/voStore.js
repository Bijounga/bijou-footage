// The Voiceover tab's state: the current project's VO sections (saved in
// its folder — voiceover.js), which one is open, what's selected, undo /
// redo, and recording. Kept apart from the main store; it reads the
// project and settings from there.
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useStore, registerVoStore } from './store.js'
import * as VM from '../lib/voModel.js'
import { voPlayer } from '../lib/voPlayer.js'
import { voRec } from '../lib/voRecorder.js'
import { ensurePeaks, peaksOf, putPeaks } from '../lib/voPeaks.js'
import { requestTx } from '../lib/voTranscripts.js'

let clipboard = [] // copied clips (Ctrl+C / Ctrl+X)

const api = window.footage
const main = () => useStore.getState()
const project = () => main().currentProject()
const folder = () => (project() && project().folder) || null
// Transcribe the takes in the open section that have no transcript yet — on
// its own, like Edit (unless "Transcribe a recording when I open it" is off).
function autoTx() {
  const st = main()
  const sec = useVo.getState().current()
  const f = folder()
  if (!sec || !f || st.settings.autoTranscribeOpen === false || !st.tx.installed) return
  requestTx(f, sec.clips.flatMap((c) => c.takes), st.settings.transcriptLang ?? 'en')
}

// ---- autosave: each section's file a moment after it changes ----
const saved = new Map() // id -> json
const secJson = (x) => JSON.stringify([x.name, x.order, x.script || '', x.clips])
let timer = null
async function syncToDisk() {
  const st = useVo.getState()
  const p = main().projects.find((q) => q.id === st.sectionsFor)
  if (!p || !p.folder) return
  for (const x of st.sections) {
    const json = secJson(x)
    if (saved.get(x.id) === json) continue
    await api.voSave(p.folder, x)
    saved.set(x.id, json)
  }
}
export function flushVoSave() {
  clearTimeout(timer)
  return syncToDisk()
}

export const useVo = create(
  immer((set, get) => ({
    sections: [],
    sectionsFor: null, // project id the sections belong to
    sel: [], // selected clip ids
    range: null, // {a, b}: a stretch of the timeline selected by dragging on the waveform
    txHits: [], // timeline times of the transcript search hits (drawn on the ruler)
    undo: [],
    redo: [],
    // recording: null | {phase: 'countdown'|'recording', count, idx (insert index), take}
    rec: null,

    current() {
      const st = get()
      const p = project()
      if (!p || st.sectionsFor !== p.id) return null
      const id = (main().settings.voSectionByProject || {})[p.id]
      const sorted = [...st.sections].sort((a, b) => a.order - b.order)
      return st.sections.find((x) => x.id === id) || sorted[0] || null
    },
    async load() {
      const p = project()
      if (!p || !p.folder) {
        set((s) => { s.sections = []; s.sectionsFor = p ? p.id : null })
        return
      }
      if (get().sectionsFor === p.id) return
      await flushVoSave()
      const list = await api.voList(p.folder)
      for (const x of list) saved.set(x.id, secJson(x))
      set((s) => {
        s.sections = list
        s.sectionsFor = p.id
        s.sel = []
        s.undo = []
        s.redo = []
      })
      get().showInPlayer()
      setTimeout(autoTx, 800)
    },
    showInPlayer() {
      const sec = get().current()
      voPlayer.setSection(folder(), sec ? sec.clips : [])
    },
    setCurrent(id) {
      const p = project()
      if (!p) return
      voPlayer.pause()
      main().updateSettings({ voSectionByProject: { ...(main().settings.voSectionByProject || {}), [p.id]: id } })
      set((s) => { s.sel = [] })
      get().showInPlayer()
      voPlayer.seek(0)
      setTimeout(autoTx, 400)
    },
    createSection(name) {
      const p = project()
      if (!p) return null
      const sec = { id: 'o' + Date.now().toString(36), name: name || 'Section ' + (get().sections.length + 1), order: get().sections.reduce((a, x) => Math.max(a, x.order + 1), 0), script: '', clips: [], createdAt: Date.now() }
      set((s) => {
        s.sections.push(sec)
        s.sectionsFor = p.id
      })
      get().setCurrent(sec.id)
      return sec.id
    },
    // A take recorded somewhere else (over the cut, in Edit) joins the end of
    // a section as a new clip. Returns the clip.
    addTakeTo(sectionId, take) {
      const sec = get().sections.find((x) => x.id === sectionId)
      if (!sec) return null
      const made = VM.addRecording(sec.clips, sec.clips.length, take)
      set((s) => { s.sections.find((x) => x.id === sectionId).clips = made.clips })
      if (get().current() && get().current().id === sectionId) voPlayer.setSection(folder(), made.clips)
      return made.clip
    },
    renameSection(id, name) {
      name = String(name || '').trim()
      if (!name) return
      set((s) => {
        const x = s.sections.find((q) => q.id === id)
        if (x) x.name = name
      })
    },
    moveSection(id, dir) {
      set((s) => {
        const sorted = [...s.sections].sort((a, b) => a.order - b.order)
        const i = sorted.findIndex((x) => x.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= sorted.length) return
        const a = s.sections.find((x) => x.id === sorted[i].id)
        const b = s.sections.find((x) => x.id === sorted[j].id)
        const o = a.order
        a.order = b.order
        b.order = o
      })
    },
    async deleteSection(id) {
      const f = folder()
      const wasCurrent = get().current() && get().current().id === id
      set((s) => { s.sections = s.sections.filter((x) => x.id !== id) })
      saved.delete(id)
      if (f) await api.voTrash(f, id)
      if (wasCurrent) {
        const next = [...get().sections].sort((a, b) => a.order - b.order)[0]
        if (next) get().setCurrent(next.id)
        else get().showInPlayer()
      }
    },
    setScript(text) {
      const sec = get().current()
      if (!sec) return
      set((s) => {
        const x = s.sections.find((q) => q.id === sec.id)
        x.script = text
      })
    },
    setSel(ids) {
      set((s) => { s.sel = ids })
    },
    setRange(r) {
      set((s) => { s.range = r })
    },

    // One change to the current section's clips = one undo step.
    apply(clips, { select = null } = {}) {
      const sec = get().current()
      if (!sec) return false
      set((s) => {
        const x = s.sections.find((q) => q.id === sec.id)
        s.undo.push({ id: sec.id, clips: x.clips })
        if (s.undo.length > 200) s.undo.shift()
        s.redo = []
        x.clips = clips
        s.sel = select || s.sel.filter((id) => clips.some((c) => c.id === id))
      })
      voPlayer.setSection(folder(), clips)
      return true
    },
    undoRedo(redo = false) {
      const sec = get().current()
      if (!sec) return
      const from = redo ? get().redo : get().undo
      const i = from.map((e) => e.id).lastIndexOf(sec.id)
      if (i < 0) return
      const entry = from[i]
      set((s) => {
        const x = s.sections.find((q) => q.id === sec.id)
        ;(redo ? s.undo : s.redo).push({ id: sec.id, clips: x.clips })
        ;(redo ? s.redo : s.undo).splice(i, 1)
        x.clips = entry.clips
        s.sel = s.sel.filter((id) => entry.clips.some((c) => c.id === id))
      })
      voPlayer.setSection(folder(), entry.clips)
    },
    // Cut the timeline range [a, b) out; what's after it closes up.
    cutRange(a, b) {
      const sec = get().current()
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      if (!sec || hi - lo < 0.01) return false
      const clips = VM.cutRange(sec.clips, lo, hi)
      const ok = get().apply(clips, { select: [] })
      set((s) => { s.range = null })
      voPlayer.seek(Math.min(lo, VM.totalVo(clips)))
      return ok
    },
    // Delete / G: the range if there is one, else the selected clips.
    deleteSelected() {
      const st = get()
      const sec = st.current()
      if (!sec) return false
      if (st.range) return st.cutRange(st.range.a, st.range.b)
      if (!st.sel.length) return false
      const first = VM.layoutVo(sec.clips).items.find((it) => st.sel.includes(it.id))
      const ok = get().apply(VM.removeClips(sec.clips, st.sel), { select: [] })
      if (ok && first) voPlayer.seek(first.start)
      return ok
    },
    // F: cut at the playhead.
    splitAtPlayhead() {
      const sec = get().current()
      const next = sec && VM.splitAt(sec.clips, voPlayer.getTime())
      return next ? get().apply(next) : false
    },
    // D: select the clip under the playhead.
    selectAtPlayhead() {
      const sec = get().current()
      const at = sec && VM.locateVo(sec.clips, voPlayer.getTime())
      if (!at) return false
      set((s) => { s.sel = [at.item.id]; s.range = null })
      return true
    },
    // A / S: ripple-delete what's before / after the playhead in its clip.
    trimAroundPlayhead(before) {
      const sec = get().current()
      if (!sec) return false
      const T = voPlayer.getTime()
      const next = before ? VM.trimBefore(sec.clips, T) : VM.trimAfter(sec.clips, T)
      if (!next) return false
      const ok = get().apply(next, { select: [] })
      if (ok && before) {
        const at = VM.locateVo(sec.clips, T)
        if (at) voPlayer.seek(at.item.start)
      }
      return ok
    },
    // Auto-cut the silences out of the selected clips (all if none are).
    async autoCut(preset) {
      const sec = get().current()
      const f = folder()
      if (!sec || !f) return null
      const ids = get().sel.length ? get().sel : []
      await ensurePeaks(f, sec.clips.map((c) => c.take))
      const { clips, removed } = VM.autoCut(sec.clips, ids, peaksOf, preset)
      if (removed < 0.01) {
        main().showToast('No silences to cut')
        return 0
      }
      get().apply(clips, { select: [] })
      main().showToast('Cut ' + removed.toFixed(1) + ' s of silence')
      return removed
    },
    copySelected(cut = false) {
      const st = get()
      const sec = st.current()
      if (!sec || !st.sel.length) return false
      clipboard = sec.clips.filter((c) => st.sel.includes(c.id)).map((c) => ({ ...c }))
      if (cut) st.deleteSelected()
      return true
    },
    paste() {
      const sec = get().current()
      if (!sec || !clipboard.length) return false
      const idx = VM.insertIndexAt(sec.clips, voPlayer.getTime())
      const { clips, ids } = VM.pasteClips(sec.clips, idx, clipboard)
      const ok = get().apply(clips, { select: ids })
      const it = VM.layoutVo(clips).items.find((x) => x.id === ids[ids.length - 1])
      if (it) voPlayer.seek(it.start + it.dur)
      return ok
    },
    colorSelected(color) {
      const sec = get().current()
      if (!sec || !get().sel.length) return false
      return get().apply(VM.colorClips(sec.clips, get().sel, color))
    },

    // ---- recording ----
    // R: count in (pre-roll), then record; R again (or the button) stops.
    // The new clip goes at the playhead (at the end, or after the clip it's
    // in) and the playhead moves past it, ready for the next one.
    //
    // Re-record (Shift+R) and punch-in (P) record over a stretch of the
    // timeline instead: [a, b) is cut out and the new take takes its place
    // (the rest ripples — closes up or opens up, whatever the new length is).
    // Before the take starts, the audio just before the spot plays for the
    // pre-roll's length, so you pick up in the same voice and pace.
    async toggleRecord() {
      const r = get().rec
      if (r) return r.phase === 'recording' ? get().stopRecord() : get().cancelRecord()
      return get().beginRecord(null)
    },
    async beginRecord(replace) {
      let sec = get().current()
      const f = folder()
      if (!f) return main().showToast('Pick a projects folder first (Settings → General)', 'error')
      if (!sec) get().createSection()
      sec = get().current()
      voPlayer.pause()
      if (!(await voRec.open(main().settings.voMic || null))) return main().showToast(voRec.error || 'The microphone didn\u2019t open', 'error')
      const at = replace ? replace.a : voPlayer.getTime()
      const idx = replace ? 0 : VM.insertIndexAt(sec.clips, at)
      const take = { id: VM.takeId(), dur: 0, created: Date.now(), marks: [] }
      const pre = main().settings.voPreroll ?? 3
      const token = {}
      // a lead-in only when replacing, and only if there's audio before the spot
      const lead = replace ? Math.min(pre, replace.a) : 0
      const leadIn = lead > 0.3
      set((s) => { s.rec = { phase: leadIn ? 'preroll' : pre > 0 ? 'countdown' : 'recording', count: pre, idx, take, token, replace: replace || null } })
      if (leadIn) {
        voPlayer.seek(replace.a - lead)
        await voPlayer.play()
        const t0 = performance.now()
        while (get().rec && get().rec.token === token && voPlayer.getTime() < replace.a - 0.02 && performance.now() - t0 < (lead + 3) * 1000 / Math.max(0.5, voPlayer.rate)) {
          await new Promise((res) => setTimeout(res, 20))
        }
        voPlayer.pause()
        if (!get().rec || get().rec.token !== token) return // cancelled
      } else {
        for (let c = pre; c > 0; c--) {
          set((s) => { if (s.rec) s.rec.count = c })
          await new Promise((res) => setTimeout(res, 1000))
          if (!get().rec || get().rec.token !== token) return // cancelled
        }
      }
      try {
        await voRec.start(f, take.id)
      } catch (e) {
        set((s) => { s.rec = null })
        return main().showToast(String(e.message || e), 'error')
      }
      set((s) => { if (s.rec) s.rec.phase = 'recording' })
    },
    // Shift+R: redo the selected clip(s) — or the clip at the playhead.
    rerecord() {
      if (get().rec) return false
      const sec = get().current()
      if (!sec || !sec.clips.length) return main().showToast('There is nothing to re-record yet') && false
      const items = VM.layoutVo(sec.clips).items
      let pick = items.filter((it) => get().sel.includes(it.id))
      if (!pick.length) {
        const at = VM.locateVo(sec.clips, voPlayer.getTime())
        if (at) pick = [at.item]
      }
      if (!pick.length) return false
      const a = Math.min(...pick.map((it) => it.start))
      const b = Math.max(...pick.map((it) => it.start + it.dur))
      get().beginRecord({ a, b })
      return true
    },
    // P: punch in — record over the stretch you dragged on the waveform.
    punchIn() {
      if (get().rec) return false
      const r = get().range
      if (!r || Math.abs(r.b - r.a) < 0.05) {
        main().showToast('Drag over the part you want to redo on the waveform first, then punch in')
        return false
      }
      set((s) => { s.range = null })
      get().beginRecord({ a: Math.min(r.a, r.b), b: Math.max(r.a, r.b) })
      return true
    },
    cancelRecord() {
      voPlayer.pause()
      set((s) => { s.rec = null })
    },
    async stopRecord() {
      const r = get().rec
      if (!r || r.phase !== 'recording') return
      const res = await voRec.stop()
      set((s) => { s.rec = null })
      if (!res || res.dur < 0.05) return
      const sec = get().current()
      putPeaks(r.take.id, voRec.livePeaks().slice())
      const take = { ...r.take, dur: res.dur, pps: voRec.peaksPerSec, marks: [...(r.take.marks || [])] }
      let clips
      let clip
      if (r.replace) {
        const { a, b } = r.replace
        // the new take replaces what was there: ripple (closes up or opens up)
        const items = VM.layoutVo(sec.clips).items
        const same = items.filter((it) => it.start >= a - 1e-3 && it.start + it.dur <= b + 1e-3)
        const whole = same.length === 1 && Math.abs(same[0].start - a) < 1e-3 && Math.abs(same[0].start + same[0].dur - b) < 1e-3
        const old = whole ? same[0].clip : null
        const cut = VM.cutRange(sec.clips, a, b)
        const idx = VM.insertIndexAt(cut, a)
        const made = VM.addRecording(cut, idx, take)
        clips = made.clips
        clip = made.clip
        if (old) {
          // the same clip, redone: keeps its place in line, colour and level; the
          // old recording stays in its files (and comes back with undo)
          const k = clips.findIndex((c) => c.id === clip.id)
          clip = { ...clip, id: old.id, color: old.color, gain: old.gain, takes: [...old.takes, take] }
          clips = clips.slice()
          clips[k] = clip
        }
      } else {
        const made = VM.addRecording(sec.clips, Math.min(r.idx, sec.clips.length), take)
        clips = made.clips
        clip = made.clip
      }
      get().apply(clips, { select: [clip.id] })
      // the playhead to the end of the new clip
      const it = VM.layoutVo(clips).items.find((x) => x.id === clip.id)
      if (it) voPlayer.seek(it.start + it.dur)
      autoTx() // the new take's words, on their own
    },
    // The level of the selected clips, in dB (0 = as recorded).
    setClipGain(db) {
      const sec = get().current()
      if (!sec || !get().sel.length) return false
      return get().apply(VM.gainClips(sec.clips, get().sel, db))
    },
    // M while recording: a mistake marker at this moment of the take.
    markMistake() {
      const r = get().rec
      if (!r || r.phase !== 'recording') return false
      const t = voRec.dur
      set((s) => { s.rec.take.marks.push(t) })
      return true
    }
  }))
)

registerVoStore(useVo)
useVo.subscribe((st, prev) => {
  if (st.sections !== prev.sections) {
    clearTimeout(timer)
    timer = setTimeout(syncToDisk, 500)
  }
})
window.addEventListener('beforeunload', () => { flushVoSave() })
if (typeof window !== 'undefined') window.__vo = useVo // for tests (scripts/cdp.mjs)
