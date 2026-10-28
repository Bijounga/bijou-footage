// Runs inside Premiere (ExtendScript), loaded by the panel for each job. Finds / imports recordings natively and
// rebuilds a section from a Bijou Footage sequence file.
// Everything is also appended to panel.log next to the panel.
// BIJOU_ROOT is set by the panel (its folder) just before this file is loaded
var BIJOU_LOG = (typeof BIJOU_ROOT === 'string' ? BIJOU_ROOT : Folder.temp.fsName) + '/panel.log'

function bijouLog(msg) {
  try {
    var f = new File(BIJOU_LOG)
    f.encoding = 'UTF-8'
    f.open('a')
    f.writeln((new Date()).toString() + '  ' + msg)
    f.close()
  } catch (e) {}
  return 'ok'
}

// ---- JSON (ExtendScript has none) ----
function bijouJson(v) {
  if (v === null || v === undefined) return 'null'
  var t = typeof v
  if (t === 'number') return isFinite(v) ? String(v) : 'null'
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
  if (v instanceof Array) {
    var a = []
    for (var i = 0; i < v.length; i++) a.push(bijouJson(v[i]))
    return '[' + a.join(',') + ']'
  }
  var o = []
  for (var k in v) if (v.hasOwnProperty(k)) o.push(bijouJson(k) + ':' + bijouJson(v[k]))
  return '{' + o.join(',') + '}'
}
function bijouParse(s) { return eval('(' + s + ')') }

// A job file from outside: {fn, args}. Runs it, hands back the result as JSON.
function bijouRunJob(text) {
  var res
  try {
    var job = bijouParse(text)
    bijouLog('job ' + job.fn)
    res = { ok: true, result: $.global[job.fn](job.args) }
  } catch (e) {
    res = { ok: false, error: String(e), line: e.line }
  }
  var out = bijouJson(res)
  bijouLog('job result: ' + out.substring(0, 3000))
  return out
}

// ---- project items ----
function bijouNorm(p) { return String(p).replace(/\\/g, '/').toLowerCase() }

function bijouFind(bin, want) {
  for (var i = 0; i < bin.children.numItems; i++) {
    var it = bin.children[i]
    if (it.type === ProjectItemType.BIN) {
      var r = bijouFind(it, want)
      if (r) return r
    } else {
      var mp = ''
      try { mp = it.getMediaPath() } catch (e) {}
      if (mp && bijouNorm(mp) === want) return it
    }
  }
  return null
}

// The bin the panel keeps its own imports in. Only items in here are ever used:
// a recording already in the project from an XML import carries that import's
// odd audio layout (8 mono tracks), while a fresh native import comes in as proper
// stereo pairs. So the panel imports its own copy, once, and reuses that.
function bijouPanelBin() {
  var root = app.project.rootItem
  for (var i = 0; i < root.children.numItems; i++) {
    var it = root.children[i]
    if (it.type === ProjectItemType.BIN && it.name === 'Bijou Footage') return it
  }
  return root.createBin('Bijou Footage')
}

// The panel's copy of a file: the one in its bin, or a native import into it.
function bijouItemFor(path) {
  var bin = bijouPanelBin()
  var want = bijouNorm(path)
  var found = bijouFind(bin, want)
  if (found) return { item: found, imported: false }
  if (!(new File(path)).exists) return null
  app.project.importFiles([path], true, bin, false)
  found = bijouFind(bin, want)
  return found ? { item: found, imported: true } : null
}

// The clip on a track that starts at the given time. Clips are in time order and
// the one just placed is the newest, so look from the end: scanning a whole long
// track for every cut made big sections slow (quadratic).
function bijouClipAt(track, secs) {
  var n = track.clips.numItems
  for (var i = n - 1; i >= 0; i--) {
    var c = track.clips[i]
    var st = c.start.seconds
    if (Math.abs(st - secs) < 0.02) return c
    if (st < secs - 0.5) return null
  }
  return null
}

function bijouTime(sec) {
  var t = new Time()
  t.seconds = sec
  return t
}

