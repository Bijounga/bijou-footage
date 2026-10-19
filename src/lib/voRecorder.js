// The microphone, for the Voiceover tab. open() starts it (and the level
// meter); start(file) / stop() record a take.
//
// The take itself is recorded by a MediaRecorder (lossless PCM) straight
// from the microphone's stream, and written to the WAV when it stops
// (main: voiceover.js). The worklet only feeds the meter and the live
// waveform: its input goes through WebAudio's render clock, which was
// measured (2026-10-18) dropping ~37% of the input at times — on every
// microphone, hardware or virtual — and the takes came out short, choppy
// and fast. A MediaRecorder on the same stream got every sample.
// Raw input: no echo cancellation, noise suppression or auto gain — a
// voiceover wants the microphone as it is.
import workletUrl from './voWorklet.js?url' // emitted as a file (electron.vite.config.js)

const api = window.footage
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())

export const voRec = {
  ctx: null,
  stream: null,
  node: null,
  deviceId: null,
  error: null,
  level: 0, // 0–1, the input peak of the last ~30 ms
  clipped: 0, // performance.now() of the last clip (input ≥ 0.99)
  sampleRate: 48000,
  peaksPerSec: 200,
  // the take being recorded
  file: null,
  peaks: [], // Uint8Array chunks (live: the worklet's; after stop: the take's own)
  samples: 0, // the finished take's length in samples (after stop)
  startedAt: 0, // performance.now() when the take started
  mr: null, // the MediaRecorder making the take
  parts: [],
  stopWait: null,

  on(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get recording() {
    return !!this.file
  },
  // Seconds recorded so far (while recording: the time since it started —
  // the worklet's sample count runs short when its input drops).
  get dur() {
    if (this.file) return Math.max(0, (performance.now() - this.startedAt) / 1000)
    return this.samples / this.sampleRate
  },

  async open(deviceId = null) {
    if (this.ctx && this.deviceId === deviceId && !this.error) return true
    await this.close()
    this.deviceId = deviceId
    this.error = null
    try {
      await api.voMicAccess()
      const want = (id) => ({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      this.fellBack = false
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(want(deviceId))
      } catch (e) {
        // The chosen microphone isn't there (unplugged, another computer):
        // use the default one rather than not recording at all.
        if (!deviceId || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e
        this.stream = await navigator.mediaDevices.getUserMedia(want(null))
        this.deviceId = null
        this.fellBack = true
      }
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      await ctx.audioWorklet.addModule(workletUrl)
      this.sampleRate = ctx.sampleRate
      const peakEvery = Math.round(ctx.sampleRate / 200)
      this.peaksPerSec = ctx.sampleRate / peakEvery
      const node = new AudioWorkletNode(ctx, 'vo-capture', { processorOptions: { peakEvery, chunk: peakEvery * 20 } })
      ctx.createMediaStreamSource(this.stream).connect(node)
      // A worklet only runs while it's pulled: feed it into a silent output.
      const mute = ctx.createGain()
      mute.gain.value = 0
      node.connect(mute).connect(ctx.destination)
      node.port.onmessage = (e) => this.message(e.data)
      this.ctx = ctx
      this.node = node
      this.setGain(this.gain ?? 1)
      emit()
      return true
    } catch (e) {
      this.error = e && e.name === 'NotAllowedError' ? 'Microphone access was refused' : e && e.name === 'NotFoundError' ? 'No microphone found' : String((e && e.message) || e)
      emit()
      return false
    }
  },
  async close() {
    if (this.recording) await this.stop()
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop())
    if (this.ctx) await this.ctx.close().catch(() => {})
    this.stream = null
    this.ctx = null
    this.node = null
    this.level = 0
  },
  setGain(g) {
    this.gain = g
    if (this.node) this.node.port.postMessage({ gain: g })
  },
  message(d) {
    if (d.level != null) {
      this.level = d.level
      if (d.level >= 0.99) this.clipped = performance.now()
      emit()
    }
    // the live waveform only; the take is the MediaRecorder's
    if (d.peaks && this.file) this.peaks.push(d.peaks)
    if (d.stopped && this.stopWait) {
      this.stopWait()
      this.stopWait = null
    }
  },
  // Start writing a take (the WAV is created in the project's folder).
  async start(folder, take) {
    if (!this.node) throw new Error(this.error || 'The microphone isn’t open')
    this.file = await api.voRecStart(folder, take, this.sampleRate, 1)
    this.peaks = []
    this.samples = 0
    this.parts = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=pcm') ? 'audio/webm;codecs=pcm' : 'audio/webm;codecs=opus'
    this.mr = new MediaRecorder(this.stream, { mimeType: mime, audioBitsPerSecond: 510000 })
    const parts = this.parts
    this.mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data) }
    this.mr.start(1000)
    this.startedAt = performance.now()
    this.node.port.postMessage({ recording: true }) // the live waveform
    emit()
  },
  // Stop: the last samples are flushed, then the WAV is finished.
  async stop() {
    if (!this.file) return null
    const file = this.file
    this.node.port.postMessage({ recording: false })
    const mr = this.mr
    const parts = this.parts
    this.mr = null
    if (mr && mr.state !== 'inactive') await new Promise((r) => { mr.onstop = r; mr.stop() })
    this.file = null
    try {
      await this.writeTake(file, new Blob(parts, { type: (mr && mr.mimeType) || 'audio/webm' }))
    } catch (e) {
      console.error('voiceover: could not save the take', e)
    }
    const res = await api.voRecStop(file)
    emit()
    return res
  },
  // The recorded take → mono samples (with the input gain) and their peaks,
  // written to the WAV in pieces; the peaks replace the live ones.
  async writeTake(file, blob) {
    const ac = new OfflineAudioContext(1, 1, this.sampleRate) // decodes at the WAV's rate
    const ab = await ac.decodeAudioData(await blob.arrayBuffer())
    const n = ab.length
    const out = new Float32Array(n)
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const d = ab.getChannelData(c)
      for (let i = 0; i < n; i++) out[i] += d[i]
    }
    const k = (this.gain ?? 1) / ab.numberOfChannels
    if (k !== 1) for (let i = 0; i < n; i++) out[i] *= k
    const pe = Math.round(this.sampleRate / 200) // as the worklet: one peak per 5 ms
    const pk = new Uint8Array(Math.ceil(n / pe))
    for (let j = 0; j < pk.length; j++) {
      let m = 0
      const end = Math.min(n, (j + 1) * pe)
      for (let i = j * pe; i < end; i++) {
        const a = out[i] < 0 ? -out[i] : out[i]
        if (a > m) m = a
      }
      pk[j] = Math.min(255, Math.round(Math.sqrt(Math.min(1, m)) * 255))
    }
    const step = pe * 1000 // ~5 s of samples per piece
    for (let i = 0; i < n; i += step) {
      const s = out.slice(i, i + step)
      const p = pk.slice(i / pe, Math.ceil(Math.min(n, i + step) / pe))
      api.voRecChunk(file, s.buffer, p.buffer)
    }
    this.peaks = [pk]
    this.samples = n
  },
  // All the take's peaks so far, as one array.
  livePeaks() {
    if (this.peaks.length > 1) {
      const all = new Uint8Array(this.peaks.reduce((a, p) => a + p.length, 0))
      let o = 0
      for (const p of this.peaks) {
        all.set(p, o)
        o += p.length
      }
      this.peaks = [all]
    }
    return this.peaks[0] || new Uint8Array(0)
  }
}

export async function listMics() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  } catch {
    return []
  }
}

if (typeof window !== 'undefined') window.__voRec = voRec // for tests (scripts/cdp.mjs)
