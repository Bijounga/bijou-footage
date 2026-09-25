import { useMemo } from 'react'
import { seqPlayer } from '../lib/seqPlayer.js'
import * as EM from '../lib/editModel.js'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { newId, pickDefaultType } from '../lib/beats.js'
import { player } from '../lib/player.js'
import { bus } from '../lib/hooks.js'
import { BUILT_IN_THEMES, fromBijouCustom, applyTheme } from '../lib/themes.js'

const api = window.footage

export function fmtBytes(n) {
  if (!n) return '0 MB'
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1) + ' GB'
  return Math.max(1, Math.round(n / 1024 ** 2)) + ' MB'
}

export const DEFAULT_TRACK_NAMES = ['Game', 'Bijou', 'Discord', 'Music', 'Track 5', 'Track 6']

// Track names for one recording: its own renames (review.trackNames,
// {index: name}) over the default names from Settings.
export function trackNamesFor(state, key) {
  const base = state.settings.trackNames
  const own = key && state.reviews[key] && state.reviews[key].trackNames
  return own ? base.map((n, i) => own[i] || n) : base
}
export function useTrackNames(key) {
  const base = useStore((s) => s.settings.trackNames)
  const own = useStore((s) => (key && s.reviews[key] && s.reviews[key].trackNames) || null)
  return useMemo(() => (own ? base.map((n, i) => own[i] || n) : base), [base, own])
}
export const TRACK_COLORS = ['#4fd1c5', '#f2a65a', '#8b8ff7', '#d46fb0', '#4ade80', '#e2665b']
// The user's chosen track colors (Settings or the swatch on a track header).
export function useTrackColors() {
  return useStore((s) => s.settings.trackColors || TRACK_COLORS)
}
export const DEFAULT_LANE_H = 64
export const LANE_H_MIN = 40
export const LANE_H_MAX = 320

function defaultSettings() {
  return {
    folders: [],
    files: [], // individual recordings added from outside the folders
    trackNames: DEFAULT_TRACK_NAMES.slice(),
    mixer: DEFAULT_TRACK_NAMES.map(() => ({ vol: 1, mute: false })),
    masterVol: 1,
    pauseWhileTyping: true,
    skipSmall: 5,
    skipBig: 30,
    ffmpegDir: '',
    includeSource: true,
    autoMuteEmpty: true,
    // Prepare every recording in the background (waveforms + per-track
    // audio files), so seeking is instant the first time you open any of them.
    autoPrepare: true,
    // While playing, seeks land on the nearest keyframe so playback carries
    // on instantly (see player.seek). Paused seeks are always frame-exact.
    instantSeek: true,
    watchSpeed: 1, // normal playback speed; shuttling returns here on stop
    timelineHeight: 300, // px, dragged via the divider under the viewer
    laneHeights: DEFAULT_TRACK_NAMES.map(() => DEFAULT_LANE_H), // per-track waveform lane height
    libraryHidden: false,
    trackColors: TRACK_COLORS.slice(),
    notesHidden: false,
    currentProjectId: null, // null = "All footage"
    notesWidth: 360, // px, dragged via the notes panel's left edge
    // Speech detection per track (lib/speech.js): A = show speech markers,
    // ⇥ = include in "skip to next speech". Off for track 1 (game audio).
    speechShow: [false, true, true, true, true, true],
    speechSkip: [false, true, true, true, true, true],
    speechSensitivity: 0.5,
    // Transcription (Phase 5): which tracks get transcribed (off for game
    // audio and the browser by default), language ('' = auto-detect).
    transcribeTracks: [false, true, true, false, false, false],
    transcriptLang: 'en',
    // Media cache (per-track audio + waveforms): limit, and what happens
    // over it — 'remind' (pause background prep, show a reminder) or
    // 'auto' (delete the least-recently-opened recordings' files).
    cacheLimitGB: 20,
    cacheMode: 'remind',
    autoTranscribeOpen: true, // transcribe the ticked tracks of a recording when you open it
    autoTranscribeAll: false, // …or of every recording, in the background
    sideTab: 'notes', // notes panel shows 'notes' | 'transcript'
    noteColorBars: false, // colored strip on each note's left edge (Settings → Reviewing)
    notesZoom: 1, // text size of the notes list (− / + in its header, or Ctrl+wheel)
    markerColor: 'yellow', // last marker color used
    workspace: 'review', // 'review' | 'edit'
    projectsDir: null, // where projects are saved (folder per project); null = not chosen yet
    sectionByProject: {}, // projectId -> the section last open in Edit
    editSnap: true, // W — snapping in the edit timeline
    editSidebarHidden: false, // Ctrl+\ in Edit
    editPanelHidden: false, // Ctrl+Shift+\ in Edit — the Notes / Transcript panel
    editPanelTab: 'notes', // 'notes' | 'transcript'
    editPanelWidth: 380,
    editSkipSilence: false,
    editWatchSpeed: 1, // Edit playback speed (the speed button); shuttling returns here // Edit playback jumps over silences in the cut
    editLaneHeights: [44, 44, 44, 44, 44, 44], // audio row heights in the edit timeline
    skipSilence: false, // playback jumps over long silences (lib/skipSilence.js)
    snap: true, // timeline clicks/scrubs/drags snap to notes & markers
    keybinds: {}, // actionId -> [combo, ...]; only actions the user changed (see lib/keybinds.js)
    theme: 'dark', // lib/themes.js id, or 'bijou:<id>' for a BijouDocs custom theme
    hideTitleBar: false, // no Windows title bar (window reopens to apply)
    lastClipKey: null
  }
}

// started/done are only ever set by the user (Start review / Mark
// reviewed) — just opening or watching a recording doesn't change its status.
export function emptyReview() {
  return { notes: [], lastPos: 0, started: false, done: false, lastOpened: 0 }
}

// A project is a hand-picked list of recordings (by clip key). Notes live on
// the recordings, so a recording in two projects shows the same notes.
function newProject(name) {
  return { id: newId().replace(/^n/, 'p'), name: name || 'New project', clipKeys: [], createdAt: Date.now(), bijouScriptId: null }
}

// ---- saving projects & sections to the projects folder ----
// Each project / section is written when it changes (compared by content),
// a moment after the last change; removed projects go to the Recycle Bin.
const savedProjects = new Map() // id -> {json, folder}
const savedSections = new Map() // id -> json
const projectJson = (p, pad) => JSON.stringify([p.name, p.clipKeys, p.bijouScriptId || null, p.createdAt, pad || null])
const sectionJson = (x) => JSON.stringify([x.name, x.order, x.clips, x.markers || []])
function markProjectsSaved(list) {
  const pads = useStore.getState().pads
  for (const p of list) savedProjects.set(p.id, { json: projectJson(p, pads[p.id]), folder: p.folder })
}
function markSectionsSaved(list) {
  for (const x of list) savedSections.set(x.id, sectionJson(x))
}
function forgetSection(id) {
  savedSections.delete(id)
}
let syncTimer = null
function startProjectSync() {
  useStore.subscribe((st, prev) => {
    if (st.projects !== prev.projects || st.sections !== prev.sections || st.pads !== prev.pads) {
      clearTimeout(syncTimer)
      syncTimer = setTimeout(syncToDisk, 500)
    }
  })
}
async function syncToDisk() {
  const st = useStore.getState()
  const dir = st.settings.projectsDir
  if (!dir) return
  for (const p of st.projects) {
    const was = savedProjects.get(p.id)
    const pad = st.pads[p.id]
    const json = projectJson(p, pad)
    if (was && was.json === json && p.folder) continue
    const folder = await api.saveProject(dir, { ...p, pad: pad ? { items: pad } : null })
    savedProjects.set(p.id, { json, folder })
    if (folder !== p.folder) {
      useStore.setState((s) => ({ projects: s.projects.map((q) => (q.id === p.id ? { ...q, folder } : q)) }))
    }
  }
  for (const [id, was] of [...savedProjects]) {
    if (!st.projects.some((p) => p.id === id)) {
      savedProjects.delete(id)
      if (was.folder) await api.trashProject(was.folder)
    }
  }
  const p = st.projects.find((q) => q.id === st.sectionsFor)
  if (p && p.folder) {
    for (const x of st.sections) {
      const json = sectionJson(x)
      if (savedSections.get(x.id) === json) continue
      await api.saveSection(p.folder, x)
      savedSections.set(x.id, json)
    }
  }
}