// ---- reading a sequence back (for checks) ----
function bijouDump(args) {
  var seq = app.project.activeSequence
  if (!seq) return { error: 'no active sequence' }
  var out = { name: seq.name, video: [], audio: [], markers: [] }
  var kinds = [['video', seq.videoTracks], ['audio', seq.audioTracks]]
  for (var k = 0; k < 2; k++) {
    var tracks = kinds[k][1]
    for (var t = 0; t < tracks.numTracks; t++) {
      var tr = tracks[t]
      var clips = []
      for (var c = 0; c < tr.clips.numItems; c++) {
        var ci = tr.clips[c]
        clips.push({ name: ci.name, start: ci.start.seconds, end: ci.end.seconds, inPoint: ci.inPoint.seconds, outPoint: ci.outPoint.seconds, disabled: !!ci.disabled })
      }
      out[kinds[k][0]].push({ track: t + 1, clips: clips })
    }
  }
  var m = seq.markers.getFirstMarker()
  while (m) {
    out.markers.push({ name: m.name, comments: m.comments, start: m.start.seconds, end: m.end.seconds, type: m.type })
    m = seq.markers.getNextMarker(m)
  }
  return out
}

function bijouProbe(args) {
  var r = { version: app.version, project: app.project.name, sequences: app.project.sequences.numSequences }
  try { r.activeSequence = app.project.activeSequence ? app.project.activeSequence.name : null } catch (e) {}
  return r
}

// ---- building ----
// Premiere's 16 label colours, in its own order (same names Bijou uses)
var LABEL_INDEX = { Violet: 0, Iris: 1, Caribbean: 2, Lavender: 3, Cerulean: 4, Forest: 5, Rose: 6, Mango: 7, Purple: 8, Blue: 9, Teal: 10, Magenta: 11, Tan: 12, Green: 13, Brown: 14, Yellow: 15 }
var MARKER_COLOR_INDEX = { green: 0, red: 1, purple: 2, orange: 3, yellow: 4, white: 5, blue: 6, cyan: 7 }

// A build is a handful of small calls, so the panel can show its progress
// between them. The state lives in $.global.bj for the length of one build.
// spec: {name, clips:[{path, in, out, audio:[channels per stream], mute:[stream], color, motion}],
//        markers:[{t, end, name, comments, color}], vo:[{path, in, out, at, gain, color, label}], voEnabled}

// 1. Start: remember the spec, say which files are needed.
function bijouBegin(spec) {
  var files = []
  var seen = {}
  var i
  for (i = 0; i < spec.clips.length; i++) {
    if (!seen[spec.clips[i].path]) { seen[spec.clips[i].path] = true; files.push(spec.clips[i].path) }
  }
  // in time order, like the XML export: a track cannot hold overlaps, so a line that starts inside the one before moves to its end
  var vo = (spec.vo || []).slice().sort(function (x, y) { return x.at - y.at })
  spec.vo = vo
  for (i = 0; i < vo.length; i++) {
    if (!seen[vo[i].path]) { seen[vo[i].path] = true; files.push(vo[i].path) }
  }
  $.global.bj = { spec: spec, items: {}, log: [], pos: 0, placed: 0, voEnd: 0, voPlaced: 0, seq: null }
  return { files: files, clips: spec.clips.length, vo: vo.length, markers: (spec.markers || []).length }
}

// 2. One file at a time (a long recording takes a moment to import).
function bijouImportFile(path) {
  var bj = $.global.bj
  var r = bijouItemFor(path)
  if (!r) return { error: 'could not find or import ' + path }
  bj.items[path] = r.item
  bj.log.push((r.imported ? 'imported ' : 'already imported ') + path)
  return { imported: r.imported }
}

// 3. A sequence shaped like the first recording, then emptied.
function bijouMakeSequence() {
  var bj = $.global.bj
  var first = bj.items[bj.spec.clips[0].path]
  app.project.createNewSequenceFromClips(bj.spec.name, [first], app.project.getInsertionBin())
  var seq = app.project.activeSequence
  var kinds = [seq.videoTracks, seq.audioTracks]
  for (var k = 0; k < 2; k++) {
    for (var t = 0; t < kinds[k].numTracks; t++) {
      var tr = kinds[k][t]
      for (var c = tr.clips.numItems - 1; c >= 0; c--) tr.clips[c].remove(0, 0)
    }
  }
  bj.seq = seq
  bj.log.push('sequence made: ' + seq.videoTracks.numTracks + ' video / ' + seq.audioTracks.numTracks + ' audio tracks')
  return { audioTracks: seq.audioTracks.numTracks }
}

