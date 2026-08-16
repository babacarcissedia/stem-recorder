# Stem Studio · patterns from the agentic-SaaS build series — design

**Date:** 2026-08-16
**Source:** Web Dev Cody, *Building a SaaS using Agentic Coding*, parts 1–7 (157 min, transcribed and corrected)
**Status:** approved design · implementation split into three parallel lanes

## Why

Two independent sources point at the same class of defect: an artifact that is wrong while every signal says it succeeded.

- **His:** a 23-second audio track stitched against a 16-second video, because segment counts were guessed from word counts instead of measured. No error, no failed exit — just a truncated video.
- **Ours, measured 2026-08-15:** a transcription run replaced 297 seconds of real speech with the word "Yeah" repeated to the end of the file. Exit 0, every output format written, audio confirmed at normal speech level (mean −24.3 dB). Nothing downstream would have noticed.

Stem's architecture is stricter than his (three enforced layers, a pure edit model, preflight-checked invariants), so most of his *structural* lessons are already satisfied. What Stem lacks is **verification of what it produces** — and a set of caption and repurposing features that his series shows are worth having, one of which he explicitly abandoned as too expensive to build.

## Scope

Three lanes, cut by **file ownership** so they run in parallel without collision. Each lane is internally sequenced, correctness before enhancement.

### Lane A · Apply integrity

**Owns:** `lib/ffmpeg-util.js`, `scripts/smoke-apply.js`

- **A1 · Duration assertion.** After Apply renders, compare the output's real duration against the edit model's expected sum. On mismatch, fail with both numbers rather than leaving a wrong file on disk. Stem's freeze segments, export speed (`atempo`), and PiP composition each give this several ways to drift.
- **A2 · Per-clip render cache.** Key each clip's rendered segment on its parameters plus source mtime; reuse on re-Apply. A1 ships first because it is what makes the cache safe — a cache serving a stale render is the same silent-wrong-artifact failure in a new costume.

### Lane B · ASR trust and providers

**Owns:** `lib/transcribe.js`, `scripts/hf_whisper.py`, `scripts/hf-whisper-transcribe.py`, `scripts/smoke-transcribe.js`

- **B1 · Verify every transcript.** Coverage against source duration, repeated-cue count, and a refusal to write a silently partial result. Report the numbers, never a bare "transcribed".
- **B2 · Word-level timestamps.** `return_timestamps="word"` and persist word timings in `asr.json`. Currently chunk-level only, which blocks Lane C.
- **B3 · Provider registry.** One file per provider under `lib/asr/`, each with a capability descriptor (word timings, languages, relative speed), resolved through a registry instead of inline local/cloud branching. Mocked in smokes so tests never call a real provider.

### Lane C · Captions and repurposing

**Owns:** new `lib/captions.js`, new `lib/export-presets.js`, and their new smokes

All modules are **pure** — no `fs`, no `child_process`, no Electron — matching the existing invariant that keeps `clip-ops.js` and `gap-chips.js` testable in isolation. This is also what lets Lane C proceed against fixture word data without waiting on B2.

- **C1 · Cue chunking.** Word timings → N-word cues, N configurable. Stem currently burns Whisper's 5–9 second segments, which fills the frame with a paragraph.
- **C2 · ASS karaoke captions.** Per-word highlighting via libass `\k` tags generated from word timings, with position and size controls. Cody wanted this and gave up: he built it once with a frame-by-frame HTML5 canvas, found it too slow on CPU, and considered rewriting in Go or Rust or moving to the GPU. Stem already burns captions through libass and, after B2, already has word timings — the expensive part is the part Stem has already paid for.
- **C3 · Vertical 9:16 geometry.** Screen crop/scale plus cam PiP placement as pure math. Stem has no aspect handling at all today; output keeps the source's native ratio. This is what turns one long take into shorts.

### Integration, sequenced last

Wiring Lane C's output into `ffmpeg-util.js`'s subtitles and scale stages. Single owner, after A1 exists to guard it.

## Out of scope (deliberate)

- **Refund caps on metered spend.** His system charges per generated video; Stem's cloud ASR is opt-in and unmetered, so a cap protects nothing.
- **Per-model case-studies folder.** The comparison was run ad hoc on 2026-08-15 and its conclusions are recorded in the Traxelio playbook.
- **Freeze-last-frame for audio gaps.** He invents it in part 2; Stem shipped it as Edit-T2c.
- **Export asset bundle** (plain video + SRT/ASS + transcript, his part 7). Real gap, but it depends on C1–C3 existing first. Revisit after this round.

## Dependencies

| Edge | Nature |
|---|---|
| A1 → A2 | Hard. The assertion guards the cache. |
| B2 → C2 | Data-level, deferred. C2 develops against fixture word data; only integration needs real output. |
| A1 → Integration | Hard. Wiring lands behind the assertion. |

No two lanes write the same file, so A, B, and C run concurrently.

## Verification

Every lane extends its own existing smoke and states a real exit code. Stem's smokes are pure assertion scripts that need no ffmpeg binary and no `node_modules`, so each lane can prove itself in isolation:

```
node scripts/smoke-apply.js       # Lane A
node scripts/smoke-transcribe.js  # Lane B
node scripts/smoke-captions.js    # Lane C (plus new smokes)
npm run preflight                 # architecture invariants, all lanes
```

`npm run preflight` runs `scripts/check-architecture.js`, which enforces the layer rules. Lane C's new modules must pass it as pure `lib/` modules.
