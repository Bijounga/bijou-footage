// Transcripts of the voiceover takes. A take's WAV goes through the same
// Whisper queue as a recording (electron/main/transcribe.js) as a stand-in
// "recording" keyed 'vo:<take>', so they're made on the same GPU, saved with
// the others, and the result comes back through the usual transcript events
// (store.transcriptEvent forwards the 'vo:' ones here). The Voiceover tab
// shows the lines that are IN the cut — a clip's window of its take — placed
// on the timeline where they now play.
import { layoutVo } from './voModel.js'

const api = window.footage
const cache = new Map() // take id -> segments [[start, end, text, words]] | null (none)
const asked = new Set()
const subs = new Set()
const notify = () => subs.forEach((fn) => fn())

export const onTx = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}

// The stand-in recording for a take (what the transcriber is handed).
export function standIn(folder, take) {
  return {
    key: 'vo:' + take.id,
    size: Math.round(take.dur * 1000),
    path: folder + '/voiceover/audio/' + take.id + '.wav',
    probe: { duration: take.dur, audio: [{}] }
  }
}

export const transcriptOf = (takeId) => cache.get(takeId) || null

// Read a take's saved transcript, if it has one.
export async function loadTx(folder, take) {
  if (cache.has(take.id)) return
  cache.set(take.id, null)
  const d = await api.readTranscript(standIn(folder, take), 0).catch(() => null)
  if (d && d.segments) {
    cache.set(take.id, d.segments)
    notify()
  } else cache.delete(take.id)
}

// Queue the takes that have no transcript yet (the newest first).
export function requestTx(folder, takes, language, front = true) {
  const jobs = []
  for (const t of takes) {
    if (!t || t.dur < 0.3 || asked.has(t.id) || cache.get(t.id)) continue
    asked.add(t.id)
    jobs.push({ clip: standIn(folder, t), track: 0 })
  }
  if (jobs.length) api.requestTranscripts(jobs, language, front)
  return jobs.length
}

// A transcript event from main for a 'vo:' recording.
export function onEvent(ev) {
  const id = String(ev.key).slice(3)
  if (ev.type === 'done') {
    cache.set(id, ev.segments)
    notify()
  } else if (ev.type === 'error') {
    asked.delete(id) // try again next time
    notify()
  }
}

// What's said between a and b (seconds into a take) — for labelling a clip.
export function textIn(takeId, a, b) {
  const segs = transcriptOf(takeId)
  if (!segs) return ''
  const out = []
  for (const [s, e, text, words] of segs) {
    if (e <= a + 0.01 || s >= b - 0.01) continue
    if (words && words.length) for (const w of words) { if (w[0] >= a - 0.02 && w[0] < b - 0.02) out.push(String(w[2]).trim()) }
    else out.push(String(text || '').trim())
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

// Words → short lines: after a sentence end, after 18 words, or at a pause
// of a second (Whisper's own segments can run to half a minute).
function splitWords(words) {
  const lines = []
  let cur = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    cur.push(w)
    const end = /[.?!…]["')\]]?$/.test(String(w[2]).trim())
    const gap = i + 1 < words.length ? words[i + 1][0] - w[1] : 0
    if (end || cur.length >= 18 || gap > 1) {
      lines.push(cur)
      cur = []
    }
  }
  if (cur.length) lines.push(cur)
  return lines
}
const wordsText = (w) => w.map((x) => String(x[2]).trim()).join(' ').replace(/\s+/g, ' ').trim()

// The lines of speech that are in the cut, in timeline time. A clip shows
// only the words inside its window of the take.
export function buildLines(clips) {
  const out = []
  for (const it of layoutVo(clips).items) {
    const segs = transcriptOf(it.take)
    if (!segs) continue
    for (const [s, e, text, words] of segs) {
      if (e <= it.in + 0.01 || s >= it.out - 0.01) continue
      const put = (a, b, t) => {
        a = Math.max(a, it.in)
        b = Math.min(b, it.out)
        if (t) out.push({ id: it.id + '@' + a.toFixed(2), clip: it.id, take: it.take, a, b, start: it.start + a - it.in, end: it.start + b - it.in, text: t })
      }
      if (words && words.length) {
        const inside = words.filter((x) => x[0] >= it.in - 0.02 && x[0] < it.out - 0.02)
        for (const line of splitWords(inside)) put(line[0][0], line[line.length - 1][1], wordsText(line))
      } else put(s, e, String(text || '').trim())
    }
  }
  return out.sort((x, y) => x.start - y.start)
}