// 4. Cuts [from, to), back to back.
function bijouPlaceClips(range) {
  var bj = $.global.bj
  var seq = bj.seq
  var clips = bj.spec.clips
  for (var i = range[0]; i < range[1] && i < clips.length; i++) {
    var cl = clips[i]
    var it = bj.items[cl.path]
    it.setInPoint(cl['in'], 4)
    it.setOutPoint(cl.out, 4)
    // the label colour is copied onto the clip as it goes in, so set it on the file first
    var wasLabel = null
    if (cl.color && LABEL_INDEX[cl.color] !== undefined) {
      try { wasLabel = it.getColorLabel(); it.setColorLabel(LABEL_INDEX[cl.color]) } catch (e) { bj.log.push('label: ' + e) }
    }
    seq.videoTracks[0].overwriteClip(it, bijouTime(bj.pos))
    if (wasLabel !== null) { try { it.setColorLabel(wasLabel) } catch (e) {} }

    // zoom / position set in Edit
    if (cl.motion) {
      try {
        var vc = bijouClipAt(seq.videoTracks[0], bj.pos)
        var mc = vc.components[1]
        for (var mp = 0; mp < mc.properties.numItems; mp++) {
          var pr = mc.properties[mp]
          if (pr.displayName === 'Scale') pr.setValue(cl.motion.scale, true)
          if (pr.displayName === 'Position') pr.setValue([0.5 + cl.motion.x, 0.5 + cl.motion.y], true)
        }
      } catch (e) { bj.log.push('motion: ' + e) }
    }

    // layers muted on this cut: there, but switched off
    if (cl.mute && cl.mute.length) {
      // The timeline tracks this cut landed on, top to bottom, are the recording's
      // tracks: one per OBS track when Premiere imported it as stereo pairs / a mono
      // track, or one per channel in the older mono-per-channel layout. Which one
      // it is, is read from how many tracks the cut occupies.
      var used = []
      var a
      for (a = 0; a < seq.audioTracks.numTracks; a++) {
        var found = bijouClipAt(seq.audioTracks[a], bj.pos)
        if (found) used.push(found)
      }
      var streamOfUsed = []
      var s
      var channels = 0
      for (s = 0; s < cl.audio.length; s++) channels += cl.audio[s]
      if (used.length === cl.audio.length) {
        for (s = 0; s < cl.audio.length; s++) streamOfUsed.push(s)
      } else {
        for (s = 0; s < cl.audio.length; s++) {
          for (var ch = 0; ch < cl.audio[s]; ch++) streamOfUsed.push(s)
        }
      }
      for (a = 0; a < used.length; a++) {
        for (var m = 0; m < cl.mute.length; m++) if (cl.mute[m] === streamOfUsed[a]) used[a].disabled = true
      }
    }
    bj.pos += cl.out - cl['in']
    bj.placed++
  }
  try { for (var key in bj.items) { bj.items[key].clearInPoint(); bj.items[key].clearOutPoint() } } catch (e) {}
  return { placed: bj.placed, at: bj.pos }
}

// 5. Markers.
function bijouAddMarkers() {
  var bj = $.global.bj
  var mk = bj.spec.markers || []
  for (var i = 0; i < mk.length; i++) {
    var mm = mk[i]
    var mo = bj.seq.markers.createMarker(mm.t)
    mo.name = mm.name || ''
    mo.comments = mm.comments || ''
    if (mm.end != null && mm.end > mm.t) mo.end = mm.end
    if (MARKER_COLOR_INDEX[mm.color] !== undefined) mo.setColorByIndex(MARKER_COLOR_INDEX[mm.color])
  }
  bj.log.push(mk.length + ' marker(s)')
  return { markers: mk.length }
}

