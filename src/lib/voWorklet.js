// Voiceover capture (an AudioWorklet — runs on the audio thread, so nothing
// the page does can make it drop samples). The microphone comes in mono;
// the input gain is applied here. While recording it hands the page chunks
// of samples plus their waveform peaks (one byte per `peakEvery` samples, sqrt of the peak);
// always, ~30 times a second, the input level for the meter.
class VoCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.peakEvery = o.peakEvery || 240
    this.chunk = o.chunk || this.peakEvery * 20
    this.buf = new Float32Array(this.chunk)
    this.n = 0
    this.recording = false
    this.gain = 1
    this.levelEvery = Math.round(sampleRate / 30)
    this.levelN = 0
    this.levelPeak = 0
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if ('gain' in d) this.gain = d.gain
      if ('recording' in d) {
        if (d.recording) {
          this.n = 0
          this.recording = true
        } else if (this.recording) {
          this.recording = false
          this.flush()
          this.port.postMessage({ stopped: true })
        }
      }
    }
  }
  flush() {
    if (!this.n) return
    const s = this.buf.slice(0, this.n)
    const pk = new Uint8Array(Math.ceil(this.n / this.peakEvery))
    for (let i = 0; i < pk.length; i++) {
      let m = 0
      const end = Math.min(this.n, (i + 1) * this.peakEvery)
      for (let j = i * this.peakEvery; j < end; j++) {
        const a = s[j] < 0 ? -s[j] : s[j]
        if (a > m) m = a
      }
      pk[i] = Math.min(255, Math.round(Math.sqrt(Math.min(1, m)) * 255)) // sqrt: fine detail near silence
    }
    this.port.postMessage({ samples: s, peaks: pk }, [s.buffer, pk.buffer])
    this.n = 0
  }
  process(inputs) {
    const inp = inputs[0]
    if (!inp || !inp.length) return true
    const ch = inp.length
    const len = inp[0].length
    for (let i = 0; i < len; i++) {
      let v = 0
      for (let c = 0; c < ch; c++) v += inp[c][i]
      v = (v / ch) * this.gain
      const a = v < 0 ? -v : v
      if (a > this.levelPeak) this.levelPeak = a
      if (this.recording) {
        this.buf[this.n++] = v
        if (this.n === this.chunk) this.flush()
      }
    }
    this.levelN += len
    if (this.levelN >= this.levelEvery) {
      this.port.postMessage({ level: this.levelPeak })
      this.levelPeak = 0
      this.levelN = 0
    }
    return true
  }
}
registerProcessor('vo-capture', VoCapture)
