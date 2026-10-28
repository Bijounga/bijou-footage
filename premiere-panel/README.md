# Bijou Footage Rebuild — Premiere Pro panel

Rebuilds a Bijou Footage section as a sequence in the open Premiere project.

1. In Bijou Footage (Edit tab): **Export → Export for the Premiere panel…** saves a `.json` file.
2. In Premiere: **Window → Extensions → Bijou Footage Rebuild** → **Load a section file…** → **Build the sequence**.

The recordings are imported the way Premiere imports them itself (kept in a "Bijou Footage" bin and reused),
so their audio comes in as proper stereo tracks. Cuts, switched-off layers, clip colours, zoom, markers and
the voiceover (with its levels and names) are set.

Install / update it from Bijou Footage: **Settings → Tools → Premiere panel** (Windows and Mac). Then restart Premiere.

Files: `host/lib.jsx` runs inside Premiere (ExtendScript, ES3 — no `.in` property access, no JSON, semicolons after
bare `continue`); `js/main.js` is the panel. A job file dropped next to the panel (`job.json`) runs a call in Premiere
and answers in `result.json` — used for testing (`RAW:<script>` runs a script as it is, `RELOAD` reloads the panel).
