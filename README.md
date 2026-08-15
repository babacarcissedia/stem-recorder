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
      manifest.json   # clips[] — idempotent edit truth
      final.mp4       # local apply output
```

Phone PWA is parked; this desktop path is the product edit surface for now.

## Quick start (laptop)

```bash
git clone https://github.com/babacarcissedia/stem-recorder.git
cd stem-recorder
git checkout feature/electron-edit-t1-11d7   # until merged
npm install
npm start
```

Requires `ffmpeg` on PATH (`brew install ffmpeg`).

### Record
1. Pick camera + mic  
2. Pick screen / window  
3. **Record** → **Stop** → take folder opens  

### Edit (Edit-T1)

Edit-T1 owns **select · split · cut · trim · reorder · apply** (charter C2). Not T2/T2b.

1. **Library** → pick a take with `screen.mp4`  
2. Click a clip to **select**  
3. Scrub · **Split at playhead** (`S`) · **Cut** selected clip or In→Out range (`Delete`)  
4. Or set **In/Out** seconds → **Set clip from In/Out**  
5. **Save manifest** → `edit/manifest.json`  
6. **Apply locally** → `edit/final.mp4`  

Manifest shape:

```json
{
  "version": 1,
  "takeId": "take-…",
  "source": "screen.mp4",
  "clips": [{ "id": "clip-1", "source": "screen.mp4", "in": 2.0, "out": 6.0 }]
}
```

Legacy spike `keepFrom` / `keepTo` is accepted and normalized to one clip.

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
