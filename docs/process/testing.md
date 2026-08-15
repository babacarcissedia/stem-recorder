# Testing & preflight

## The gate

```bash
npm run preflight
```

Fail-fast, prints a real exit code per step:

| Step | What it proves | Needs |
|---|---|---|
| `check-architecture` | layer invariants (see ARCHITECTURE.md) | — |
| `smoke:clips` | clip ops + undo stack (pure model) | — |
| `smoke:pip` | Edit-T2a cam-PiP filter graph (pure strings) | — |
| `smoke:gaps` | gap/retake chip derivation (pure model) | — |
| `smoke:thumbs` | filmstrip + waveform cache round-trip | ffmpeg |
| `smoke:transcribe` | VTT parse/build + audio resolution (no Whisper call) | ffmpeg |
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
- New smoke ⇒ add the `smoke:*` script to `package.json` AND a step in
  `scripts/preflight.js`.
