// Panel side. The buttons load a Bijou Footage section file and rebuild it in the
// open project (host/lib.jsx does the work inside Premiere).
// A second way in is for testing: a job file dropped next to the panel
// (job.json -> {fn, args}, or "RAW:<script>", or "RELOAD"); the answer is written
// to result.json, so a job can be run and checked without anyone clicking.
// alive.txt is rewritten every poll (and gets any script error) to show it is running.
var cs = new CSInterface()
var fs = require('fs')
var path = require('path')
var root = cs.getSystemPath(SystemPath.EXTENSION)
var JOB = path.join(root, 'job.json')
var RESULT = path.join(root, 'result.json')
var ALIVE = path.join(root, 'alive.txt')
// the real path, not the link in Premiere's extensions folder
var realRoot = root
try { realRoot = fs.realpathSync(root) } catch (e) {}

window.onerror = function (msg, src, line) {
  try { fs.appendFileSync(ALIVE, 'ERROR ' + msg + ' line ' + line + '\n') } catch (e) {}
}

var out = document.getElementById('out')
var fileBox = document.getElementById('file')
var sumBox = document.getElementById('sum')
var buildBtn = document.getElementById('build')
function say(s) { out.textContent = s }

var running = false

// Runs a job {fn, args} in Premiere: lib.jsx goes in as text first, so Premiere
// can never run an old copy of the file. done gets the JSON answer.
function runJob(text, done) {
  var libText
  try { libText = fs.readFileSync(path.join(realRoot, 'host', 'lib.jsx'), 'utf8') } catch (e) { return done('{"ok":false,"error":"cannot read lib.jsx"}') }
  cs.evalScript('var BIJOU_ROOT = ' + JSON.stringify(realRoot.split(path.sep).join('/')) + ';\n' + libText + '\n"loaded"', function (loaded) {
    if (loaded !== 'loaded') return done('{"ok":false,"error":' + JSON.stringify('LIB: ' + String(loaded)) + '}')
    cs.evalScript('bijouRunJob(' + JSON.stringify(text) + ')', done)
  })
}

// ---- the test hook ----
setInterval(function () {
  try { fs.writeFileSync(ALIVE, 'alive v4 ' + new Date().toISOString() + '\n', 'utf8') } catch (e) {}
  if (running) return
  var text
  try { text = fs.readFileSync(JOB, 'utf8') } catch (e) { return }
  running = true
  try { fs.unlinkSync(JOB) } catch (e) {}
  if (text.trim() === 'RELOAD') { running = false; location.reload(); return }
  if (text.indexOf('RAW:') === 0) {
    cs.evalScript(text.substring(4), function (res) {
      try { fs.writeFileSync(RESULT, String(res), 'utf8') } catch (e) {}
      running = false
    })
    return
  }
  runJob(text, function (res) {
    try { fs.writeFileSync(RESULT, res || '', 'utf8') } catch (e) {}
    running = false
  })
}, 700)

// ---- loading and building ----
var spec = null
var specFile = null

function show(file, s) {
  specFile = file
  spec = s
  fileBox.textContent = file
  var markers = (s.markers || []).length
  var vo = (s.vo || []).length
  sumBox.textContent = '"' + s.name + '": ' + s.clips.length + ' cut' + (s.clips.length === 1 ? '' : 's') +
    ', ' + markers + ' marker' + (markers === 1 ? '' : 's') + (vo ? ', ' + vo + ' voiceover clip' + (vo === 1 ? '' : 's') : '')
  buildBtn.disabled = false
}

function loadFile(file) {
  var s
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { say('Could not read that file: ' + e); return }
  if (!s || s.format !== 'bijou-footage-sequence' || !s.clips || !s.clips.length) { say('That is not a Bijou Footage section file (or it has no clips).'); return }
  show(file, s)
  try { localStorage.setItem('lastFile', file) } catch (e) {}
  say('Loaded. Press "Build the sequence" to make it in this project.')
}

