# Stem Studio (was Stem Recorder)

Cross-platform **Electron** app: **record** screen / camera / mic as separate stems, then **edit locally** (Edit-T1 timeline → ffmpeg apply).

```
Movies/stem-recorder/
  take-2026-08-14T20-03-09/
    screen.mp4
    cam.mp4
    audio.mp3
    manifest.txt
    edit/
      manifest.json          # schemaVersion 2 project + settings edit truth
      manifest.autosave.json # recovery shadow when autosave is newer
      final.mp4              # local apply output
```

Phone PWA is parked; this desktop path is the product edit surface for now.

Layers and invariants: [ARCHITECTURE.md](ARCHITECTURE.md) · agent contract: [CLAUDE.md](CLAUDE.md).
Merge gate: `npm run preflight` (architecture check + all headless smokes).

## Quick start (laptop)

```bash
git clone https://github.com/babacarcissedia/stem-recorder.git
cd stem-recorder
npm install
npm start
```

Requires `ffmpeg` on PATH (`brew install ffmpeg`).

### Record
1. Pick camera + mic  
2. Pick screen / window  
3. **Record** → **Stop** → take folder opens  

### Edit (Edit-T1)

CapCut / TikTok-style timeline (charter C2): preview on top, **V1 horizontal track**, playhead, toolbar Split / Delete.

1. **Library** → pick a take with `screen.mp4`  
2. Click a segment on the timeline to **select**  
3. Drag the **playhead** · **Split** (`S` / `B`) · **Delete** selected (`Delete`)  
4. Optional: trim selected via In/Out fields  
5. **Save** → `edit/manifest.json` · **Apply** → `edit/final.mp4`  

Shell TimelineFooter **Split** / **Delete** dispatch to the currently open Studio edit, while **Save** remains in the Studio editor.

Manifest shape:

```json
{
  "schemaVersion": 2,
  "takeId": "take-…",
  "project": {
    "schemaVersion": 2,
    "timeline": {},
    "outputs": [],
    "audioRoute": { "activeSourceId": null, "resolvedBy": "auto" }
  },
  "settings": { "source": "screen.mp4" },
  "updatedAt": "2026-08-14T20:03:09.000Z"
}
```

V1 manifests are migrated on read and backed up to `edit/manifest.v1.bak.json`; future schemas are refused instead of overwritten. Autosave recovery uses `edit/manifest.autosave.json` when that shadow file is newer than `edit/manifest.json`.

### Transcribe

Toolbar **Transcribe** with **Local** (default) | **Cloud** provider toggle. Writes
`edit/transcript.txt` · `edit/captions.vtt` · `edit/asr.json` (provider, model,
language, createdAt, sourceFile). Cues show in the Selection panel — click one to
seek the playhead. No burn-in, no translation.

- **Local** — Hugging Face Whisper via Python (`scripts/hf-whisper-transcribe.py`).
  Prefer project venv: `python3 -m venv .venv-asr && .venv-asr/bin/pip install transformers torch` (app looks for `.venv-asr/bin/python`). Model via `STEM_ASR_WHISPER_MODEL`
  (default `openai/whisper-large-v3`; aliases `base`/`small`/`turbo`/… work). The
  pipeline picks MPS or CUDA when available and falls back to CPU — on a CPU-only
  box set `STEM_ASR_WHISPER_MODEL=turbo` or `small`, since large-v3 there runs
  slower than realtime.
- **Cloud** — `POST $STEM_ASR_URL` (default `https://asr.traxelio.com/transcribe`)
  with `Bearer $STEM_ASR_TOKEN`. Never used as a silent fallback — if local deps
  are missing you get a clear error and can switch to Cloud explicitly.

Audio source: prefers `audio.mp3`; else extracts `edit/.asr-audio.mp3` from
`screen.mp4` with ffmpeg. Plumbing smoke: `npm run smoke:transcribe`.

### Headless apply smoke

```bash
STEM_OUT_ROOT=/path/to/takes node scripts/smoke-apply.js take-demo
```

## Formats

| Stem | Output | Notes |
|---|---|---|
| Screen | `screen.mp4` | H.264 |
| Camera | `cam.mp4` | H.264 |
| Mic | `audio.mp3` | 192 kbps MP3 |
| Edit | `edit/final.mp4` | Accurate trim/concat via ffmpeg |

Cloud helpers (optional later): `https://asr.traxelio.com/transcribe` and `/apply` — desktop prefers local ffmpeg.

## License

MIT — see [LICENSE](LICENSE).
