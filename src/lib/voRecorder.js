// The microphone, for the Voiceover tab. open() starts it (and the level
// meter); start(file) / stop() record a take: the worklet's chunks go
// straight to the WAV on disk (main: voiceover.js), and their peaks are
// kept here too, so the timeline can draw the take while it's recorded.
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
  peaks: [], // Uint8Array chunks
  samples: 0,
  stopWait: null,

  on(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get recording() {
    return !!this.file
  },
  // Seconds recorded so far.
  get dur() {
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
    if (d.samples && this.file) {
      api.voRecChunk(this.file, d.samples.buffer, d.peaks.buffer)
      this.peaks.push(d.peaks)
      this.samples += d.samples.length
    }
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
    this.node.port.postMessage({ recording: true })
    emit()
  },
  // Stop: the last samples are flushed, then the WAV is finished.
  async stop() {
    if (!this.file) return null
    const done = new Promise((r) => { this.stopWait = r })
    this.node.port.postMessage({ recording: false })
    await Promise.race([done, new Promise((r) => setTimeout(r, 1000))])
    const file = this.file
    this.file = null
    const res = await api.voRecStop(file)
    emit()
    return res
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
