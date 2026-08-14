# batch-recorder

Cross-platform desktop app that records **screen**, **camera**, and **microphone** as **separate files in one take folder**.

```
Movies/batch-recorder/
  take-2026-08-14T20-03-09/
    screen.webm    # display
    cam.webm       # webcam / Continuity
    audio.webm     # mic
    manifest.txt
```

MIT licensed. Built for founder / creator batch recording (talk over slides, overlay later).

## Why a desktop app?

Browsers (and Cursor’s embedded preview) often:

1. Block `getDisplayMedia` (“Not supported”)
2. Allow **only one** automatic download — so a “triple record” silently drops cam + audio

This Electron shell loads the same UI, enables display capture, and **writes all tracks to disk** via IPC.

## Quick start

```bash
git clone https://github.com/babacarcissedia/batch-recorder.git
cd batch-recorder
npm install
npm start
```

1. Pick camera + mic  
2. Pick screen / window (OS picker)  
3. Hit **Record** → **Stop**  
4. Finder opens the take folder with `screen` · `cam` · `audio`

## ffmpeg CLI fallback

Same machine, no GUI:

```bash
./dual-record.sh list
./dual-record.sh start   # full screen + cam + mic → take folder
./dual-record.sh stop
```

## Stack

| Piece | Role |
|---|---|
| `renderer/index.html` | UI + MediaRecorder |
| `main.js` / `preload.js` | Permissions + write take folder |
| `dual-record.sh` | Optional ffmpeg path |

## License

MIT — see [LICENSE](LICENSE).