let saveTimer = null
const UNDO_LIMIT = 100

export const useStore = create(
  immer((set, get) => ({
    loaded: false,
    settings: defaultSettings(),
    reviews: {}, // clipKey -> review
    projects: [],
    clips: [], // library, from main
    scanning: false,
    tools: { ffmpeg: null, ffprobe: null },
    currentKey: null,
    solo: [], // track indices soloed (transient, not saved)
    waveforms: {}, // key -> {status, progress, error}
    waveformQueue: 0,
    beatColors: {},
    rightTab: 'clip',
    selectedNoteId: null,
    editingNoteId: null,
    inPoint: null,
    modal: null, // 'settings' | 'export' | 'help'
    exportSelection: null, // note ids chosen in All notes
    toast: null,
    undo: [],
    redo: [],
    libraryFilter: { text: '', status: 'all' },
    bijouThemes: [], // BijouDocs custom themes, read at startup
    colorMenu: null, // {x, y, noteId?, clipKey?} — right-click marker color picker
    frameless: false, // whether THIS window was created without a title bar
    tx: { installed: true, running: null, queue: [] }, // transcription queue (from main)
    txDone: {}, // clipKey -> [tracks with a transcript]
    pads: {}, // project id (or 'all') -> project notes, see setPad
    padUndo: [],
    sections: [], // the current project's edit sections (from its folder)
    sectionsFor: null, // project id those sections belong to
    editSel: [], // selected clip ids in the edit timeline
    editTool: 'select', // 'select' (V) | 'razor' (C)
    editUndo: [], // [{sectionId, clips}]
    editRedo: [],
    cache: { size: 0, limit: 0, over: false, mode: 'remind' }, // media cache, from main
    cacheReminderHidden: false, // "×" on the reminder: hidden until the app restarts
    searchHits: [], // transcript search hits in the open recording [{t, track}] — drawn on the timeline
    txVersion: 0, // bumps when a transcript finishes, so open views reload

    async init() {
      const data = await api.loadData()
      const colors = await api.beatColors().catch(() => ({}))
      set((s) => {
        if (data) {
          s.settings = { ...defaultSettings(), ...(data.settings || {}) }
          // Older files / new tracks: pad the mixer to the default length.
          while (s.settings.mixer.length < DEFAULT_TRACK_NAMES.length) s.settings.mixer.push({ vol: 1, mute: false })
          while (s.settings.trackNames.length < DEFAULT_TRACK_NAMES.length) s.settings.trackNames.push(DEFAULT_TRACK_NAMES[s.settings.trackNames.length])
          // 2026-09-24: new default names (Game, Bijou, Discord, Music); names
          // for one recording are now renamed on that recording instead.
          if (!s.settings.trackNamesV2) {
            s.settings.trackNames = DEFAULT_TRACK_NAMES.slice()
            s.settings.trackNamesV2 = true
          }
          while (s.settings.laneHeights.length < DEFAULT_TRACK_NAMES.length) s.settings.laneHeights.push(DEFAULT_LANE_H)
          while (s.settings.trackColors.length < TRACK_COLORS.length) s.settings.trackColors.push(TRACK_COLORS[s.settings.trackColors.length])
          s.reviews = data.reviews || {}
          s.projects = data.projects || []
          s.pads = data.pads || {}
          // v1 files had no explicit "started": count a recording as started
          // only if it already has notes (watch progress alone doesn't).
          if ((data.version || 1) < 2) for (const r of Object.values(s.reviews)) r.started = !!(r.notes && r.notes.length) || !!r.done
          if (s.settings.currentProjectId && !s.projects.some((p) => p.id === s.settings.currentProjectId)) s.settings.currentProjectId = null
          // Watched-range tracking was removed; drop the old data from the file.
          for (const r of Object.values(s.reviews)) delete r.watched
        }
        s.beatColors = colors
        s.loaded = true
      })
      const [customThemes, frameless] = await Promise.all([api.customThemes().catch(() => []), api.isFrameless().catch(() => false)])
      set((s) => {
        s.bijouThemes = fromBijouCustom(customThemes)
        s.frameless = frameless
      })
      get().applyCurrentTheme()
      player.instantSeek = get().settings.instantSeek !== false
      player.setBaseRate(get().settings.watchSpeed || 1)
      const tools = await api.toolsStatus(get().settings.ffmpegDir || null)
      set((s) => {
        s.tools = { ...tools, checked: true }
      })
      api.setCachePolicy(get().settings.cacheLimitGB || 20, get().settings.cacheMode || 'remind')
      await get().loadProjectsFromDisk()
      startProjectSync()
      api.onProbed((clip) => get().clipProbed(clip))
      api.onWaveformEvent((ev) => get().waveformEvent(ev))
      api.onTranscriptEvent((ev) => get().transcriptEvent(ev))
      api.transcriptState().then((tx) => set((s) => { s.tx = tx }))
      window.addEventListener('beforeunload', () => {
        player.savePosition()
        get().flushSave()
      })
      await get().rescan()
      const last = get().settings.lastClipKey
      if (last && get().clips.some((c) => c.key === last)) get().openClip(last)
    },

    // ---- persistence ----
    scheduleSave() {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => get().flushSave(true), 600)
    },
    flushSave(async = false) {
      clearTimeout(saveTimer)
      const { settings, reviews, projects, pads } = get()
      const json = JSON.stringify({ version: 2, settings, reviews, projects, pads })
      if (async) api.saveData(json).catch((e) => get().showToast('Save failed: ' + e.message, 'error'))
      else api.saveDataSync(json)
    },

    showToast(text, kind = 'info') {
      const id = Date.now()
      set((s) => {
        s.toast = { id, text, kind }
      })
      setTimeout(() => {
        if (get().toast && get().toast.id === id) set((s) => { s.toast = null })
      }, kind === 'error' ? 6000 : 3200)
    },

    // ---- library ----
    async rescan() {
      const folders = get().settings.folders
      const files = get().settings.files || []
      if (!folders.length && !files.length) {
        set((s) => { s.clips = [] })
        return
      }
      set((s) => { s.scanning = true })
      const clips = await api.scan(folders, files)
      set((s) => {
        s.clips = clips
        s.scanning = false
      })
      if (get().settings.autoPrepare) get().prepareAll()
      await get().refreshTxDone()
      get().autoTranscribe()
      // Edit may have opened before the recordings were scanned: load its cut now.
      if (get().settings.workspace === 'edit') {
        seqPlayer.refreshSources()
        get().showSectionInPlayer()
      }
    },
    // Background transcription per Settings: the open recording first, then
    // (if "everything" is on) the rest, newest first. Only tracks without a
    // transcript get queued, so calling this again is cheap.
    autoTranscribe() {
      const st = get()
      if (!st.tx.installed) return
      const keys = []
      if (st.settings.autoTranscribeOpen !== false && st.currentKey) keys.push(st.currentKey)
      if (st.settings.autoTranscribeAll) {
        st.clips
          .filter((c) => c.probe && c.key !== st.currentKey)
          .sort((a, b) => b.recordedAt - a.recordedAt)
          .forEach((c) => keys.push(c.key))
      }
      if (keys.length) get().transcribe(keys, { silent: true })
    },
    // Newest first; main-process queue skips anything already prepared, and
    // whatever the user opens jumps to the front.
    prepareAll() {
      const withAudio = get()
        .clips.filter((c) => c.probe && c.probe.audio && c.probe.audio.length)
        .sort((a, b) => b.recordedAt - a.recordedAt)
      api.requestWaveforms(withAudio)
    },
    clipProbed(clip) {
      set((s) => {
        const i = s.clips.findIndex((c) => c.key === clip.key)
        if (i !== -1) s.clips[i] = clip
      })
      if (clip.key === get().currentKey) {
        player.clip = clip
        get().pushMixer()
        api.requestWaveform(clip, true)
      } else if (get().settings.autoPrepare && clip.probe && clip.probe.audio && clip.probe.audio.length) {
        api.requestWaveforms([clip])
      }
    },
    // Both return the keys of recordings the pick brought in (new or not),
    // so the Add footage window can pre-tick them.
    async addFolders() {
      const picked = await api.pickFolders()
      if (!picked.length) return []
      set((s) => {
        for (const p of picked) if (!s.settings.folders.includes(p)) s.settings.folders.push(p)
      })
      get().scheduleSave()
      await get().rescan()
      const norm = (p) => p.toLowerCase().replace(/[\\/]+$/, '') + '\\'
      const roots = picked.map(norm)
      return get().clips.filter((c) => roots.some((r) => c.key.startsWith(r))).map((c) => c.key)
    },
    async addFiles() {
      const picked = await api.pickFiles()
      if (!picked.length) return []
      set((s) => {
        if (!s.settings.files) s.settings.files = []
        for (const p of picked) if (!s.settings.files.includes(p)) s.settings.files.push(p)
      })
      get().scheduleSave()
      await get().rescan()
      const keys = new Set(picked.map((p) => p.toLowerCase()))
      return get().clips.filter((c) => keys.has(c.key)).map((c) => c.key)
    },
    removeFile(p) {
      set((s) => { s.settings.files = (s.settings.files || []).filter((f) => f !== p) })
      get().scheduleSave()
      get().rescan()
    },
    removeFolder(p) {
      set((s) => {
        s.settings.folders = s.settings.folders.filter((f) => f !== p)
      })
      get().scheduleSave()
      get().rescan()
    },
    setLibraryFilter(patch) {
      set((s) => { Object.assign(s.libraryFilter, patch) })
    },

    // ---- current clip ----
    clip() {
      const { clips, currentKey } = get()
      return clips.find((c) => c.key === currentKey) || null
    },
    review(key) {
      return get().reviews[key || get().currentKey] || null
    },
    openClip(key, at) {
      const clip = get().clips.find((c) => c.key === key)
      if (!clip) return
      const rev = get().reviews[key]
      const start = at != null ? at : rev && rev.lastPos && (!clip.probe || rev.lastPos < clip.probe.duration - 5) ? rev.lastPos : 0
      set((s) => {
        s.currentKey = key
        s.solo = []
        s.selectedNoteId = null
        s.editingNoteId = null
        s.inPoint = null
        s.settings.lastClipKey = key
        if (!s.reviews[key]) s.reviews[key] = emptyReview()
        s.reviews[key].lastOpened = Date.now()
      })
      player.load(clip, start)
      // Point extra tracks at their small extracted .m4a files (if prep has
      // run for this recording) before any of them start loading.
      api
        .audioFiles(clip)
        .catch(() => ({}))
        .then((files) => {
          if (get().currentKey !== key) return
          player.audioFiles = files || {}
          get().pushMixer()
        })
      if (clip.probe) api.requestWaveform(clip, true).then((st) => get().setWaveformStatus(key, st))
      get().scheduleSave()
      if (get().settings.autoTranscribeOpen !== false && get().tx.installed) setTimeout(() => get().transcribe([key], { silent: true, front: true }), 1500)
    },
    savePosition(key, pos) {
      set((s) => {
        if (s.reviews[key]) s.reviews[key].lastPos = pos
      })
      get().scheduleSave()
    },
    toggleDone(key) {
      key = key || get().currentKey
      if (!key) return
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        r.done = !r.done
        if (r.done) r.started = true
      })
      get().scheduleSave()
    },
    setStarted(key, started = true) {
      key = key || get().currentKey
      if (!key) return
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        r.started = started
        if (!started) r.done = false
      })
      get().scheduleSave()
    },

    // ---- workspaces (Review | Edit) ----
    setWorkspace(ws) {
      if (ws === get().settings.workspace) return
      // Only one thing plays at a time.
      if (ws === 'edit') player.pause()
      else seqPlayer.pause()
      set((s) => { s.settings.workspace = ws })
      get().scheduleSave()
      if (ws === 'edit') get().loadSections()
    },

    // ---- projects on disk ----
    async chooseProjectsDir() {
      const dir = await api.pickProjectsDir(get().settings.projectsDir || (await api.defaultProjectsDir()))
      if (!dir) return false
      set((s) => { s.settings.projectsDir = dir })
      get().scheduleSave()
      // Existing projects move into the folder; ones already there load.
      for (const p of get().projects) {
        const folder = await api.saveProject(dir, { ...p, folder: null })
        set((s) => {
          const q = s.projects.find((x) => x.id === p.id)
          if (q) q.folder = folder
        })
      }
      await get().loadProjectsFromDisk()
      get().showToast('Projects are saved in ' + dir)
      get().loadSections()
      return true
    },
    async loadProjectsFromDisk() {
      const dir = get().settings.projectsDir
      if (!dir) return
      const onDisk = await api.listProjects(dir)
      set((s) => {
        // Disk is the source of truth; anything only in memory (made before
        // the folder existed) is kept and gets saved there.
        const byId = new Map(onDisk.map((p) => [p.id, p]))
        // Project notes travel in project.json but live in s.pads (typing
        // there shouldn't re-render everything that watches the projects).
        for (const p of onDisk) {
          if (p.pad && Array.isArray(p.pad.items)) s.pads[p.id] = p.pad.items
          delete p.pad
        }
        const merged = [...onDisk]
        for (const p of s.projects) if (!byId.has(p.id)) merged.push(p)
        s.projects = merged
        if (s.settings.currentProjectId && !merged.some((p) => p.id === s.settings.currentProjectId)) s.settings.currentProjectId = null
      })
      markProjectsSaved(get().projects)
    },

    // ---- edit sections ----
    currentSection() {
      const st = get()
      const pid = st.settings.currentProjectId
      if (!pid || st.sectionsFor !== pid) return null
      const id = st.settings.sectionByProject[pid]
      return st.sections.find((x) => x.id === id) || null
    },
    async loadSections() {
      const p = get().currentProject()
      if (!p || !p.folder) {
        set((s) => { s.sections = []; s.sectionsFor = p ? p.id : null })
        return
      }
      const list = await api.listSections(p.folder)
      markSectionsSaved(list)
      set((s) => {
        // Same project already in memory (e.g. back from Review): memory is
        // never older than disk — the save runs a moment after each change —
        // so keep its version of every section, plus any made while the
        // folder was being read (＋ New right as the app opened). Undo
        // history survives too.
        const same = s.sectionsFor === p.id
        const mem = same ? s.sections : []
        const merged = list.map((d) => mem.find((m) => m.id === d.id) || d)
        for (const m of mem) if (!list.some((d) => d.id === m.id)) merged.push(m)
        s.sections = merged
        s.sectionsFor = p.id
        if (!same) {
          s.editSel = []
          s.editUndo = []
          s.editRedo = []
        }
        const cur = s.settings.sectionByProject[p.id]
        if (!merged.some((x) => x.id === cur)) s.settings.sectionByProject[p.id] = merged.length ? merged[0].id : null
      })
      get().showSectionInPlayer()
    },
    showSectionInPlayer() {
      const sec = get().currentSection()
      seqPlayer.setClips(sec ? sec.clips : [])
    },
    createSection(name) {
      const p = get().currentProject()
      if (!p) return null
      const sec = { id: 's' + Date.now().toString(36), name: name || 'Section ' + (get().sections.length + 1), order: get().sections.reduce((a, x) => Math.max(a, x.order + 1), 0), clips: [], markers: [], createdAt: Date.now() }
      set((s) => {
        s.sections.push(sec)
        s.sectionsFor = p.id
        s.settings.sectionByProject[p.id] = sec.id
        s.editSel = []
      })
      get().scheduleSave()
      get().showSectionInPlayer()
      return sec.id
    },
    duplicateSection(id) {
      const src = get().sections.find((x) => x.id === id)
      const p = get().currentProject()
      if (!src || !p) return null
      const sec = {
        id: 's' + Date.now().toString(36),
        name: src.name + ' (copy)',
        order: src.order + 0.5,
        clips: src.clips.map((c) => ({ ...c, id: EM.clipId() })),
        markers: (src.markers || []).map((m) => ({ ...m, id: 'm' + Math.random().toString(36).slice(2, 9) })),
        createdAt: Date.now()
      }
      set((s) => {
        s.sections.push(sec)
        s.settings.sectionByProject[p.id] = sec.id
        s.editSel = []
      })
      get().scheduleSave()
      get().showSectionInPlayer()
      get().showToast('Duplicated — now editing “' + sec.name + '”')
      return sec.id
    },
    renameSection(id, name) {
      set((s) => {
        const x = s.sections.find((q) => q.id === id)
        if (x && name.trim()) x.name = name.trim()
      })
    },
    async deleteSection(id) {
      const p = get().currentProject()
      set((s) => {
        s.sections = s.sections.filter((q) => q.id !== id)
        if (p && s.settings.sectionByProject[p.id] === id) s.settings.sectionByProject[p.id] = s.sections.length ? s.sections[0].id : null
        s.editUndo = s.editUndo.filter((u) => u.sectionId !== id)
        s.editRedo = s.editRedo.filter((u) => u.sectionId !== id)
      })
      if (p && p.folder) await api.trashSection(p.folder, id)
      forgetSection(id)
      get().scheduleSave()
      get().showSectionInPlayer()
    },
    setCurrentSection(id) {
      const p = get().currentProject()
      if (!p) return
      seqPlayer.pause()
      set((s) => {
        s.settings.sectionByProject[p.id] = id
        s.editSel = []
      })
      get().scheduleSave()
      get().showSectionInPlayer()
    },
    moveSection(id, dir) {
      set((s) => {
        const list = [...s.sections].sort((a, b) => a.order - b.order)
        const i = list.findIndex((x) => x.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return
        const a = s.sections.find((x) => x.id === list[i].id)
        const b = s.sections.find((x) => x.id === list[j].id)
        const t = a.order
        a.order = b.order
        b.order = t
        if (a.order === b.order) a.order += dir
      })
    },

    // One edit = one undo step. playhead: where to put it afterwards.
    applyEdit(nextClips, { playhead = null, select = null } = {}) {
      if (!nextClips) return false
      return get().applySection({ clips: nextClips }, { playhead, select })
    },
    // Any change to the section (its cut and/or its timeline markers) — one
    // undo step.
    applySection(patch, { playhead = null, select = null } = {}) {
      const sec = get().currentSection()
      if (!sec) return false
      set((s) => {
        const x = s.sections.find((q) => q.id === sec.id)
        s.editUndo.push({ sectionId: sec.id, clips: x.clips, markers: x.markers || [], at: Date.now() })
        if (s.editUndo.length > 200) s.editUndo.shift()
        s.editRedo = []
        if (patch.clips) x.clips = patch.clips
        if (patch.markers) x.markers = patch.markers
        const clips = x.clips
        s.editSel = select || s.editSel.filter((id) => clips.some((c) => c.id === id))
      })
      if (patch.clips) seqPlayer.setClips(patch.clips).then(() => { if (playhead != null) seqPlayer.seek(playhead) })
      else if (playhead != null) seqPlayer.seek(playhead)
      return true
    },
    // Timeline markers (Q in Edit): they sit at a time in the cut, not on a
    // recording, and export as sequence markers.
    addSeqMarker(t) {
      const sec = get().currentSection()
      if (!sec) return null
      const m = { id: 'm' + Date.now().toString(36), t: Math.round(t * 1000) / 1000, color: get().settings.markerColor || 'yellow', text: '' }
      get().applySection({ markers: [...(sec.markers || []), m].sort((a, b) => a.t - b.t) })
      return m.id
    },
    updateSeqMarker(id, patch) {
      const sec = get().currentSection()
      if (!sec) return
      if (patch.color) set((s) => { s.settings.markerColor = patch.color })
      get().applySection({ markers: (sec.markers || []).map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t) })
    },
    deleteSeqMarker(id) {
      const sec = get().currentSection()
      if (!sec) return
      get().applySection({ markers: (sec.markers || []).filter((m) => m.id !== id) })
    },
    // Ctrl+Z / Ctrl+Shift+Z in Edit: undoes whichever happened last — a
    // change to the cut / timeline markers, or to a recording's notes.
    editUndoRedo(redo = false) {
      const st = get()
      const stack = redo ? st.editRedo : st.editUndo
      const sec = st.currentSection()
      let i = stack.length - 1
      while (sec && i >= 0 && stack[i].sectionId !== sec.id) i--
      const notesStack = redo ? st.redo : st.undo
      const lastNotes = notesStack[notesStack.length - 1]
      const lastEdit = sec && i >= 0 ? stack[i] : null
      if (lastNotes && (!lastEdit || (lastNotes.at || 0) > (lastEdit.at || 0))) {
        redo ? get().redoNotes() : get().undoNotes()
        return
      }
      if (!lastEdit) return get().showToast(redo ? 'Nothing to redo' : 'Nothing to undo')
      const entry = lastEdit
      set((s) => {
        const x = s.sections.find((q) => q.id === sec.id)
        const other = redo ? s.editUndo : s.editRedo
        other.push({ sectionId: sec.id, clips: x.clips, markers: x.markers || [], at: entry.at })
        ;(redo ? s.editRedo : s.editUndo).splice(i, 1)
        x.clips = entry.clips
        x.markers = entry.markers || []
        s.editSel = []
      })
      seqPlayer.setClips(entry.clips)
    },
    setEditSel(ids) {
      set((s) => { s.editSel = ids })
    },
    setEditTool(tool) {
      set((s) => { s.editTool = tool })
    },
    toggleEditSidebar() {
      set((s) => { s.settings.editSidebarHidden = !s.settings.editSidebarHidden })
      get().scheduleSave()
    },
    toggleEditPanel() {
      set((s) => { s.settings.editPanelHidden = !s.settings.editPanelHidden })
      get().scheduleSave()
    },
    setEditWatchSpeed(r) {
      set((s) => { s.settings.editWatchSpeed = r })
      seqPlayer.setBaseRate(r)
      get().scheduleSave()
    },
    toggleEditSkipSilence() {
      set((s) => { s.settings.editSkipSilence = !s.settings.editSkipSilence })
      get().scheduleSave()
      get().showToast(get().settings.editSkipSilence ? 'Skip silence on — plays only the talking in the cut (⇥ tracks)' : 'Skip silence off')
    },
    toggleEditSnap() {
      set((s) => { s.settings.editSnap = !s.settings.editSnap })
      get().scheduleSave()
      get().showToast(get().settings.editSnap ? 'Snapping on' : 'Snapping off')
    },
    // Add a recording — whole, or a range of it — to the end of the current
    // section (making a section first if there isn't one).
    addToSection(key, inT, outT) {
      const clip = get().clips.find((c) => c.key === key)
      if (!clip || !clip.probe) return false
      if (!get().currentProject()) {
        get().showToast('Pick a project first (top of the library) — sections belong to a project')
        return false
      }
      if (!get().currentSection()) get().createSection()
      const sec = get().currentSection()
      const a = inT == null ? 0 : inT
      const b = outT == null ? clip.probe.duration : outT
      const next = EM.add(sec.clips, key, Math.min(a, b), Math.max(a, b))
      if (!next) return false
      bus.emit('editAdded') // the timeline refits if the new footage runs off the edge
      get().applyEdit(next)
      api.requestWaveform(clip, true) // its per-track audio makes playback smooth
      return sec.name
    },
    async resolveSource(key) {
      const clip = get().clips.find((c) => c.key === key)
      if (!clip || !clip.probe) throw new Error('Recording not found: ' + key)
      const audio = clip.probe.audio || []
      const files = await api.audioFiles(clip)
      return { key, path: clip.path, trackCount: audio.length, audioFiles: files, empty: audio.map((a) => !!a.likelySilent), fps: clip.probe.fps || 60, keyframes: clip.probe.keyframes || null }
    },
    // Q in Edit: a quick marker on the recording under the playhead — so it
    // shows in Review too, and exports with the cut.
    addMarkerAt(key, t) {
      get().snapshot && get().snapshot(key)
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        r.notes.push({ id: newId(), t: Math.round(t * 100) / 100, type: 'MARKER', color: s.settings.markerColor || 'yellow', text: '', star: false, createdAt: Date.now() })
        r.notes.sort((a, b) => a.t - b.t)
      })
      get().scheduleSave()
    },

    // ---- projects ----
    currentProject() {
      const id = get().settings.currentProjectId
      return (id && get().projects.find((p) => p.id === id)) || null
    },
    setCurrentProject(id) {
      set((s) => { s.settings.currentProjectId = id })
      get().scheduleSave()
      if (get().settings.workspace === 'edit') get().loadSections()
    },
    createProject(name) {
      const p = newProject(name)
      set((s) => {
        s.projects.push(p)
        s.settings.currentProjectId = p.id
      })
      get().scheduleSave()
      return p.id
    },
    renameProject(id, name) {
      set((s) => {
        const p = s.projects.find((x) => x.id === id)
        if (p && name.trim()) p.name = name.trim()
      })
      get().scheduleSave()
    },
    // ---- project notes (the pad) ----
    // Free notes + checklists for the whole project, shared by Review and
    // Edit. Kept per project id; with no project open, one 'all' pad.
    padKey() {
      return get().settings.currentProjectId || 'all'
    },
    // items: [{id, kind: 'text'|'check'|'head'|'bullet', text, done}]
    // undoable: structural changes (delete, reorder, clear done) can be undone.
    setPad(key, items, undoable = false) {
      const before = get().pads[key] || []
      if (items === before) return
      set((s) => {
        s.pads[key] = items
        if (undoable) {
          s.padUndo.push({ key, items: before })
          if (s.padUndo.length > 50) s.padUndo.shift()
        }
      })
      get().scheduleSave()
    },
    undoPad(key) {
      const st = get()
      for (let i = st.padUndo.length - 1; i >= 0; i--) {
        if (st.padUndo[i].key !== key) continue
        const { items } = st.padUndo[i]
        set((s) => {
          s.pads[key] = items
          s.padUndo.splice(i, 1)
        })
        get().scheduleSave()
        return true
      }
      return false
    },

    // Deleting a project never touches notes — they belong to the recordings.
    deleteProject(id) {
      set((s) => {
        s.projects = s.projects.filter((p) => p.id !== id)
        delete s.pads[id] // its project.json (with the notes) goes to the Recycle Bin
        if (s.settings.currentProjectId === id) s.settings.currentProjectId = null
      })
      get().scheduleSave()
    },
    addToProject(id, keys) {
      set((s) => {
        const p = s.projects.find((x) => x.id === id)
        if (!p) return
        for (const k of keys) if (!p.clipKeys.includes(k)) p.clipKeys.push(k)
      })
      get().scheduleSave()
    },
    removeFromProject(id, key) {
      set((s) => {
        const p = s.projects.find((x) => x.id === id)
        if (p) p.clipKeys = p.clipKeys.filter((k) => k !== key)
      })
      get().scheduleSave()
    },
    setProjectScript(id, scriptId) {
      set((s) => {
        const p = s.projects.find((x) => x.id === id)
        if (p) p.bijouScriptId = scriptId
      })
      get().scheduleSave()
    },
    // Double-click on a marker in the timeline: open it for editing in the
    // notes panel (showing the panel if it was hidden).
    editNoteFromTimeline(id) {
      set((s) => {
        s.settings.notesHidden = false
        s.selectedNoteId = id
        s.editingNoteId = id
      })
    },
    // Magnet button next to the speed (keybind comes with Phase 3).
    toggleSkipSilence() {
      set((s) => { s.settings.skipSilence = !s.settings.skipSilence })
      get().scheduleSave()
      get().showToast(get().settings.skipSilence ? 'Skip silence on — plays only the talking (⇥ tracks)' : 'Skip silence off')
    },
    toggleSnap() {
      set((s) => { s.settings.snap = !s.settings.snap })
      get().scheduleSave()
      get().showToast(get().settings.snap ? 'Snapping on' : 'Snapping off')
    },
    // ---- themes / window ----
    allThemes() {
      return [...BUILT_IN_THEMES, ...get().bijouThemes]
    },
    applyCurrentTheme() {
      const id = get().settings.theme
      const theme = get().allThemes().find((t) => t.id === id) || BUILT_IN_THEMES[0]
      applyTheme(theme)
      // Keep the min/max/close buttons (hidden-title-bar mode) on-theme.
      api.setOverlayColors({ color: theme.colors['--panel'], symbolColor: theme.colors['--ink'] }).catch(() => {})
    },
    async refreshBijouThemes() {
      const list = await api.customThemes().catch(() => [])
      set((s) => { s.bijouThemes = fromBijouCustom(list) })
    },
    setTheme(id) {
      set((s) => { s.settings.theme = id })
      get().applyCurrentTheme()
      get().scheduleSave()
    },
    setHideTitleBar(on) {
      set((s) => { s.settings.hideTitleBar = on })
      get().flushSave()
    },
    openColorMenu(menu) {
      set((s) => { s.colorMenu = menu })
    },
    closeColorMenu() {
      set((s) => { s.colorMenu = null })
    },
    toggleSpeechShow(i) {
      set((s) => {
        const a = s.settings.speechShow || (s.settings.speechShow = [false, true, true, true, true, true])
        a[i] = !a[i]
      })
      get().scheduleSave()
    },
    toggleSpeechSkip(i) {
      set((s) => {
        const a = s.settings.speechSkip || (s.settings.speechSkip = [false, true, true, true, true, true])
        a[i] = !a[i]
      })
      get().scheduleSave()
    },
    setNotesZoom(z) {
      set((s) => { s.settings.notesZoom = Math.round(Math.max(0.7, Math.min(2, z)) * 10) / 10 })
      get().scheduleSave()
    },
    setNotesWidth(w) {
      // Leave the video at least ~360px.
      set((s) => { s.settings.notesWidth = Math.round(Math.max(280, Math.min(Math.max(760, window.innerWidth - 360), w))) })
      get().scheduleSave()
    },
    // ---- transcription ----
    setSideTab(tab) {
      set((s) => {
        s.settings.sideTab = tab
        s.settings.notesHidden = false
        // Side by side needs room: widen the panel the first time.
        if (tab === 'both' && (s.settings.notesWidth || 360) < 640) s.settings.notesWidth = Math.min(760, Math.max(640, window.innerWidth - 900))
      })
      get().scheduleSave()
    },
    setSearchHits(hits) {
      set((s) => { s.searchHits = hits })
    },
    toggleTranscribeTrack(i) {
      set((s) => {
        const a = s.settings.transcribeTracks || (s.settings.transcribeTracks = [false, true, true, false, false, false])
        a[i] = !a[i]
      })
      get().scheduleSave()
    },
    async refreshTxDone() {
      const clips = get().clips.filter((c) => c.probe).map((c) => ({ key: c.key, size: c.size, probe: { audio: c.probe.audio || [] } }))
      const map = await api.transcriptDoneMap(clips)
      set((s) => { s.txDone = map })
    },
    // Queue the chosen tracks of these recordings (skips empty tracks and
    // anything already transcribed).
    transcribe(keys, opts = {}) {
      const { clips, settings } = get()
      const want = settings.transcribeTracks || []
      const jobs = []
      for (const k of keys) {
        const clip = clips.find((c) => c.key === k)
        if (!clip || !clip.probe) continue
        const audio = clip.probe.audio || []
        // Only what the main process needs (not e.g. the keyframe index).
        const slim = { key: clip.key, size: clip.size, path: clip.path, probe: { audio, duration: clip.probe.duration } }
        audio.forEach((a, i) => { if (want[i] && !a.likelySilent) jobs.push({ clip: slim, track: i }) })
      }
      if (!jobs.length) {
        if (!opts.silent) get().showToast('Nothing to transcribe — tick the tracks you want in the Transcript tab')
        return 0
      }
      api.requestTranscripts(jobs, settings.transcriptLang ?? 'en', !!opts.front)
      return jobs.length
    },
    cancelTranscripts(key) {
      api.cancelTranscripts(key || null)
    },
    transcriptEvent(ev) {
      if (ev.type === 'state') {
        set((s) => { s.tx = { installed: ev.installed, running: ev.running, queue: ev.queue } })
      } else if (ev.type === 'done') {
        set((s) => {
          const a = s.txDone[ev.key] || (s.txDone[ev.key] = [])
          if (!a.includes(ev.track)) a.push(ev.track)
          a.sort((x, y) => x - y)
          s.txVersion++
        })
      } else if (ev.type === 'error') {
        const name = trackNamesFor(get(), ev.key)[ev.track] || 'Track ' + (ev.track + 1)
        get().showToast('Transcription failed (' + name + '): ' + ev.message, 'error')
      }
    },

    toggleNotesPanel() {
      set((s) => { s.settings.notesHidden = !s.settings.notesHidden })
      get().scheduleSave()
    },

    // ---- mixer ----
    // Tracks that ffprobe says are empty start muted (when that setting is
    // on) — but only for this clip's session, via solo-less "auto mute",
    // so the user's real per-track mute choices aren't overwritten.
    effectiveMixer() {
      const { settings } = get()
      const clip = get().clip()
      return settings.mixer.map((m, i) => {
        const a = clip && clip.probe && clip.probe.audio[i]
        const empty = !!(a && a.likelySilent)
        return { ...m, mute: m.mute || (settings.autoMuteEmpty && empty && !m.forceOn) }
      })
    },
    pushMixer() {
      const { settings, solo } = get()
      player.setMixer(get().effectiveMixer(), new Set(solo), settings.masterVol)
    },
    setTrackVol(i, vol) {
      set((s) => { s.settings.mixer[i].vol = vol })
      get().pushMixer()
      get().scheduleSave()
    },
    toggleMute(i) {
      const clip = get().clip()
      const a = clip && clip.probe && clip.probe.audio[i]
      const eff = get().effectiveMixer()[i]
      set((s) => {
        const m = s.settings.mixer[i]
        if (a && a.likelySilent && s.settings.autoMuteEmpty) {
          // An auto-muted empty track: unmuting it means "play it anyway".
          if (eff.mute) { m.mute = false; m.forceOn = true } else { m.forceOn = false }
        } else m.mute = !m.mute
      })
      get().pushMixer()
      get().scheduleSave()
    },
    clearSolo() {
      set((s) => { s.solo = [] })
      get().pushMixer()
    },
    // ---- keybinds (lib/keybinds.js has the actions + defaults) ----
    setKeybinds(id, combos) {
      set((s) => {
        if (!s.settings.keybinds) s.settings.keybinds = {}
        s.settings.keybinds[id] = combos
      })
      get().scheduleSave()
    },
    resetKeybind(id) {
      set((s) => { if (s.settings.keybinds) delete s.settings.keybinds[id] })
      get().scheduleSave()
    },
    resetAllKeybinds() {
      set((s) => { s.settings.keybinds = {} })
      get().scheduleSave()
    },
    // Edit mode's keys (lib/editKeys.js), same idea.
    setEditKeybinds(id, combos) {
      set((s) => {
        if (!s.settings.editKeybinds) s.settings.editKeybinds = {}
        s.settings.editKeybinds[id] = combos
      })
      get().scheduleSave()
    },
    resetEditKeybind(id) {
      set((s) => { if (s.settings.editKeybinds) delete s.settings.editKeybinds[id] })
      get().scheduleSave()
    },
    resetAllEditKeybinds() {
      set((s) => { s.settings.editKeybinds = {} })
      get().scheduleSave()
    },
    toggleSolo(i, exclusive = true) {
      set((s) => {
        const has = s.solo.includes(i)
        if (exclusive) s.solo = has && s.solo.length === 1 ? [] : [i]
        else s.solo = has ? s.solo.filter((x) => x !== i) : [...s.solo, i]
      })
      get().pushMixer()
    },
    setMasterVol(v) {
      set((s) => { s.settings.masterVol = v })
      get().pushMixer()
      get().scheduleSave()
    },
    setTrackColor(i, color) {
      set((s) => { s.settings.trackColors[i] = color || TRACK_COLORS[i] })
      get().scheduleSave()
    },
    setWatchSpeed(r) {
      set((s) => { s.settings.watchSpeed = r })
      player.setBaseRate(r)
      get().scheduleSave()
    },
    setEditLaneHeight(i, h) {
      set((s) => {
        const a = s.settings.editLaneHeights || (s.settings.editLaneHeights = [44, 44, 44, 44, 44, 44])
        a[i] = Math.round(Math.max(28, Math.min(260, h)))
      })
      get().scheduleSave()
    },
    setLaneHeight(i, h) {
      set((s) => { s.settings.laneHeights[i] = Math.round(Math.max(LANE_H_MIN, Math.min(LANE_H_MAX, h))) })
      get().scheduleSave()
    },
    setTimelineHeight(h) {
      set((s) => { s.settings.timelineHeight = Math.round(h) })
      get().scheduleSave()
    },
    toggleLibrary() {
      set((s) => { s.settings.libraryHidden = !s.settings.libraryHidden })
      get().scheduleSave()
    },
    // Default name (Settings → Tracks).
    renameTrack(i, name) {
      set((s) => { s.settings.trackNames[i] = name || DEFAULT_TRACK_NAMES[i] })
      get().scheduleSave()
    },
    // Name for just this recording; empty (or the default) goes back to the default.
    renameTrackHere(key, i, name) {
      if (!key) return
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        const own = r.trackNames || (r.trackNames = {})
        if (!name || name === s.settings.trackNames[i]) delete own[i]
        else own[i] = name
        if (!Object.keys(own).length) delete r.trackNames
      })
      get().scheduleSave()
    },

    // ---- waveforms ----
    setWaveformStatus(key, status) {
      set((s) => {
        s.waveforms[key] = { ...(s.waveforms[key] || {}), status }
      })
    },
    setCachePolicy(limitGB, mode) {
      get().updateSettings({ cacheLimitGB: limitGB, cacheMode: mode })
      api.setCachePolicy(limitGB, mode)
    },
    async trimCache() {
      const r = await api.trimCache(get().clip() || null)
      get().showToast('Freed ' + fmtBytes(r.freed) + (r.skipped ? ' (' + r.skipped + ' files in use were kept)' : ''))
      return r
    },
    async emptyCache() {
      const r = await api.emptyCache(get().clip() || null)
      get().showToast('Cache emptied — freed ' + fmtBytes(r.freed) + '. The open recording was kept; others rebuild when you open them.')
      return r
    },
    waveformEvent(ev) {
      if (ev.type === 'cache') {
        set((s) => { s.cache = { size: ev.size, limit: ev.limit, over: ev.over, mode: ev.mode } })
        return
      }
      if (ev.type === 'cacheCleared') {
        // Other recordings' prepared files are gone: forget their "ready".
        set((s) => {
          const cur = s.currentKey && s.waveforms[s.currentKey]
          s.waveforms = cur ? { [s.currentKey]: cur } : {}
        })
        return
      }
      set((s) => {
        if (ev.queueLength != null) s.waveformQueue = ev.queueLength
        if (!ev.key) return
        const w = s.waveforms[ev.key] || (s.waveforms[ev.key] = {})
        if (ev.type === 'start') { w.status = 'running'; w.progress = 0 }
        if (ev.type === 'progress') { w.status = 'running'; w.progress = ev.progress }
        if (ev.type === 'queued') w.status = 'queued'
        if (ev.type === 'done') { w.status = 'ready'; w.progress = 1; w.version = Date.now() }
        if (ev.type === 'error') { w.status = 'error'; w.error = ev.message }
      })
      if (ev.type === 'done' && ev.key === get().currentKey) {
        const clip = get().clip()
        if (clip) api.audioFiles(clip).then((files) => player.setAudioFiles(ev.key, files))
      }
    },
    buildAllWaveforms() {
      const withAudio = get().clips.filter((c) => c.probe && c.probe.audio && c.probe.audio.length)
      api.requestWaveforms(withAudio)
      get().showToast(`Queued waveforms for ${withAudio.length} recordings`)
    },

    // ---- notes ----
    snapshot(key) {
      const r = get().reviews[key]
      set((s) => {
        s.undo.push({ key, notes: JSON.parse(JSON.stringify(r ? r.notes : [])), at: Date.now() })
        if (s.undo.length > UNDO_LIMIT) s.undo.shift()
        s.redo = []
      })
    },
    // An undo entry is {key, notes} (one recording) or {multi: [{key, notes}]}
    // (a bulk action across recordings, undone in one step).
    undoNotes() {
      const u = get().undo
      if (!u.length) return
      const last = u[u.length - 1]
      set((s) => {
        const e = s.undo.pop()
        const parts = e.multi || [e]
        const back = parts.map((p) => {
          const r = s.reviews[p.key] || (s.reviews[p.key] = emptyReview())
          const cur = { key: p.key, notes: JSON.parse(JSON.stringify(r.notes)) }
          r.notes = p.notes
          return cur
        })
        s.redo.push({ ...(e.multi ? { multi: back } : back[0]), at: e.at })
        s.editingNoteId = null
      })
      get().scheduleSave()
      const keys = (last.multi || [last]).map((p) => p.key)
      if (last.multi) get().showToast('Restored deleted notes')
      else if (!keys.includes(get().currentKey)) get().showToast('Undid a change in another recording')
    },
    redoNotes() {
      if (!get().redo.length) return
      set((s) => {
        const e = s.redo.pop()
        const parts = e.multi || [e]
        const back = parts.map((p) => {
          const r = s.reviews[p.key] || (s.reviews[p.key] = emptyReview())
          const cur = { key: p.key, notes: JSON.parse(JSON.stringify(r.notes)) }
          r.notes = p.notes
          return cur
        })
        s.undo.push({ ...(e.multi ? { multi: back } : back[0]), at: e.at })
        s.editingNoteId = null
      })
      get().scheduleSave()
    },
    // Bulk delete from the notes panel: ids may span several recordings.
    deleteNotes(ids) {
      const idSet = new Set(ids)
      const touched = Object.entries(get().reviews).filter(([, r]) => r.notes.some((n) => idSet.has(n.id)))
      if (!touched.length) return 0
      let count = 0
      set((s) => {
        s.undo.push({ multi: touched.map(([key, r]) => ({ key, notes: JSON.parse(JSON.stringify(r.notes)) })), at: Date.now() })
        if (s.undo.length > UNDO_LIMIT) s.undo.shift()
        s.redo = []
        for (const [key] of touched) {
          const r = s.reviews[key]
          const before = r.notes.length
          r.notes = r.notes.filter((n) => !idSet.has(n.id))
          count += before - r.notes.length
        }
        if (idSet.has(s.selectedNoteId)) s.selectedNoteId = null
        if (idSet.has(s.editingNoteId)) s.editingNoteId = null
      })
      get().scheduleSave()
      return count
    },
    setMarkerColor(id, color, key) {
      get().editNote(id, { color }, key)
      set((s) => { s.settings.markerColor = color })
    },

    // kind: 'beat' (auto Setup/But/Therefore like Beat Notes), 'note', 'break',
    // 'marker' (a colored Premiere marker; opens for an optional name — Esc keeps it unnamed).
    addNote(kind = 'beat', opts = {}) {
      const key = get().currentKey
      if (!key) return null
      const t = opts.t != null ? opts.t : player.getTime()
      get().snapshot(key)
      const id = newId()
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        const before = r.notes.filter((n) => n.t <= t).sort((a, b) => a.t - b.t)
        const type = kind === 'note' ? 'NOTE' : kind === 'break' ? 'BREAK' : kind === 'marker' ? 'MARKER' : pickDefaultType(before)
        const note = { id, t: Math.round(t * 100) / 100, type, text: '', star: false, createdAt: Date.now() }
        if (type === 'MARKER') note.color = s.settings.markerColor || 'yellow'
        if (opts.end != null) note.end = Math.round(opts.end * 100) / 100
        r.notes.push(note)
        r.notes.sort((a, b) => a.t - b.t)
        s.selectedNoteId = id
        // opts.quick: drop it and keep going (Quick marker) — no typing, no pause.
        const edits = kind !== 'break' && !opts.quick
        s.editingNoteId = edits ? id : null
        // A new note/marker opens for typing — make sure its panel is showing.
        if (edits) s.settings.notesHidden = false
      })
      if (kind !== 'break' && !opts.quick && get().settings.pauseWhileTyping && player.playing) {
        player.pause()
        set((s) => { s.resumeAfterEdit = true })
      }
      get().scheduleSave()
      return id
    },
    // The notes panel's "Type what happened" box: a finished note in one go,
    // stamped at the moment you started typing. Doesn't pause playback.
    logNote({ t, type, text }) {
      const key = get().currentKey
      if (!key || !text.trim()) return
      get().snapshot(key)
      set((s) => {
        const r = s.reviews[key] || (s.reviews[key] = emptyReview())
        const before = r.notes.filter((n) => n.t <= t).sort((a, b) => a.t - b.t)
        r.notes.push({ id: newId(), t: Math.round(t * 100) / 100, type: type || pickDefaultType(before), text: text.trim(), star: false, createdAt: Date.now() })
        r.notes.sort((a, b) => a.t - b.t)
      })
      get().scheduleSave()
    },
    updateNote(id, patch, key) {
      key = key || get().currentKey
      set((s) => {
        const r = s.reviews[key]
        const n = r && r.notes.find((x) => x.id === id)
        if (!n) return
        Object.assign(n, patch)
        if (patch.t != null) r.notes.sort((a, b) => a.t - b.t)
        if ('text' in patch || 'type' in patch || 't' in patch || 'end' in patch) delete n.exportedAt
      })
      get().scheduleSave()
    },
    // For discrete edits (type cycle, star, retime) that should be one undo step.
    editNote(id, patch, key) {
      key = key || get().currentKey
      get().snapshot(key)
      get().updateNote(id, patch, key)
    },
    deleteNote(id, key) {
      key = key || get().currentKey
      get().snapshot(key)
      set((s) => {
        const r = s.reviews[key]
        if (!r) return
        r.notes = r.notes.filter((n) => n.id !== id)
        if (s.selectedNoteId === id) s.selectedNoteId = null
        if (s.editingNoteId === id) s.editingNoteId = null
      })
      get().scheduleSave()
    },
    selectNote(id, edit = false) {
      set((s) => {
        s.selectedNoteId = id
        s.editingNoteId = edit ? id : null
      })
    },
    // Enter keeps the note even if empty (a bare flag is a legit "something
    // happens here" marker); Escape on a still-empty note cancels it.
    finishEditing(resume = true, cancelIfEmpty = false) {
      const id = get().editingNoteId
      const key = get().currentKey
      const r = get().reviews[key]
      const n = r && r.notes.find((x) => x.id === id)
      if (cancelIfEmpty && n && n.type !== 'MARKER' && !n.text.trim() && n.end == null && !n.star) {
        set((s) => {
          const rr = s.reviews[key]
          rr.notes = rr.notes.filter((x) => x.id !== id)
          s.undo.pop()
          s.selectedNoteId = null
        })
      }
      set((s) => {
        s.editingNoteId = null
      })
      if (resume && get().resumeAfterEdit) player.play()
      set((s) => { s.resumeAfterEdit = false })
      get().scheduleSave()
    },
    setInPoint() {
      const t = player.getTime()
      set((s) => { s.inPoint = { key: s.currentKey, t } })
      get().showToast('In point set — O makes a range beat ending here · E sends in → here to the edit section')
    },
    clearInPoint() {
      set((s) => { s.inPoint = null })
    },
    addRange() {
      const ip = get().inPoint
      const t = player.getTime()
      if (!ip || ip.key !== get().currentKey || Math.abs(t - ip.t) < 0.5) {
        get().showToast('Press I at the start of the moment first, then O at the end')
        return
      }
      const [a, b] = ip.t < t ? [ip.t, t] : [t, ip.t]
      get().addNote('beat', { t: a, end: b })
      set((s) => { s.inPoint = null })
    },
    markExported(ids) {
      const now = Date.now()
      const idSet = new Set(ids)
      set((s) => {
        for (const r of Object.values(s.reviews)) for (const n of r.notes) if (idSet.has(n.id)) n.exportedAt = now
      })
      get().scheduleSave()
    },

    setRightTab(tab) {
      set((s) => { s.rightTab = tab })
    },
    openModal(m) {
      set((s) => { s.modal = m })
    },
    closeModal() {
      set((s) => { s.modal = null })
    },
    setExportSelection(ids) {
      set((s) => { s.exportSelection = ids })
    },
    updateSettings(patch) {
      set((s) => { Object.assign(s.settings, patch) })
      get().scheduleSave()
      if ('ffmpegDir' in patch) api.toolsStatus(patch.ffmpegDir || null).then((t) => set((s) => { s.tools = { ...t, checked: true } }))
      if ('autoMuteEmpty' in patch || 'masterVol' in patch) get().pushMixer()
      if (patch.autoPrepare === true) get().prepareAll()
      if (patch.autoPrepare === false) api.clearWaveformQueue()
      if ('instantSeek' in patch) player.instantSeek = patch.instantSeek !== false
    }
  }))
)

// Wire player → store once.
player.on('position', ({ key, t }) => useStore.getState().savePosition(key, t))
player.on('seek', (t) => {
  const key = useStore.getState().currentKey
  if (key) useStore.getState().savePosition(key, t)
})

if (typeof window !== 'undefined') window.__store = useStore

// How Edit playback finds a recording (path, extracted audio, keyframes).
// Set here, not in init(): the app can open straight into Edit.
seqPlayer.resolve = (key) => useStore.getState().resolveSource(key)
