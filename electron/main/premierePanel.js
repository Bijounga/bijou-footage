// The section as a file for the "Bijou Footage Rebuild" Premiere panel
// (premiere-panel/). Same inputs as the XML export (premiereXml.buildSequenceXml),
// but a plain JSON the panel reads and rebuilds the sequence from, importing the
// recordings the way Premiere itself does (so their audio comes in as proper
// stereo tracks) and reusing a recording that is already in the project.
//
//   {format: 'bijou-footage-sequence', version: 1, name,
//    clips:   [{path, in, out, audio: [channels per recording track], mute: [track index], color, motion}],
//    markers: [{t, end?, name, comments, color}],
//    vo:      [{path, in, out, at, gain (dB), color, label}], voEnabled}
// Paths use forward slashes; times are seconds.

const LABEL = { SETUP: 'Setup', AND_THEN: 'And Then', BECAUSE: 'Because', BUT: 'But', THEREFORE: 'Therefore', NOTE: 'Note', MARKER: 'Marker' }
const MARKER_COLORS = ['green', 'red', 'purple', 'orange', 'yellow', 'white', 'blue', 'cyan']
const MARKER_LABEL = { green: 'Green', red: 'Red', purple: 'Purple', orange: 'Orange', yellow: 'Yellow', white: 'White', blue: 'Blue', cyan: 'Cyan' }

const slash = (p) => String(p || '').replace(/\\/g, '/')
const round = (v, n = 1e6) => Math.round(v * n) / n

export function buildPanelFile({ name, clips, markers, vo, voEnabled }) {
  return {
    format: 'bijou-footage-sequence',
    version: 1,
    name: name || 'Section',
    clips: (clips || []).map((c) => {
      const fps = (c.probe && c.probe.fps) || 60
      const frame = (t) => Math.round(t * fps) / fps // whole frames, like the XML
      const out = {
        path: slash(c.path),
        name: c.name,
        in: round(frame(c.in)),
        out: round(Math.max(frame(c.out), frame(c.in) + 1 / fps)),
        // the channels of each recording track (OBS track), as the XML writes them
        audio: ((c.probe && c.probe.audio) || []).map((a) => Math.min(2, Math.max(1, a.channels || 2))),
        mute: c.mute || []
      }
      if (c.color) out.color = c.color
      if (c.motion) out.motion = { scale: round(c.motion.scale), x: round(c.motion.x), y: round(c.motion.y) }
      return out
    }),
    markers: (markers || []).map((n) => {
      const color = MARKER_LABEL[n.color] ? n.color : 'yellow'
      const label = n.type === 'MARKER' ? n.text || `${MARKER_LABEL[color]} marker` : LABEL[n.type] || n.type
      const m = { t: round(n.t, 1000), name: label + (n.star ? ' ★' : ''), comments: n.text || '' }
      if (n.end != null) m.end = round(n.end, 1000)
      // like the XML: only a marker you placed keeps its colour; notes stay Premiere's default green
      if (n.type === 'MARKER' && MARKER_COLORS.includes(n.color)) m.color = n.color
      return m
    }),
    vo: (vo || [])
      .filter((v) => v.path)
      .sort((a, b) => a.at - b.at) // time order: one track can't hold overlaps
      .map((v) => ({ path: slash(v.path), label: v.label || 'Voiceover', at: round(v.at, 1000), in: round(v.in, 1000), out: round(v.out, 1000), gain: v.gain || 0, color: v.color || null })),
    voEnabled: voEnabled !== false
  }
}
