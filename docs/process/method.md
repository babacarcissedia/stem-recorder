# Method (lite)

- **Plan before code** for anything multi-file; trivial fixes go straight in.
- **Respect the layers** — `ARCHITECTURE.md` invariants are enforced, not
  advisory. If a change fights the boundary, the design is wrong, not the check.
- **Smoke-first**: every new `lib/` capability ships with a headless
  `scripts/smoke-*.js` that runs without an Electron window.
- **Preflight before PR**: `npm run preflight` exits 0, then push. Green
  preflight = mergeable (squash-merge).
- **Sequence, don't sneak**: bigger reshapes (TS, src/ move, React, Remotion)
  are listed in ARCHITECTURE.md "Sequenced" and land as their own PRs.
