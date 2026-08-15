# Stem Studio — Architecture

Electron app that records screen / cam / mic as separate stems and edits them
locally (Edit-T1 timeline → ffmpeg apply). Three strict layers plus a pure edit
model, enforced by `scripts/check-architecture.js` (runs in `npm run preflight`).

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ renderer/          UNTRUSTED UI (sandboxed, no Node)        │
│   index.html · studio.js · timeline.css                     │
│   talks ONLY to window.stemStudio / window.batchRecorder    │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (preload.js)
┌──────────────────────────┴──────────────────────────────────┐
│ main.js            Electron main — thin: window lifecycle,  │
│                    IPC validation, wiring lib/ to handlers  │
└──────────────────────────┬──────────────────────────────────┘
                           │ plain require()
┌──────────────────────────┴──────────────────────────────────┐
│ lib/               Node domain + I/O helpers (no Electron   │
│                    imports except paths.js lazy app-path)   │
│                                                             │
│   PURE edit model (no electron/fs/child_process):           │
│     clip-ops.js · undo-stack.js · gap-chips.js              │
│   I/O boundary:                                             │
│     edit-manifest.js · media-cache.js · ffmpeg-util.js      │
│     transcribe.js · paths.js                                │
└─────────────────────────────────────────────────────────────┘
```

Invariants (preflight-enforced):

1. `renderer/` never requires `fs`, `child_process`, `electron`, or `lib/*` —
   only relative UI modules. Everything else crosses the preload bridge.
2. `clip-ops.js`, `undo-stack.js`, `gap-chips.js` stay pure — they run in
   smokes today and could run in a web/worker context later.
3. `main.js` keeps `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`. Renderer input is validated in main before use.
4. `package.json` defines `scripts.preflight`.

## Data flow

```
Record (renderer MediaRecorder)
  → take dir  Movies/stem-recorder/take-<stamp>/
      screen.mp4 · cam.mp4 · audio.mp3 · manifest.txt
  → edit/manifest.json   clips[] — idempotent edit truth
      { in, out, crop? }  crop = normalized 0–1 rect of the source frame
      cam: { mirror }?    take-level, cam stem only (selfie flip); preview is a
                          CSS scaleX(-1) on the cam preview. Apply is
                          screen-primary today so the flag does not touch
                          final.mp4; when cam enters the export path (Edit-T2
                          PiP), Apply must put `hflip` on the cam input.
  → preview (renderer reads media via file URLs from main; edits are
      model-only: clip-ops + undo-stack mutate clips[] in memory)
  → Apply (separate path: main → ffmpeg-util.applyClips → edit/final.mp4)
```

Preview and Apply never share a code path: preview is model + `<video>`
seeking; Apply is a deterministic ffmpeg render of `clips[]`.

## Caches

- Filmstrip thumbnails: `<take>/edit/.cache/film-<stem>/`
- Audio waveform peaks: `<take>/edit/.cache/audio-peaks.json`
- Apply scratch: `<take>/edit/.work/`

All caches are per-take, regenerable, and keyed on source mtime.

## ASR (transcribe)

- **Local** (default): Hugging Face Whisper via Python
  (`scripts/hf-whisper-transcribe.py`, venv at `.venv-asr/`).
- **Cloud**: `https://asr.traxelio.com/transcribe`.
- Never falls back silently between the two. Outputs in `<take>/edit/`:
  `transcript.txt`, `captions.vtt`, `asr.json`.

## Sequenced (deliberately NOT in this repo yet)

- TypeScript + Vite + monorepo layout (`src/main`, `src/renderer`)
- Moving `main.js` into `src/main/`
- React rewrite of `studio.js`
- Remotion export path · unlinked A/V tracks
- ESLint on `lib/` (architecture check + smokes are the v1 gate)
