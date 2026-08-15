# Agent contract — Stem Studio

## Discovery order

1. `ARCHITECTURE.md` — layers, invariants, what is Sequenced
2. `docs/process/` — method + testing/preflight
3. `README.md` — user-facing flows
4. The code (`lib/` before `renderer/`)

## Layer rules (enforced by `scripts/check-architecture.js`)

- `renderer/` is untrusted UI: no `require('fs'|'child_process'|'electron')`,
  no direct `lib/` imports. New capabilities go: `lib/` helper → IPC handler in
  `main.js` (validate inputs) → narrow method in `preload.js` → renderer call.
- Keep `lib/clip-ops.js`, `lib/undo-stack.js`, `lib/gap-chips.js` pure — no
  electron/fs/child_process. New edit-model logic follows the same rule.
- `main.js` stays thin and keeps `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- ffmpeg / media I/O lives in `lib/ffmpeg-util.js` / `lib/media-cache.js`, not
  in main handlers and never in the renderer.

## Preflight (merge gate)

```bash
npm run preflight   # must exit 0 before any PR
```

Runs the architecture check plus all headless smokes, fail-fast, real exit
codes per step. `smoke:apply` auto-skips unless `STEM_OUT_ROOT` points at real
takes — set it locally for full coverage.

**Standing rule for this repo: a PR that turns preflight green is mergeable;
squash-merge when green.** Don't rewrite `renderer/studio.js` into React/TS or
move `main.js` — those are Sequenced (see ARCHITECTURE.md).

## Git

- Branch per change, PR to `main`, squash-merge. No force-push to `main`,
  no `--no-verify`, no secrets in the repo.
- When adding a smoke, wire it into both `package.json` scripts and
  `scripts/preflight.js`.
