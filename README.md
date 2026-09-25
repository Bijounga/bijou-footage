# Bijou Footage

Review and rough-cut long OBS recordings, then send the cut to Premiere.
It's a companion to [BijouDocs](https://github.com/Bijounga/bijoudocs).

**[Download it](https://github.com/Bijounga/bijou-footage/releases/latest)**: `Bijou-Footage-Setup-….exe` for Windows, `Bijou-Footage-…-universal.dmg` for a Mac (Apple Silicon and Intel). Once installed, it keeps itself up to date.

On a Mac, drag it into Applications. The first time you open it, macOS says it's from an unidentified developer (the app isn't signed with a paid Apple certificate): right-click it and choose **Open**, or allow it in System Settings → Privacy & Security. The app ejects its disk image by itself, and its updates never use one, so nothing is left behind in Finder.

After installing, **Settings → Tools** sets up what it needs: ffmpeg, transcription (Whisper) and AI summaries (a local model). Each is one click.

## What it does
- **Review:** plays multi-hour, multi-track OBS recordings instantly, with no
  proxies. Per-track mixing and waveforms. Notes and beats with keyboard
  shortcuts. Transcripts (local Whisper), with AI summaries of any stretch
  (local LLM). Skip-silence playback. Sends notes to the BijouDocs mind map
  or Premiere.
- **Edit:** one folder per project, split into sections, each a magnetic
  timeline. Cut, ripple delete and trim with the keyboard
  (D / F / G / A / S, C / V tools). Remove silence with padding. Cut
  around markers and beats. Timeline markers, clip colours, and
  transcript-driven cuts. Exports to Premiere as an XML sequence, with
  clip colours and markers carried over. Smooth with thousands of cuts.
- **Project notes:** checklists and notes for the whole project, shared
  between Review and Edit.

## Develop
```
npm install
npm run dev      # development
npm run dist     # build a Windows installer into dist/
```

## Releasing
Bump `version` in `package.json`, commit, then tag and push:
```
git tag v0.4.1
git push origin main --tags
```
GitHub Actions (`.github/workflows/release.yml`) builds the installer and
publishes it as a Release. Installed copies pick it up automatically: they
check when the app opens and every 4 hours, then offer "Restart to update".
The same Release has the Mac build. `.github/workflows/mac-test.yml` runs the
real app on one of GitHub's Macs (installing every tool, playing, editing,
transcribing, summarizing, a full self-update, and checking that no disk image
is left mounted).

Needs `ffmpeg`/`ffprobe` (found automatically in `C:\ffmpeg\bin` or on PATH;
override in Settings). They're only used to read file info and build
waveforms. Playback never uses them.

## How it stays fast
- **No proxies, no transcoding.** Chromium plays the original H.264/HEVC
  file straight from disk, GPU-decoded, served via a range-aware
  `footage://` protocol so seeking reads only the bytes it needs.
- **Multi-track audio with no preprocessing.** With the `AudioVideoTracks`
  blink feature on, each OBS track gets its own `<audio>` element on the same
  file with only that track enabled, mixed through Web Audio (per-track gain,
  mute, solo, meters) and slaved to the video clock. Muted/empty tracks
  don't load at all. See `src/lib/player.js`.
- **Empty-track detection is free.** A silent AAC track encodes to about
  2.27 kbps, so ffprobe's bitrate alone flags it.
- **Waveforms** are built once in the background (one ffmpeg pass decodes
  every track, about 20 s per hour of footage) and cached in the app data folder.
- **Instant seeking.** An exact seek has to decode from the previous
  keyframe, which can be up to 250 frames of 1440p at ~118 Mbps
  (250–900 ms). A second, silent "ghost" `<video>` sits over the main one
  and jumps to the nearest *keyframe* instead (a one-frame decode, ~20–40 ms).
  It shows that frame while the main video does the exact seek, then hides
  once the exact frame is on screen. The ghost also powers hover thumbnails
  (and holds the exact hovered frame, so a click after hovering is
  instant), timeline scrubbing, and 8×–64× skim (~24 fps of picture).
  Measured: 40–60 ms to first picture, down from 250–1,300 ms.
- **Exact keyframe times** come from the MP4's own index (`stss`/`stts`/
  `ctts` in the moov box; `electron/main/keyframes.js`, ~3 ms per file).
  OBS keyframes are *not* strictly periodic: extra ones at scene changes
  shift the pattern, and a guessed position that lands just before a real
  keyframe costs a full group-of-pictures decode.
- **Instant seeks while playing** (setting, on by default). While playing,
  a click or skip lands on the nearest keyframe, a one-frame decode, so the
  picture and sound carry on in ~35–70 ms. Paused seeks stay frame-exact.
- **Extracted audio tracks.** Background prep copies every non-empty track
  (including track 1) to a small `.m4a` (no re-encode, 20 GB LRU cache),
  so the video element is picture-only. Otherwise each track's player
  reads the whole video file, which made seeks 2–3× slower, and restarting
  the video's own audio after a seek added another ~40 ms.
- **Every recording is prepared in the background** from launch (setting,
  on by default), newest first; the one you open jumps the queue.
- `scripts/seekbench.js` (paused seeks) and `scripts/playbench.js`
  (seeks while playing, time to moving picture and sound) measure all of
  this, e.g. `node scripts/cdp.mjs eval "$(cat scripts/playbench.js)"`.

## Data
- Notes, projects and settings are saved to `~/.bijou-footage/app/reviews.json`
  (daily backups for the last 7 days in `backups/`). Edit projects live in the
  projects folder you choose: one folder per project (`project.json`, which
  includes the project notes, plus `sections/<id>.json`).
- Recording files are never modified.
- **Send to BijouDocs** appends idea nodes and edges to a script's
  `mapLayout`, the same contract as the Beat Notes Premiere panel
  (`importedFrom: 'bijou-footage'`). If BijouDocs has the script open, it
  merges the new nodes live (`src/lib/externalMerge.js` in the main app).
- **Premiere XML** (FCP7 xmeml): one sequence per recording, with notes as markers.