document.getElementById('load').onclick = function () {
  var last = ''
  try { last = path.dirname(localStorage.getItem('lastFile') || '') } catch (e) {}
  var r = window.cep.fs.showOpenDialogEx(false, false, 'Choose a Bijou Footage section file', last, ['json'], 'Open')
  if (r && r.data && r.data[0]) loadFile(r.data[0])
}

// One step of a build: a call into Premiere that answers with a small result.
function step(fn, args, ok, fail) {
  runJob(JSON.stringify({ fn: fn, args: args }), function (res) {
    var r
    try { r = JSON.parse(res) } catch (e) { return fail('Premiere did not answer as expected: ' + res) }
    if (!r.ok) return fail('Something went wrong: ' + r.error + (r.line ? ' (line ' + r.line + ')' : ''))
    if (r.result && r.result.error) return fail(r.result.error)
    ok(r.result)
  })
}

var bar = document.getElementById('fill')
var barBox = document.getElementById('bar')
function progress(done, total, what) {
  barBox.style.display = 'block'
  bar.style.width = Math.round((done / total) * 100) + '%'
  say(what + '  (' + Math.round((done / total) * 100) + '%)')
}

// The build, a few clips at a time, so the bar moves (the recordings take longest).
buildBtn.onclick = function () {
  if (!spec || running) return
  // re-read the file, so a section exported again is picked up without choosing it again
  try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')) } catch (e) {}
  running = true
  buildBtn.disabled = true
  var finish = function (msg) { running = false; buildBtn.disabled = false; barBox.style.display = 'none'; say(msg) }
  var BATCH = 5
  var IMPORT_WEIGHT = 8 // importing a recording takes about as long as placing this many cuts
  progress(0, 1, 'Starting "' + spec.name + '"')
  step('bijouBegin', spec, function (plan) {
    var total = plan.files.length * IMPORT_WEIGHT + 2 + plan.clips + 1 + (plan.vo ? 1 + plan.vo : 0) + 1
    var done = 0
    var tick = function (what, n) { done += n; progress(done, total, what) }
    var importNext = function (i) {
      if (i >= plan.files.length) return sequence()
      progress(done, total, 'Importing recording ' + (i + 1) + ' of ' + plan.files.length + ' (a long one can take a minute)')
      step('bijouImportFile', plan.files[i], function () { tick('Imported ' + (i + 1) + ' of ' + plan.files.length, IMPORT_WEIGHT); importNext(i + 1) }, finish)
    }
    var sequence = function () {
      step('bijouMakeSequence', null, function () { tick('Made the sequence', 2); cuts(0) }, finish)
    }
    var cuts = function (from) {
      if (from >= plan.clips) return markers()
      var to = Math.min(from + BATCH, plan.clips)
      step('bijouPlaceClips', [from, to], function () { tick('Placing cuts ' + to + ' of ' + plan.clips, to - from); cuts(to) }, finish)
    }
    var markers = function () {
      step('bijouAddMarkers', null, function () { tick('Added the markers', 1); if (plan.vo) voTrack(); else end() }, finish)
    }
    var voTrack = function () {
      step('bijouAddVoTrack', null, function () { tick('Added the voiceover track', 1); vo(0) }, finish)
    }
    var vo = function (from) {
      if (from >= plan.vo) return end()
      var to = Math.min(from + BATCH, plan.vo)
      step('bijouPlaceVo', [from, to], function () { tick('Placing voiceover ' + to + ' of ' + plan.vo, to - from); vo(to) }, finish)
    }
    var end = function () {
      step('bijouFinish', null, function (r) {
        finish('Done: sequence "' + r.sequence + '", ' + r.clips + ' cuts, ' + Math.round(r.total) + ' s.\n\n' + r.log.join('\n'))
      }, finish)
    }
    importNext(0)
  }, finish)
}

try {
  var remembered = localStorage.getItem('lastFile')
  if (remembered && fs.existsSync(remembered)) loadFile(remembered)
} catch (e) {}