// 6. The voiceover track: one more (mono) audio track under the recordings' tracks.
function bijouAddVoTrack() {
  var bj = $.global.bj
  app.enableQE()
  var qs = qe.project.getActiveSequence()
  qs.addTracks(0, 0, 1, 0, qs.numAudioTracks, 0, 0)
  bj.voTrackIndex = bj.seq.audioTracks.numTracks - 1
  return { track: bj.voTrackIndex + 1 }
}

// 7. Voiceover lines [from, to).
function bijouPlaceVo(range) {
  var bj = $.global.bj
  var vo = bj.spec.vo || []
  var voTrack = bj.seq.audioTracks[bj.voTrackIndex]
  for (var i = range[0]; i < range[1] && i < vo.length; i++) {
    var v = vo[i]
    var vit = bj.items[v.path]
    if (!vit) { bj.log.push('missing ' + v.path); continue }
    var at = Math.max(v.at, bj.voEnd) // a track cannot hold overlaps
    var wasV = null
    if (v.color && LABEL_INDEX[v.color] !== undefined) {
      try { wasV = vit.getColorLabel(); vit.setColorLabel(LABEL_INDEX[v.color]) } catch (e) { bj.log.push('VO label: ' + e) }
    }
    vit.clearInPoint(); vit.clearOutPoint()
    vit.setInPoint(v['in'], 2)
    vit.setOutPoint(v.out, 2)
    voTrack.overwriteClip(vit, at)
    if (wasV !== null) { try { vit.setColorLabel(wasV) } catch (e) {} }
    bj.voEnd = at + (v.out - v['in'])
    var vcl = bijouClipAt(voTrack, at)
    if (vcl) {
      // Level is not 1.0 = 0 dB: Premiere's 0 dB is 0.17783 (10^(-15/20)); 1.0 shows as +15 dB
      try { vcl.components[0].properties[1].setValue(0.17782794 * Math.pow(10, (v.gain || 0) / 20), true) } catch (e) { bj.log.push('VO gain: ' + e) }
      // named after what is said in it (the label from Bijou Footage)
      if (v.label) { try { vcl.name = v.label } catch (e) { bj.log.push('VO name: ' + e) } }
    }
    try { vit.clearInPoint(); vit.clearOutPoint() } catch (e) {}
    bj.voPlaced++
  }
  return { voPlaced: bj.voPlaced }
}

// 8. Done: the voiceover track off if it was off in Bijou Footage; the summary.
function bijouFinish() {
  var bj = $.global.bj
  if ((bj.spec.vo || []).length && bj.spec.voEnabled === false) {
    try { app.enableQE(); var qs = qe.project.getActiveSequence(); qs.getAudioTrackAt(qs.numAudioTracks - 1).setMute(1) } catch (e) { bj.log.push('VO mute: ' + e) }
  }
  bj.log.push(bj.voPlaced + ' voiceover clip(s)')
  return { log: bj.log, total: bj.pos, sequence: bj.seq.name, clips: bj.placed }
}

// All of it in one go (used by tests).
function bijouBuild(spec) {
  var b = bijouBegin(spec)
  var i
  for (i = 0; i < b.files.length; i++) {
    var r = bijouImportFile(b.files[i])
    if (r.error) return { error: r.error, log: [] }
  }
  bijouMakeSequence()
  bijouPlaceClips([0, spec.clips.length])
  bijouAddMarkers()
  if (b.vo) { bijouAddVoTrack(); bijouPlaceVo([0, b.vo]) }
  return bijouFinish()
}

// ---- housekeeping for tests ----
// Deletes the sequences whose name starts with the given prefix; returns how many.
function bijouDeleteSequences(prefix) {
  var n = 0
  var seqs = app.project.sequences
  var doomed = []
  for (var i = 0; i < seqs.numSequences; i++) {
    if (String(seqs[i].name).indexOf(prefix) === 0) doomed.push(seqs[i])
  }
  for (var d = 0; d < doomed.length; d++) {
    if (app.project.deleteSequence(doomed[d])) n++
  }
  return n
}
