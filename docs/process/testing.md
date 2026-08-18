# Testing & preflight

## The gate

```bash
npm run preflight
```

Fail-fast, prints a real exit code per step:

| Step | What it proves | Needs |
|---|---|---|
| `typecheck` | legacy TypeScript contract compiles | n/a |
| `typecheck:strict` | strict TypeScript contract compiles | n/a |
| `build` | Electron/Vite bundle builds | n/a |
| `check-architecture` | layer invariants (see ARCHITECTURE.md) | n/a |
| `check-hex-literals` | theme colors do not bypass tokens | n/a |
| `check-style-literals` | style literals stay inside approved seams | n/a |
| `check:arch:self-test` | architecture checker catches its fixtures | n/a |
| `check-theme-parity` | theme token surfaces stay aligned | n/a |
| `check-contrast` | contrast rules stay above the floor | n/a |
| `smoke:model` | project model round-trip and invariants | n/a |
| `smoke:timeline-interaction` | timeline interaction behavior | n/a |
| `smoke:menu` | menu wiring stays available | n/a |
| `smoke:manifest` | V2 manifest read/write/autosave/future-schema guard | n/a |
| `smoke:migrate-v1v2` | V1 manifests migrate to V2 with backup | n/a |
| `smoke:clips` | clip ops + undo stack (pure model) | n/a |
| `smoke:apply-args` | apply argument validation | n/a |
| `smoke:pip` | Edit-T2a cam-PiP filter graph (pure strings) | n/a |
| `smoke:freeze` | freeze-frame model behavior | n/a |
| `smoke:gaps` | gap/retake chip derivation (pure model) | n/a |
| `smoke:thumbs` | filmstrip + waveform cache round-trip | ffmpeg |
| `smoke:transcribe` | VTT parse/build + audio resolution (no Whisper call) | ffmpeg |
| `smoke:captions` | captions model behavior | n/a |
| `smoke:export` | export model behavior | n/a |
| `smoke:captions-karaoke` | karaoke caption behavior | n/a |
| `smoke:export-presets` | export preset behavior | n/a |
| `smoke:export-bundle` | export bundle behavior | n/a |
| `smoke:media-url` | media URL behavior | n/a |
| `smoke:shortcuts` | shortcut contracts, including Split/Delete shell dispatch | n/a |
| `smoke:studio-timecode` | Studio timecode behavior | n/a |
| `smoke:theme` | theme token behavior | n/a |
| `smoke:fonts` | font contract | n/a |
| `smoke:color-range` | color range contract | n/a |
| `smoke:caption-integration` | caption integration behavior | n/a |
| `smoke:apply` | clips → ffmpeg render → `edit/final.mp4` | `STEM_OUT_ROOT` + a take |

`smoke:apply` auto-skips with an OK-skipped line when `STEM_OUT_ROOT` is unset,
so preflight passes on a clean checkout / CI without recorded takes. For full
coverage locally:

```bash
STEM_OUT_ROOT=/tmp/stem-test-takes node scripts/smoke-apply.js take-demo
```

## Conventions

- Smokes are plain Node scripts (`assert`), headless, no Electron window.
- One smoke per capability; extend an existing smoke before adding a new file.
- New smoke => add the `smoke:*` script to `package.json` AND a step in
  `scripts/preflight.js`.
