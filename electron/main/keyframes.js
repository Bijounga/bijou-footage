// Reads the exact keyframe timestamps of an MP4/MOV straight out of its
// index (the moov box — a few MB, usually at the end of the file), without
// touching the video data. OBS keyframes are *mostly* periodic but it
// inserts extra ones (scene changes, encoder resets), which shifts every
// keyframe after it — so a "every N seconds" guess lands just before a real
// keyframe surprisingly often, and that costs a full group-of-pictures
// decode (~0.5s at 1440p/high bitrate) instead of a single frame.
//
// Returns sorted presentation times in seconds, or null (MKV, fragmented
// MP4, anything unexpected — callers then fall back to no snapping).
import fs from 'fs'

function readBoxHeader(fd, pos, fileSize) {
  const b = Buffer.alloc(16)
  if (fs.readSync(fd, b, 0, 16, pos) < 8) return null
  let size = b.readUInt32BE(0)
  const type = b.toString('latin1', 4, 8)
  let header = 8
  if (size === 1) {
    size = Number(b.readBigUInt64BE(8))
    header = 16
  } else if (size === 0) size = fileSize - pos
  if (size < header) return null
  return { type, size, header }
}

// Children of a container box within buf[start, end).
function* children(buf, start, end) {
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    let header = 8
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8))
      header = 16
    } else if (size === 0) size = end - p
    if (size < header || p + size > end) return
    yield { type, start: p + header, end: p + size }
    p += size
  }
}

function find(buf, box, type) {
  for (const c of children(buf, box.start, box.end)) if (c.type === type) return c
  return null
}

function videoTrakKeyframes(buf, trak) {
  const mdia = find(buf, trak, 'mdia')
  if (!mdia) return null
  const hdlr = find(buf, mdia, 'hdlr')
  if (!hdlr || buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') return null
  const mdhd = find(buf, mdia, 'mdhd')
  const v1 = buf[mdhd.start] === 1
  const timescale = buf.readUInt32BE(mdhd.start + (v1 ? 20 : 12))
  const minf = find(buf, mdia, 'minf')
  const stbl = minf && find(buf, minf, 'stbl')
  if (!stbl || !timescale) return null
  const stts = find(buf, stbl, 'stts')
  const stss = find(buf, stbl, 'stss')
  const ctts = find(buf, stbl, 'ctts')
  if (!stts || !stss) return null

  // Keyframe sample numbers (1-based, ascending).
  const nSync = buf.readUInt32BE(stss.start + 4)
  const sync = new Array(nSync)
  for (let i = 0; i < nSync; i++) sync[i] = buf.readUInt32BE(stss.start + 8 + i * 4)

  // Walk stts (decode deltas) and ctts (composition offsets) in step,
  // recording pts for each keyframe sample.
  const nStts = buf.readUInt32BE(stts.start + 4)
  let cttsEntries = 0
  let cttsSigned = false
  if (ctts) {
    cttsSigned = buf[ctts.start] === 1
    cttsEntries = buf.readUInt32BE(ctts.start + 4)
  }
  // ctts is run-length encoded: entry cIdx covers samples
  // [cBase, cBase + cCount) (0-based).
  let cIdx = 0
  let cBase = 0
  let cCount = cttsEntries ? buf.readUInt32BE(ctts.start + 8) : 0
  const cOffsetAt = (i) => (cttsSigned ? buf.readInt32BE(ctts.start + 12 + i * 8) : buf.readUInt32BE(ctts.start + 12 + i * 8))

  const out = []
  let sample = 1
  let dts = 0
  let si = 0
  for (let e = 0; e < nStts && si < nSync; e++) {
    const count = buf.readUInt32BE(stts.start + 8 + e * 8)
    const delta = buf.readUInt32BE(stts.start + 12 + e * 8)
    // Jump straight to keyframes inside this run instead of per-sample.
    const runEnd = sample + count
    while (si < nSync && sync[si] < runEnd) {
      const s = sync[si]
      const d = dts + (s - sample) * delta
      // Advance ctts to (0-based) sample s-1; keyframes are ascending so
      // this only ever moves forward.
      let off = 0
      if (cttsEntries) {
        while (cIdx < cttsEntries && s - 1 >= cBase + cCount) {
          cBase += cCount
          cIdx++
          cCount = cIdx < cttsEntries ? buf.readUInt32BE(ctts.start + 8 + cIdx * 8) : 0
        }
        off = cIdx < cttsEntries ? cOffsetAt(cIdx) : 0
      }
      out.push((d + off) / timescale)
      si++
    }
    dts += count * delta
    sample = runEnd
  }

  // Edit list: the presentation timeline starts at media_time.
  const edts = find(buf, trak, 'edts')
  const elst = edts && find(buf, edts, 'elst')
  if (elst) {
    const ev1 = buf[elst.start] === 1
    const n = buf.readUInt32BE(elst.start + 4)
    let p = elst.start + 8
    for (let i = 0; i < n; i++) {
      const mediaTime = ev1 ? Number(buf.readBigInt64BE(p + 8)) : buf.readInt32BE(p + 4)
      p += ev1 ? 20 : 12
      if (mediaTime >= 0) {
        const shift = mediaTime / timescale
        for (let k = 0; k < out.length; k++) out[k] -= shift
        break
      }
    }
  }
  return out.map((t) => Math.round(t * 1e6) / 1e6).sort((a, b) => a - b)
}

export function readMp4Keyframes(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    let pos = 0
    let moov = null
    let guard = 0
    while (pos < size && guard++ < 64) {
      const h = readBoxHeader(fd, pos, size)
      if (!h) break
      if (h.type === 'moof') return null // fragmented MP4: no global index
      if (h.type === 'moov') {
        if (h.size > 256 * 1024 * 1024) return null
        moov = Buffer.alloc(h.size - h.header)
        fs.readSync(fd, moov, 0, moov.length, pos + h.header)
        break
      }
      pos += h.size
    }
    if (!moov) return null
    const root = { start: 0, end: moov.length }
    for (const c of children(moov, root.start, root.end)) {
      if (c.type !== 'trak') continue
      const kf = videoTrakKeyframes(moov, c)
      if (kf && kf.length) return kf
    }
    return null
  } catch {
    return null
  } finally {
    if (fd != null) fs.closeSync(fd)
  }
}
