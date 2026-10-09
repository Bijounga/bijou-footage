// Exports notes as a Final Cut Pro 7 XML (xmeml) file, which Premiere
// imports via File > Import. Each recording that has notes becomes its own
// sequence — the full clip on V1/A1..An starting at 0 — with every note as
// a sequence marker (and a clip marker) at the matching time, so opening
// that sequence drops you straight onto your reviewed moments.

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Premiere writes/reads Windows paths as file://localhost/F%3a/dir/file.mp4
function pathUrl(p) {
  const norm = p.replace(/\\/g, '/')
  const parts = norm.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg[0] + '%3a' : encodeURIComponent(seg)))
  return 'file://localhost/' + parts.join('/').replace(/^\/+/, '')
}

// Square pixels, progressive. Without this Premiere assumes a non-square
// pixel aspect and imports Motion Scale as unequal width / height (the
// picture looks squished). FilmCraft's FCP7 writer states it the same way.
const SQUARE = '<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance>'

function rateFor(fps) {
  const f = fps || 60
  const rounded = Math.round(f)
  const ntsc = Math.abs(f - rounded) > 0.01
  return { timebase: rounded, ntsc, fps: f }
}

function rateXml(r) {
  return `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
}

const LABEL = { SETUP: 'Setup', AND_THEN: 'And Then', BECAUSE: 'Because', BUT: 'But', THEREFORE: 'Therefore', NOTE: 'Note', MARKER: 'Marker' }
const MARKER_LABEL = { green: 'Green', red: 'Red', purple: 'Purple', orange: 'Orange', yellow: 'Yellow', white: 'White', blue: 'Blue', cyan: 'Cyan' }

// Premiere's own marker colors (the <pproColor> tag it writes on its XML
// export and reads back on import), read from a Premiere export of one
// marker per color on 2026-09-27. Green is Premiere's default, so it has
// no tag. The number stores the color as 0xAABBGGRR.
const MARKER_PPRO = { red: 4281740498, yellow: 4281049552, purple: 4289825711, orange: 4280578025, white: 4294967295, blue: 4294741314, cyan: 4292277273 }

function markersXml(notes, r) {
  return notes
    .map((n) => {
      const inF = Math.round(n.t * r.fps)
      const outF = n.end != null ? Math.round(n.end * r.fps) : -1
      // The color goes in <pproColor> (below) where it's known, and in the
      // name too ("Yellow marker"), in case the import drops the tag.
      const color = MARKER_LABEL[n.color] || 'Yellow'
      const name = n.type === 'MARKER' ? (n.text ? `${n.text} (${color})` : `${color} marker`) : (LABEL[n.type] || n.type)
      const comment = n.type === 'MARKER' ? `${color} marker` : n.text
      const ppro = n.type === 'MARKER' && MARKER_PPRO[n.color] ? `<pproColor>${MARKER_PPRO[n.color]}</pproColor>` : ''
      return `<marker><name>${esc(name)}${n.star ? ' ★' : ''}</name><comment>${esc(comment)}</comment><in>${inF}</in><out>${outF}</out>${ppro}</marker>`
    })
    .join('')
}

// Audio, the Premiere way. FCP7 XML has no stereo tracks. Premiere's own
// exports write each stereo track as a pair of mono tracks tagged
// premiereTrackType="Stereo" + currentExplodedTrackIndex 0/1 of
// totalExplodedTrackCount 2, with premiereChannelType="stereo" clipitems,
// and glue each pair back into one stereo track on import. We do the same,
// one pair per OBS track, so every OBS track arrives as one stereo track.
// Careful with <sourcetrack><trackindex>: on plain clips it counts
// CHANNELS (1–4 came in as "Ch. L (1), Ch. R (1), Ch. L (2), Ch. R (2)"),
// but on stereo-tagged pairs it counts STREAMS.
// Sketch notes → a second video track (V2): each sketch a still image at
// its moment, a few seconds long, turned off — there to see (and turn on as
// an overlay guide), never in the render. items: [{t (s), file, text}]
const SKETCH_SECS = 3
function sketchTrackXml(items, r, w, h, prefix) {
  const list = items.filter((x) => x.file).sort((a, b) => a.t - b.t)
  if (!list.length) return ''
  const D = Math.round(SKETCH_SECS * r.fps)
  const clips = list.map((x, i) => {
    const start = Math.round(x.t * r.fps)
    const next = list[i + 1] ? Math.round(list[i + 1].t * r.fps) : Infinity
    const end = Math.max(start + 1, Math.min(start + D, next)) // no overlaps on the track
    const len = end - start
    const nm = 'Sketch' + (x.text ? ' — ' + x.text : '')
    const fid = prefix + '-file-' + i
    return `<clipitem id="${prefix}-${i}"><name>${esc(nm)}</name><enabled>FALSE</enabled><duration>${len}</duration>${rateXml(r)}<start>${start}</start><end>${end}</end><in>0</in><out>${len}</out><file id="${fid}"><name>${esc(x.file.split(/[\\/]/).pop())}</name><pathurl>${esc(pathUrl(x.file))}</pathurl>${rateXml(r)}<duration>${len}</duration><media><video><samplecharacteristics><width>${w}</width><height>${h}</height>${SQUARE}</samplecharacteristics></video></media></file></clipitem>`
  })
  return `<track>${clips.join('')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`
}

function audioLayout(audio) {
  const out = [] // [{stream, channels, firstChannel}]
  let ch = 1
  for (let i = 0; i < audio.length; i++) {
    const channels = Math.min(2, Math.max(1, audio[i].channels || 2))
    out.push({ stream: i, channels, firstChannel: ch })
    ch += audio[i].channels || 2
  }
  return { streams: out, totalChannels: ch - 1 }
}

// clips: [{path, name, probe, notes:[{t,end,type,text,star}]}]
export function buildXml(clips, binName) {
  let fileN = 0
  const seqs = clips.map((c, ci) => {
    const r = rateFor(c.probe && c.probe.fps)
    const durF = Math.round(((c.probe && c.probe.duration) || 0) * r.fps)
    const fileId = 'file-' + ++fileN
    const w = (c.probe && c.probe.width) || 1920
    const h = (c.probe && c.probe.height) || 1080
    const { streams, totalChannels } = audioLayout((c.probe && c.probe.audio) || [])
    const markers = markersXml(c.notes, r)
    const fileXml = `<file id="${fileId}"><name>${esc(c.name)}</name><pathurl>${esc(pathUrl(c.path))}</pathurl>${rateXml(r)}<duration>${durF}</duration><media><video><samplecharacteristics>${rateXml(r)}<width>${w}</width><height>${h}</height>${SQUARE}</samplecharacteristics></video>${
      totalChannels ? `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>${totalChannels}</channelcount></audio>` : ''
    }</media></file>`

    // Every clipitem of this recording, so they can all be linked (video +
    // audio move together in Premiere, like a normally imported clip).
    const vId = `ci-v-${ci}`
    const aItems = [] // {id, track (1-based audio track), channel, stereo, exploded}
    for (const s of streams) {
      for (let k = 0; k < s.channels; k++) {
        aItems.push({ id: `ci-a-${ci}-${s.stream}-${k}`, channel: s.firstChannel + k, stereo: s.channels === 2, exploded: k, group: s.stream + 1 })
      }
    }
    aItems.forEach((a, i) => (a.track = i + 1))
    const links =
      `<link><linkclipref>${vId}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>1</clipindex></link>` +
      aItems.map((a) => `<link><linkclipref>${a.id}</linkclipref><mediatype>audio</mediatype><trackindex>${a.track}</trackindex><clipindex>1</clipindex>${a.stereo ? `<groupindex>${a.group}</groupindex>` : ''}</link>`).join('')

    const clipitem = (id, extraAttrs, inner, withFile, withMarkers) =>
      `<clipitem id="${id}"${extraAttrs}><name>${esc(c.name)}</name><enabled>TRUE</enabled><duration>${durF}</duration>${rateXml(r)}<start>0</start><end>${durF}</end><in>0</in><out>${durF}</out>${withFile ? fileXml : `<file id="${fileId}"/>`}${inner}${links}${withMarkers ? markers : ''}</clipitem>`

    const videoTrack = `<track>${clipitem(vId, '', '', true, true)}</track>` + sketchTrackXml((c.notes || []).filter((n) => n.sketch).map((n) => ({ t: n.t, file: n.sketch, text: n.text })), r, w, h, 'sk' + ci)
    const audioTracks = aItems
      .map((a) => {
        const trackAttrs = a.stereo
          ? ` currentExplodedTrackIndex="${a.exploded}" totalExplodedTrackCount="2" premiereTrackType="Stereo"`
          : ` currentExplodedTrackIndex="0" totalExplodedTrackCount="1" premiereTrackType="Mono"`
        const itemAttrs = a.stereo ? ' premiereChannelType="stereo"' : ' premiereChannelType="mono"'
        // Stereo-tagged pairs: trackindex = which audio STREAM (OBS track).
        // Untagged/mono: trackindex = which CHANNEL. (Both verified on the
        // user's imports — a stereo pair pointed at channel 3 came in as OBS
        // track 3.)
        const src = `<sourcetrack><mediatype>audio</mediatype><trackindex>${a.stereo ? a.group : a.channel}</trackindex></sourcetrack>`
        return `<track${trackAttrs}>${clipitem(a.id, itemAttrs, src, false, false)}<enabled>TRUE</enabled><locked>FALSE</locked><outputchannelindex>${a.stereo ? a.exploded + 1 : 1}</outputchannelindex></track>`
      })
      .join('')
    const audioFormat = `<numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format><outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group><group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>`
    return `<sequence id="seq-${ci}"><name>${esc(c.name.replace(/\.[^.]+$/, ''))} — notes</name><duration>${durF}</duration>${rateXml(r)}<media><video><format><samplecharacteristics>${rateXml(r)}<width>${w}</width><height>${h}</height>${SQUARE}</samplecharacteristics></format>${videoTrack}</video><audio>${audioFormat}${audioTracks}</audio></media>${markers}</sequence>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><bin><name>${esc(binName)}</name><children>${seqs.join('')}</children></bin></xmeml>\n`
}

function tc(t, fps) {
  const f = Math.round(t * fps)
  const fr = f % Math.round(fps)
  const s = Math.floor(f / Math.round(fps))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(fr)}`
}

export function buildCsv(clips) {
  const rows = [['Clip', 'Path', 'In', 'Out', 'Type', 'Starred', 'Note']]
  for (const c of clips) {
    const fps = (c.probe && c.probe.fps) || 60
    for (const n of c.notes) rows.push([c.name, c.path, tc(n.t, fps), n.end != null ? tc(n.end, fps) : '', n.type === 'MARKER' ? (MARKER_LABEL[n.color] || 'Yellow') + ' marker' : LABEL[n.type] || n.type, n.star ? 'yes' : '', n.text || ''])
  }
  return rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n'
}

// ---- Edit sections → one Premiere sequence ----
// payload: {name, clips: [{path, name, probe, in, out, color}], markers: [{t, end, type, text, color, star}]}
// color: a Premiere label name (Iris, Mango…) → <labels><label2>, which
// Premiere reads as the clip's label colour.
// clips are in timeline order and back to back (the editor has no gaps);
// in/out are seconds in the source recording, marker t is sequence time.
// Each cut becomes a linked video + audio clipitem group, like a clip cut
// with the razor in Premiere; each source file is described once.
// A cut's framing as Premiere's Motion effect (FCP7 "Basic Motion"): Scale
// in %, Center as the offset from the frame centre in fractions of the
// frame — the convention FilmCraft's FCP7 writer documents, too.
function motionXml(m) {
  if (!m) return ''
  const n = (v) => String(Math.round(v * 1e6) / 1e6)
  return `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
    `<parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${n(m.scale)}</value></parameter>` +
    `<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${n(m.x)}</horiz><vert>${n(m.y)}</vert></value></parameter>` +
    `</effect></filter>`
}

export function buildSequenceXml({ name, clips, markers }) {
  const first = clips[0] || {}
  const r = rateFor(first.probe && first.probe.fps)
  const w = (first.probe && first.probe.width) || 1920
  const h = (first.probe && first.probe.height) || 1080

  const files = new Map() // path -> {id, defined}
  const fileRef = (c) => {
    let f = files.get(c.path)
    if (!f) {
      f = { id: 'file-' + (files.size + 1), defined: false }
      files.set(c.path, f)
    }
    if (f.defined) return `<file id="${f.id}"/>`
    f.defined = true
    const cr = rateFor(c.probe && c.probe.fps)
    const durF = Math.round(((c.probe && c.probe.duration) || 0) * cr.fps)
    const { totalChannels } = audioLayout((c.probe && c.probe.audio) || [])
    return `<file id="${f.id}"><name>${esc(c.name)}</name><pathurl>${esc(pathUrl(c.path))}</pathurl>${rateXml(cr)}<duration>${durF}</duration><media><video><samplecharacteristics>${rateXml(cr)}<width>${(c.probe && c.probe.width) || w}</width><height>${(c.probe && c.probe.height) || h}</height>${SQUARE}</samplecharacteristics></video>${
      totalChannels ? `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>${totalChannels}</channelcount></audio>` : ''
    }</media></file>`
  }

  // Audio track slots: one stereo pair (or mono track) per OBS track, sized
  // by the recording with the most tracks.
  const maxStreams = Math.max(0, ...clips.map((c) => ((c.probe && c.probe.audio) || []).length))
  const slots = [] // [{stream, exploded, stereo}] → audio track index = slot index + 1
  for (let s = 0; s < maxStreams; s++) {
    const stereo = clips.some((c) => {
      const a = ((c.probe && c.probe.audio) || [])[s]
      return a && (a.channels || 2) >= 2
    })
    if (stereo) slots.push({ stream: s, exploded: 0, stereo }, { stream: s, exploded: 1, stereo })
    else slots.push({ stream: s, exploded: 0, stereo })
  }

  const vItems = []
  const aTracks = slots.map(() => [])
  let posF = 0
  clips.forEach((c, ci) => {
    const inF = Math.round(c.in * r.fps)
    const outF = Math.max(inF + 1, Math.round(c.out * r.fps))
    const start = posF
    const end = start + (outF - inF)
    posF = end
    const durF = Math.round(((c.probe && c.probe.duration) || 0) * r.fps)
    const { streams } = audioLayout((c.probe && c.probe.audio) || [])
    const vId = `ci-v-${ci}`
    const mine = [] // this cut's audio items
    slots.forEach((slot, ti) => {
      const s = streams[slot.stream]
      if (!s || slot.exploded >= s.channels) return
      mine.push({ id: `ci-a-${ci}-${ti}`, track: ti + 1, slot, s, index: aTracks[ti].length + 1 })
    })
    const links =
      `<link><linkclipref>${vId}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>${vItems.length + 1}</clipindex></link>` +
      mine.map((a) => `<link><linkclipref>${a.id}</linkclipref><mediatype>audio</mediatype><trackindex>${a.track}</trackindex><clipindex>${a.index}</clipindex>${a.slot.stereo ? `<groupindex>${a.slot.stream + 1}</groupindex>` : ''}</link>`).join('')
    const labels = c.color ? `<labels><label2>${esc(c.color)}</label2></labels>` : ''
    const item = (id, attrs, inner) =>
      `<clipitem id="${id}"${attrs}><name>${esc(c.name)}</name><enabled>TRUE</enabled><duration>${durF}</duration>${rateXml(r)}<start>${start}</start><end>${end}</end><in>${inF}</in><out>${outF}</out>${fileRef(c)}${inner}${links}${labels}</clipitem>`
    vItems.push(item(vId, '', motionXml(c.motion)))
    for (const a of mine) {
      const src = `<sourcetrack><mediatype>audio</mediatype><trackindex>${a.slot.stereo ? a.slot.stream + 1 : a.s.firstChannel}</trackindex></sourcetrack>`
      aTracks[a.track - 1].push(item(a.id, a.slot.stereo ? ' premiereChannelType="stereo"' : ' premiereChannelType="mono"', src))
    }
  })

  const videoTrack = `<track>${vItems.join('')}</track>` + sketchTrackXml((markers || []).filter((m) => m.sketch).map((m) => ({ t: m.t, file: m.sketch, text: m.text })), r, w, h, 'sk')
  const audioTracks = slots
    .map((slot, ti) => {
      const attrs = slot.stereo
        ? ` currentExplodedTrackIndex="${slot.exploded}" totalExplodedTrackCount="2" premiereTrackType="Stereo"`
        : ` currentExplodedTrackIndex="0" totalExplodedTrackCount="1" premiereTrackType="Mono"`
      return `<track${attrs}>${aTracks[ti].join('')}<enabled>TRUE</enabled><locked>FALSE</locked><outputchannelindex>${slot.stereo ? slot.exploded + 1 : 1}</outputchannelindex></track>`
    })
    .join('')
  const audioFormat = `<numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format><outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group><group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>`
  const seqMarkers = markersXml(markers || [], r)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="seq-1"><name>${esc(name)}</name><duration>${posF}</duration>${rateXml(r)}<media><video><format><samplecharacteristics>${rateXml(r)}<width>${w}</width><height>${h}</height>${SQUARE}</samplecharacteristics></format>${videoTrack}</video><audio>${audioFormat}${audioTracks}</audio></media>${seqMarkers}</sequence></xmeml>\n`
}
