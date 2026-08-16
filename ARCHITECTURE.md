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
      { in, out, crop?, freeze? }  crop = normalized 0–1 rect of the source frame
                          freeze (Edit-T2c) = held-frame segment: `in` is the
                          frozen frame's source time, out - in the hold
                          length, so duration math / trim / undo / clipboard
                          apply unchanged. Inserted after a clip to hold its
                          last frame (VO gaps). Preview parks the video on
                          the frame and advances the playhead by wall clock;
                          Apply input-seeks to the frame and renders
                          trim=end_frame=1 + tpad clone (composes with crop
                          and the cam PiP overlay). Source-time lookups
                          (marks, cues) skip freeze segments.
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
      captions: { burn?, style? }  take-level (Edit-T2d/T2f), opt-in — only
                          burn: true is stored, and only alongside an
                          explicit style: 'karaoke' (any other value,
                          including an unknown string, is the default
                          'segment' and is not stored). Apply resolves the
                          subtitles file through resolveCaptionsPath: style
                          'segment' always burns edit/captions.vtt; style
                          'karaoke' burns a word-level ASS generated into
                          edit/.cache/captions-karaoke.ass from asr.json's
                          words[] (lib/captions.js buildKaraokeAss) — and
                          falls back to captions.vtt when asr.json has no
                          word timings, so a take transcribed before
                          word-level ASR support still burns segment cues.
                          The subtitles filter is appended in the chain
                          after crop, PiP overlay and freeze, and BEFORE the
                          exportRate speed stage (see exportRate below) —
                          the filter reads source-timeline PTS, so burning
                          after a speed change would desync every cue at any
                          rate other than 1. Clips seek output-side, so cues
                          land at their recorded times without re-timing;
                          freeze segments skip the burn (they input-seek and
                          carry silence — no cue belongs there). Burn
                          requested with no caption file resolved, or an
                          ffmpeg built without libass (no subtitles filter)
                          → Apply proceeds without captions and reports the
                          skip; edit/final-no-captions.mp4 (the same render
                          minus the burn) is retained alongside final.mp4
                          whenever the burn succeeds, which costs a second
                          full render pass. Preview shows a cheap DOM cue
                          overlay (same source-time lookup, segment cues
                          only); the transcript panel's double-click cue
                          edit rewrites captions.vtt + transcript.txt (text
                          only, timing untouched).
      exportRate: 1.25     take-level (Edit-T2e), optional — constant export
                          speed, clamped 0.25–4 (1× stored as absent). Apply
                          renders every trimmed clip with setpts=PTS/rate on
                          the video (appended LAST in the filter chain, after
                          the caption burn — the subtitles filter reads
                          source-timeline PTS) and an atempo chain on the
                          audio (factors kept inside atempo's 0.5–2 range),
                          so concat parts already carry the sped timing.
                          Freeze holds are wall-clock, not source ranges, so
                          they scale by 1/rate directly. Preview's Rate
                          select stays a transient playback control; Export
                          is the persisted one.
      music: { path, gainDb }  take-level (Edit-T2e), optional — music bed,
                          picked via a main-process file dialog
                          (studio:chooseMusic). Apply mixes it under the
                          export in a final pass over the concat result
                          (video stream copied): bed ducked to gainDb
                          (default −18 dB, clamped −60–0), looped to cover
                          the export, mix ends with the export
                          (amix duration=first, normalize=0 keeps the
                          dialogue level untouched; video-only exports get
                          the ducked bed as their audio track). The bed is
                          not sped by exportRate — it scores the final
                          timeline. A missing music file skips the bed and
                          reports it, like a missing captions.vtt.
      vertical: true        take-level (Edit-T2f), opt-in — off by default,
                          only the explicit boolean true is stored. Apply
                          passes { vertical: {} } to applyClips, which
                          builds a 1080x1920 preset via
                          export-presets.buildVerticalPreset (crop the
                          source to the target aspect, scale to the target
                          dims, place the cam PiP inside the resulting
                          frame) and renders that instead of the source
                          aspect. Composes with crop, PiP, captions and
                          exportRate — the vertical crop/scale stage runs
                          right after the manual crop, before PiP overlay,
                          caption burn and speed.
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
  `transcript.txt`, `captions.vtt`, `captions.srt` (same cues as the VTT, for
  editors like Premiere/Resolve), `asr.json` (segments plus a `words[]`
  array of word-level `{ word, start, end }` timings when the provider
  returns them).

## Sequenced (deliberately NOT in this repo yet)

- TypeScript + Vite + monorepo layout (`src/main`, `src/renderer`)
- Moving `main.js` into `src/main/`
- React rewrite of `studio.js`
- Remotion export path · unlinked A/V tracks
- ESLint on `lib/` (architecture check + smokes are the v1 gate)
