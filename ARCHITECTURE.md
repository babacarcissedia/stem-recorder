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
      cam: { mirror?, rotate?, pip?, pipLayout? }  take-level, cam stem only. mirror =
                          selfie flip; rotate = clockwise degrees in 90° steps
                          (phone orientation). Preview is a CSS transform on
                          the cam preview — mirror in source space, then the
                          rotation. pip (Edit-T2a) = cam picture-in-picture
                          on Apply; defaults ON when the take has cam.mp4, so
                          only the opt-out (pip: false) is stored.
                          pipLayout (Edit-T2b) = { x, y, w } normalized 0–1 of
                          the output (cropped) frame — PiP top-left + width,
                          height from the cam aspect; absent = the T2a
                          bottom-right ~25% default. Drag the PiP preview to
                          move, corner handle to resize.
  → preview (renderer reads media via file URLs from main; edits are
      model-only: clip-ops + undo-stack mutate clips[] in memory)
  → Apply (separate path: main → ffmpeg-util.applyClips → edit/final.mp4)
      With PiP active, Apply overlays the cam at cam.pipLayout (default
      bottom-right, ~25% of the base width, small margin, aspect kept, the
      overlay x/y expressions clamped on-canvas) via -filter_complex: screen is the
      base (clip crop still applies to it); the cam input gets `hflip`
      (mirror) then `transpose` (90 → transpose=1, 180 → hflip,vflip,
      270 → transpose=2) then scale, then overlay. Both stems share the
      recording timeline, so the clip in/out trim keeps them in sync. No PiP
      when the cam itself is the primary source. Audio behavior is unchanged
      (source audio if present — stems record video-only, audio.mp3 is
      separate).
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
