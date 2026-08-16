# Stem Studio — timeline editor plan set (vertical slices)

Companion to `2026-08-16-timeline-editor-design.md`. That document is the design and carries the
corrections to the previous draft. This one is the execution plan.

**Every slice here is vertical**: it carries user-visible value across whatever layers it needs — model,
main process, IPC, React, CSS, test — and merges as one PR that leaves the app running and usable. A
slice named after a layer ("the model exists") is not on this list. The previous draft's S0–S14 was
largely horizontal and has been re-cut.

**S0 is not in this list.** The toolchain slice — electron-vite + TypeScript + a React skeleton, a
rewritten `check-architecture` with self-test fixtures, and a still-working app — is genuinely blocking
and is already dispatched in parallel with this plan. Everything below assumes it has landed and plans on
top of it. The one addition this document asks of it is in §5: `scripts/smoke-export-bundle.js` must be
wired into `package.json` and preflight, because it passes 12 assertions today and is run by nothing.

---

## 1. The slice list

Twenty slices, `V1`–`V20`. Order is dependency order; the parallel sets are in §3.

---

### V1 — Your recordings have sound

**User-visible outcome.** Record in the app, hit Apply, and the export has your voice in it. Today it
does not: an app-recorded take exports silent unless a music bed is added. This is the most severe defect
in the product and it is the first slice for that reason, not for architectural reasons.

**What it does.**
- Cam is recorded muxed with the mic — the only default. Screen stays picture-only. Screen audio is not
  captured. `audio.mp3` continues as the standalone mic file. (R23)
- The mux is composed at the recorder from a **clone of the already-captured mic track**, not by changing
  `getUserMedia` constraints, so the mic is captured once and the capture graph stays single.
  (`renderer/index.html:874-875` already clones every track it is handed.)
- Every source is probed with ffprobe at ingest and its real `hasAudio` recorded. Not assumed from its
  role, not inferred from the recorder's configuration. (R2's predicate)
- `AudioRoute` lands in the manifest with `resolveAudioRoute` implementing the fallback table: prefer
  cam's embedded audio, then any video source with audio, then the standalone mic file, then explicit
  silence. Exactly one source is audible, enforced by `normalize()`. (R21)
- **The export planner maps the routed audio input explicitly** and stops relying on `-map 0:a?` and on
  ffmpeg's default stream selection. This is the half that is not obvious: fixing capture alone leaves the
  export silent, because the default source is `screen.mp4` and it is picture-only. See the design doc
  §1.2.
- The take manifest's `targets=screen.mp4,cam.mp4,audio.mp3` string (`main.js:158`) becomes a list of
  `CaptureInput` descriptors. (R22, capture side)

**Owned paths.** `renderer/index.html` (record view capture graph only) · `main.js` `finalizeStem` and
the take-manifest writer · `lib/ffmpeg-util.js` audio input selection and mapping · `lib/domain/audio-route.ts`
· `lib/domain/source.ts` · `scripts/smoke-audio-route.ts` · `scripts/smoke-apply-args.js` (audio-mapping
assertions only).

**Depends on.** S0 only. It touches almost none of the model.

**What proves it.**
```
node scripts/smoke-audio-route.ts
node scripts/smoke-apply-args.js
npm run preflight
STEM_OUT_ROOT=~/Movies/stem-recorder npm run smoke:apply
```
plus a real recording: record a 20 s take in the app, Apply, and
`ffprobe -show_entries stream=codec_type <take>/final.mp4` reports an audio stream, and the exported file
audibly carries the dialogue. A silent-export regression is exactly what the smoke's argument-vector
assertions pin: the planner must emit an explicit `-map` naming the routed input, never `0:a?`.

**Explicit non-scope.** No UI for choosing the audio source — that control is V10. No waveform rendering
for embedded audio — that is V5. No CFR flag, no loudness normalisation, no music ducking, no WAV/AAC
mic stem (all four are open loops, §6). No timeline model changes beyond `Source` and `AudioRoute`.

**Parallel with.** V2, V3.

---

### V2 — Your edit is a project, and the clock reads in milliseconds

**User-visible outcome.** Opening a take migrates it to a versioned project document, writes a backup of
the old one, and every time readout in the app switches to `mm:ss.mmm`. The playhead time is readable at
all times and no longer collides with the ruler ticks. Apply produces a byte-identical export to the one
it produced before.

This is the thinnest model slice that still ships something a user sees. It is deliberately thin: the
commands, the selection semantics and the React timeline all sit on top of it and each is its own slice.

**What it does.**
- `Ticks`, `Clip`, `Track`, `Timeline`, `Source`, `LinkGroup`, `Marker`, `Selection`, `EffectStack`,
  `Animatable<T>` — the classes with their invariants. (R10)
- Manifest v2, the `schemaVersion` chain, `v1ToV2`, `manifest.v1.bak.json` before any overwrite, and
  `FROM_THE_FUTURE` refusal. (R17, first half)
- `formatTimecode` emitting `mm:ss.mmm`, wired into every existing readout. (A7, R14)
- The playhead clock moves out of the ruler's tick row into its own readout. (A5)
- `start` / `sourceIn` are separate fields, which is the distinction the Selection panel already displays
  as `out … · src …` without the data model having it. (A4)
- No role enum anywhere: `Track.kind` is a media kind, and "screen" / "cam" / "mic" are `Source.label`
  strings. (R22, model side)
- The existing S0-carried timeline UI reads through a v1-compat adapter and behaves identically.

**Owned paths.** `lib/domain/{ticks,timeline,track,clip,selection,link-group,marker,animatable}.ts` ·
`lib/domain/effects/**` · `lib/domain/manifest/**` · `lib/node/edit-manifest.ts` ·
`scripts/smoke-timeline-invariants.ts` · `scripts/smoke-migrate-v1v2.ts` · `scripts/fixtures/v1-manifests/**` ·
the ported assertions from `scripts/smoke-clip-ops.js`.

**Depends on.** S0. Shares `lib/domain/source.ts` with V1 — V1 creates it, V2 extends it, so **V2 rebases
onto V1 rather than running truly concurrently on that one file**. Everything else is disjoint.

**What proves it.**
```
node scripts/smoke-timeline-invariants.ts
node scripts/smoke-migrate-v1v2.ts
npm run preflight
```
`smoke-migrate-v1v2` is the load-bearing one: for each v1 fixture, build the ffmpeg argument vector v1
would produce, migrate, build the vector the v2 planner produces, assert deep equality. Fixtures: one
clip · many clips · a freeze · a crop · cam mirror+rotate+pipLayout · captions karaoke · exportRate ≠ 1 ·
music · vertical · no cam · no audio · **audio only from `audio.mp3`**.

**Explicit non-scope.** No commands, no undo, no React timeline, no theming. Nothing consumes the model
interactively yet. `smoke-clip-ops.js` stays green against the v1-compat shim and is **not** deleted in
this slice — it retires in V7, once the ported assertions and `smoke-migrate-v1v2` are both green.

**Parallel with.** V3. (V1 with a rebase, per above.)

---

### V3 — The app has a shell, a real menu, and discoverable shortcuts

**User-visible outcome.** Four regions — left sidebar, main, right sidebar, footer — with the timeline
docked to the bottom of the viewport and never scrolled to. A real application menu that says "Stem
Studio" instead of "Electron". `Cmd+/` opens a shortcut list. The player shows `current / total`. Status
messages have a home instead of rendering as green text inside the toolbar row.

**What it does.**
- `EditorShell` grid with the four regions; the footer pinned, only the track list scrolling. (R12, S4
  region)
- `PlayerStage` + `TransportControls` with Fit / Ratio / fullscreen and the `current / total` readout.
  (S2, A11, R14 at the player)
- `StatusBar` as a real region. (A2, structural half)
- `TopBar` with project name and dirty indicator. (A12, first half)
- `src/shared/keymap.ts` — the single registry all three surfaces read. (R16)
- `src/main/menu.ts` — `Menu.buildFromTemplate` from that registry, submenus
  `Stem Studio / File / Edit / View / Timeline / Help`. The first submenu carrying the app name is the M1
  fix; `app.setName()` (`main.js:47`) and `productName` (`package.json:3`) are already set and are not
  the problem — on macOS an unpackaged `electron .` reads the bundle `Info.plist`. (M1, M2)
- `ShortcutsDialog`. (A10)
- The atoms/molecules/organisms layering established, one component per file. (R9)
- The existing timeline is hosted **unchanged** inside the footer region.

**Owned paths.** `src/shared/keymap.ts` · `src/main/menu.ts` · `src/renderer/app/**` ·
`src/renderer/components/atoms/**` · `src/renderer/components/molecules/{TransportControls,TimecodeReadout,ShortcutRow}.tsx`
· `TopBar` · `StatusBar` · `ShortcutsDialog` · `PlayerStage` · `scripts/smoke-keymap.ts`.

**Depends on.** S0.

**What proves it.**
```
node scripts/smoke-keymap.ts
npx vitest run src/renderer/app
npm run preflight
npm start
```
`smoke-keymap` asserts no accelerator or bare key is bound twice, every `commandId` resolves, and every
menu label matches its command's label. Manual: the app menu's first submenu reads "Stem Studio" on an
unpackaged run, and the timeline is visible at the bottom of the window at every window height without
scrolling.

**Explicit non-scope.** No timeline internals — the footer hosts the old timeline verbatim. No theming
(V4). No inspector content (V10). No context menus (V11). Menu items that have no command yet are absent
from the registry, not stubbed.

**Parallel with.** V1, V2.

---

### V4 — Light, dark, and system, and everything clickable looks clickable

**User-visible outcome.** A Settings dialog with System / Light / Dark. The choice survives a restart,
the OS flipping theme repaints live, and the window no longer flashes cream before painting dark. Every
interactive surface shows a pointer cursor.

**What it does.**
- Three states, persisted to `app.getPath('userData')/settings.json` — not `localStorage`, because main
  must read it before the window exists. (R7)
- The five-step ordering: read settings → `nativeTheme.themeSource` → `new BrowserWindow({ backgroundColor })`
  replacing the hardcoded `'#f6f4ef'` at `main.js:100` → preload writes `data-theme` at document-start
  from `additionalArguments` → `nativeTheme.on('updated')` pushes live flips.
- `src/shared/tokens.ts` as the single source, generating `src/renderer/styles/tokens.css`. Raw ramp,
  then semantic aliases; components read only aliases.
- Cursor affordance as an enforceable rule — semantic elements plus one base stylesheet rule plus
  `jsx-a11y/no-noninteractive-element-interactions` failing the build when a `div` grows an `onClick`.
  (R8)

**Owned paths.** `src/shared/tokens.ts` · `src/renderer/styles/**` · `src/main/theme.ts` ·
`lib/node/settings-store.ts` · settings IPC · `SettingsDialog` · `.eslintrc` · `scripts/smoke-theme-tokens.ts`.

**Depends on.** V3 — it tokenizes the shell V3 builds. **Runs before V5 deliberately**, so the React
timeline is written against tokens from birth rather than being retro-tokenized.

**What proves it.**
```
node scripts/smoke-theme-tokens.ts
npm run preflight
npm start
```
The gate asserts every semantic alias resolves in all three states, `tokens.css` is byte-identical to
what `tokens.ts` generates, and **zero hex literals anywhere in `src/renderer/**` outside `tokens.css`**.
The last clause matters: `renderer/timeline.css` has 102 hex literals and `renderer/index.html` has 72
more, so a gate scoped to one stylesheet passes with a third of the problem intact. Manual: flip the OS
theme with the app open and watch it repaint; quit and relaunch in dark and watch for a cream flash.

**Explicit non-scope.** No timeline component work. No new colours invented for the timeline — those
aliases are defined here but consumed in V5.

**Parallel with.** Nothing. It owns every stylesheet.

---

### V5 — The React timeline: click anywhere to scrub, real waveforms, per-lane selection

**User-visible outcome.** Click anywhere on a lane and the playhead goes there. Each lane has its own
selection, so clicking a clip on the cam track selects that clip and not an index shared across lanes.
Clips carry a header bar with filename and duration instead of `#1`. Waveforms are real, draw under the
video clip inside the same track, and dragging the timeline no longer rebuilds twenty-one thousand DOM
nodes per pointer move.

This is the biggest slice and the one that cannot share a round with anything else touching the timeline.

**What it does.**
- `TimelineStore` with the version-integer snapshot, `useSyncExternalStore` bindings, and the three
  memoization boundaries. Percent-of-container geometry, so zoom writes one container width and
  re-renders no clip.
- `TrackList` / `Track` / `Clip` / `TimelineRuler` / `PlayheadLayer` / `ChipsRow`, replacing
  `renderTimeline()` and deleting `waveBarsEl`.
- Click-to-scrub on any lane. (R13)
- Per-lane, per-clip selection replacing `selectedIdx`. (R11)
- `stem-media://` protocol with take-directory containment, replacing the `file://` URLs at
  `lib/edit-manifest.js:147`, and yielding a clean 404 for a moved stem.
- `lib/node/waveform-png.ts` — ffmpeg `showwavespic` per source per zoom slice, cached on hash + mtime +
  slice, rendered as a **white-on-transparent mask** coloured by `var(--waveform)` in CSS, so the cache is
  theme-independent.
- Waveform drawn **under the video clip inside the same track**, gated on
  `track.showWaveform && source.hasAudio`. (T2, and R2's presentation)
- Gap chips carried over from `lib/gap-chips.js`, not rebuilt. (A3)
- `ClipHeaderBar` with `filename · duration`. (A6)
- The timeline's own toolbar as a region with zoom slider right-aligned. (S4)

**Owned paths.** `src/renderer/store/**` · `src/renderer/components/timeline/**` ·
`src/renderer/components/molecules/{ClipHeaderBar,GapChip,ZoomSlider}.tsx` · `src/main/protocol.ts` ·
`lib/node/waveform-png.ts` · `lib/node/media-cache.ts` additions · deletion of the old `studio.js`
timeline code · `scripts/smoke-waveform-png.ts` · `src/renderer/components/timeline/__tests__/**`.

**Depends on.** V2 (model), V3 (shell region), V4 (tokens).

**What proves it.**
```
node scripts/smoke-waveform-png.ts
npx vitest run src/renderer/components/timeline
npm run preflight
npm start
```
Vitest assertions, and these are the point of the slice: N clips render N memoized `Clip` elements · a
synthetic drag over 200 `pointermove` events produces **zero** React renders, asserted with a render
counter, and one dispatch on `pointerup` · a zoom change writes one container width and re-renders no
clip. `smoke-waveform-png` asserts deterministic PNG dimensions per zoom slice, a cache keyed on
hash + mtime + slice, a single-channel mask, `stem-media://` refusing a path outside the take dir, and a
missing file 404ing cleanly. Manual: the real 580.6 s take scrubs and drags smoothly.

**Explicit non-scope.** No move, no trim, no drag-to-reposition (V6). No split, join or delete (V7). No
track header controls (V8). No inspector (V10). No context menus (V11). Selection is click and
shift-click on a lane; marquee is V6.

**Parallel with.** Nothing. It owns `src/renderer/components/timeline/**` outright.

---

### V6 — Move a clip between tracks, and watch the neighbours make room

**User-visible outcome.** Drag a clip left, right, or onto another track, and it goes there. Drop it on
top of something and the neighbour slides out of the way with a dropzone animation showing exactly where
everything will land before you release. Trim a clip by its edge. Everything snaps to the playhead, clip
edges and markers, with `N` held during a drag inverting snapping momentarily. Undo takes back the whole
gesture in one step, across every track it touched.

**What it does.**
- The `Command` interface, `check`/`apply`, `TimelineStore.dispatch`, and the snapshot undo ring — the
  command infrastructure, made vertical by shipping Move and Trim on top of it.
- `Move` with the push plan: expand through link groups → plan the move → plan the cascading right-shifts
  → validate the whole plan → snapshot once → apply → normalize → one undo entry. Collisions **push**;
  `WOULD_OVERWRITE` does not exist. (R4)
- `Trim` on `pointerup`, with a grow-into-neighbour pushing by the same rule.
- Atomic linked move across however many tracks the group spans — never "three".
- `useClipDrag` writing the dragged element's ref, its linked siblings' refs, and the refs of every
  pushed clip, per frame, with zero React renders. `Escape` restores and dispatches nothing.
- `SelectionMarquee` and multi-select.
- Snapping with ~8 px→ticks threshold and ~14 px break-out hysteresis, applied to the plan's reference
  member and propagated as one delta so a locked group cannot desync.

**Owned paths.** `lib/domain/commands/{index,move,trim,select}.ts` · `lib/domain/undo.ts` ·
`src/renderer/store/selection.ts` · `src/renderer/hooks/useClipDrag.ts` · `SelectionMarquee` ·
`scripts/smoke-commands.ts` · `scripts/smoke-linked-move.ts` · `scripts/smoke-push-plan.ts` ·
`scripts/smoke-undo.ts`.

**Depends on.** V5.

**What proves it.**
```
node scripts/smoke-commands.ts
node scripts/smoke-linked-move.ts
node scripts/smoke-push-plan.ts
node scripts/smoke-undo.ts
npx vitest run src/renderer/hooks
npm run preflight
```
`smoke-push-plan` is the new one and carries the C3 decision: a drop onto an occupied span produces a
plan that shifts the occupant and every clip after it right by exactly the overlap, cascading forward
only, never left, never across a track boundary, and never producing a negative start. `smoke-linked-move`
asserts a linked move across N tracks is one undo entry and is all-or-nothing when one member would end
up negative.

**Explicit non-scope.** No split, join or ripple delete (V7). No modal trim tools — there is one drag
behaviour and that is the design. No overwrite variant of Move, ever.

**Parallel with.** Nothing (it owns the drag hook and the selection store, which V7 reads).

---

### V7 — Split, join and delete, on what you selected

**User-visible outcome.** `Cmd+B` splits the clips you selected, not "the" clip under the playhead.
`Cmd+Shift+B` joins adjacent clips — always available, never greyed. `Delete` removes and closes the gap;
`Shift+Delete` removes and leaves it. Every one of these is one undo step.

**What it does.**
- `Split` acting on the selection and on every linked sibling, falling back to the playhead when the
  selection is empty. (R15)
- `Join`, **permissive**: a true merge when every adjacent pair is a genuine through-edit, a same-track
  `kind: 'join'` group otherwise. Always available. The result is reported so the UI can say which
  happened. `NOT_ADJACENT` is the only source-related rejection left; `DIFFERENT_SOURCE`,
  `NOT_A_THROUGH_EDIT` and `EFFECTS_DIFFER` are retired. (R5)
- `RippleDelete` and `Lift`, with ripple closing the gap on every track the deleted span touches, expanded
  through locked link groups, and remapping markers in the same pass.
- `rippleDelete` takes `{ refs } | { ranges }` and resolves the union before touching anything — batch
  capability is a hard requirement, not an optimisation, because transcript-driven cutting (V18) is
  hundreds of deletes and must be one undo entry.
- `Group` / `Ungroup`, `Move into sync`, `Slip into sync`, `Add marker`, `Toggle clip enabled`.
- The timeline toolbar's verbs, reading `check()` for enablement.
- **`scripts/smoke-clip-ops.js` retires here**, once its 110 ported assertions and `smoke-migrate-v1v2`
  are both green. Ported first, deleted second, in that order, in this PR.

**Owned paths.** `lib/domain/commands/{split,join,delete,group,sync,marker,enabled}.ts` ·
`src/renderer/components/timeline/TimelineToolbar.tsx` · `scripts/smoke-commands.ts` (extended) ·
deletion of `scripts/smoke-clip-ops.js` and `lib/clip-ops.js`.

**Depends on.** V6.

**What proves it.**
```
node scripts/smoke-commands.ts
node scripts/smoke-undo.ts
node scripts/smoke-migrate-v1v2.ts
npm run preflight
```
One test per rejection code. Split with three clips selected produces six. A join of two clips from
non-contiguous source ranges succeeds and produces a group, and the command is enabled in every case
where the clips are adjacent. A batch ripple delete of 200 ranges is one undo entry. Markers survive a
ripple with correct positions. Before deleting `smoke-clip-ops.js`, its assertion count on the class API
is shown to be ≥ 110.

**Explicit non-scope.** No context menus (V11). No transcript-driven cutting (V18) — this slice ships the
batch call, not the caller. No export commands (V12).

**Parallel with.** V8, V9.

---

### V8 — Track headers that do something

**User-visible outcome.** Each track header carries lock, hide, mute and an overflow menu, and they work.
Shift-click applies to all tracks, alt-click isolates. Add a track and remove a track. Mute and hide are
monitor-only and provably do not change what an export contains.

**What it does.**
- `TrackHeader` + `TrackHeaderControls` replacing today's stub lock/eye icons. (T1)
- Per-track `muted` / `hidden` / `locked` / `heightPx` / `showWaveform` / `gainDb` in the store and the
  manifest.
- `Add track` / `Remove track` commands and their UI. (R3, the track half)
- **Solo, if it ships, is monitor-only** — it affects preview, never export. A soloed track silently
  producing a one-track export is unrecoverable after upload.

**Owned paths.** `src/renderer/components/timeline/{TrackHeader,TrackHeaderControls}.tsx` ·
per-track state in `src/renderer/store/tracks.ts` · `lib/domain/commands/{addTrack,removeTrack,trackFlags}.ts`.

**Depends on.** V6 (commands infrastructure), V5 (timeline components).

**What proves it.**
```
node scripts/smoke-commands.ts
npx vitest run src/renderer/components/timeline
npm run preflight
```
The load-bearing assertion: with a track muted and another hidden, the export planner's argument vector
is **byte-identical** to the vector with neither flag set. Monitor-only is a claim about the render path,
so it is asserted against the render path.

**Explicit non-scope.** No media import (V9) — this slice adds empty tracks. No per-track gain UI beyond
the field (that is V10's Audio tab).

**Parallel with.** V7, V9.

---

### V9 — Add a track and attach any media from anywhere

**User-visible outcome.** Pick any file on disk — music, b-roll, an image — and it appears as a clip on a
new track. The file is copied into the take folder, so the take stays a self-contained bundle you can
move or archive without breaking it. The left sidebar shows every source with a thumbnail and duration,
marks the ones already on the timeline with an "Added" badge, and shows a red "Media lost" tile for a
file that has gone missing instead of failing.

**What it does.**
- `media.importFile` — a main-process file dialog that **copies** the file into the take directory, probes
  it with ffprobe, and registers a `Source` with `origin: 'import'` and its real `hasAudio`. (R3)
- `Import media` command placing a clip on a new track. Also the `Extract audio` entry point, which is the
  same mechanism from a different door: extract creates an audio track from a video source's embedded
  stream. Available today for every take on disk with a cam stem.
- `MediaPanel` + `MediaTile` with thumbnail, duration, `Added` badge. (S1)
- `present: false` handling end to end: a missing stem renders as a "Media lost" tile, and every command
  touching a clip on an absent source returns `Err('SOURCE_MISSING')` rather than throwing. (A9)

**Owned paths.** `src/main/ipc/media.ts` · `lib/node/import-media.ts` ·
`lib/domain/commands/{importMedia,extractAudio}.ts` · `src/renderer/components/organisms/MediaPanel.tsx` ·
`src/renderer/components/molecules/MediaTile.tsx` · `scripts/smoke-import-media.ts`.

**Depends on.** V8 (add track), V2 (Source model), V3 (left sidebar region).

**What proves it.**
```
node scripts/smoke-import-media.ts
npm run preflight
npm start
```
Import a file from outside the take folder and assert: the file now exists inside the take directory ·
the manifest's `Source.path` is **relative** · moving the whole take folder to a new location and
reopening it resolves every source · deleting an imported file and reopening yields `present: false` and
a "Media lost" tile rather than an exception.

**Explicit non-scope.** No reference-instead-of-copy option — copy is the decision, and reference breaks
the movable-bundle property. No relinking / "Link to media" UI, refused under X4.

**Parallel with.** V7, V8.

---

### V10 — The inspector, and a toolbar that fits

**User-visible outcome.** Crop, mirror, rotate, PiP, speed, music, captions and audio-source selection
move off the toolbar into a tabbed right-hand inspector. The 23 always-visible toolbar controls become
three small groups. Status messages render in the status bar instead of as green text inside a toolbar
row. The duplicate waveform block in the Selection sidebar is gone, its zoom −/+ have moved to the
timeline toolbar, its segment list is replaced by the per-track lanes, and its In/Out numeric fields
survive in the inspector's Range section.

**What it does.**
- `InspectorPanel` with tabs `Position & Size` / `Speed` / `Audio` / `Captions` / `Outputs`. (S3)
- The toolbar split into app toolbar (save, apply, export bundle, transcribe), timeline toolbar (split,
  join, delete, snap, zoom) and inspector. `More ▾` retired. (A1)
- `StatusBar` content, with the PiP hint and every other transient message routed there. (A2)
- The Selection sidebar's AUDIO WAVE block removed and its parts relocated, not merely deleted. (R1)
- The Audio tab's source picker — one row per source with audio, exactly one active, dispatching
  `Set audio source`. This is R21's "simple way for us to exclude by removing on the project": there is
  one field holding one id, so choosing one deactivates the others by construction.

**Owned paths.** `src/renderer/components/organisms/{InspectorPanel,StatusBar}.tsx` ·
`src/renderer/components/inspector/**` · `src/renderer/components/molecules/{InspectorField,AudioSourceRow}.tsx` ·
the app-toolbar organism.

**Depends on.** V5, V3, V1 (`AudioRoute`), V8 (per-track gain).

**What proves it.**
```
npx vitest run src/renderer/components/inspector
npm run preflight
npm start
```
Assert the toolbar renders at most 8 always-visible controls; that setting the audio source to one file
sets `audioRoute.activeSourceId` and leaves exactly one source active; and that a status message
dispatched from any surface lands in the status bar and nowhere else. Manual: the Edit view's toolbar
fits in one row at 1320 px, the app's minimum width.

**Explicit non-scope.** Per-clip crop is **not** offered — the export planner still throws on non-uniform
crops (`lib/ffmpeg-util.js:435-439`) until V12. The inspector applies crop to the whole selection and the
planner returns `Err('MIXED_EFFECTS')` if it ever sees a mixed take. Do not ship a UI the renderer cannot
honour.

**Parallel with.** V11.

---

### V11 — Right-click anything

**User-visible outcome.** Right-click a clip, several clips, a track header, a gap or empty timeline and
get a menu appropriate to what you hit. Unavailable verbs are greyed with a reason rather than hidden,
and each shows its keyboard shortcut inline. A verb disabled in the toolbar is disabled in the menu and
in the application menu, with the same words.

**What it does.**
- Four context-menu organisms selected by hit target and selection. (X1)
- Every item's enablement and tooltip read from the same `check()` the toolbar reads, and its label from
  the same `Command.label`. (X2)
- The clip menu's take: Copy · Cut · Paste · Copy attributes · Paste attributes · Split · Join · Delete ·
  Lift · Group / Ungroup · Move into sync · Slip into sync · Extract audio · Use as audio source ·
  Transcript · Deactivate clip · Export selected clips · Open file location. (X3)
- The refusals, which are load-bearing: no scene detection, no compound clips or multi-camera, no save
  preset, no effects editor, no Render submenu, no relinking, no trim-and-replace. (X4)
- Greyed-not-hidden, with inline accelerators. (A8)
- `ui.setCommandEnablement` pushed to main on store-version change, so the application menu agrees.

**Owned paths.** `src/renderer/components/menus/**` · `src/main/ipc/ui.ts` enablement channel ·
`scripts/smoke-command-surfaces.ts`.

**Depends on.** V7 (the commands to grey), V3 (keymap registry), V10 (toolbar).

**What proves it.**
```
node scripts/smoke-command-surfaces.ts
npx vitest run src/renderer/components/menus
npm run preflight
```
One assertion over all three surfaces: for every command and a matrix of contexts, the toolbar's
`disabled`, the context menu item's `disabled`, and the enablement map pushed to main are equal, and the
three labels are identical strings. That is X2 proven mechanically rather than by inspection.

**Explicit non-scope.** No new commands — every item in every menu already exists by V7.

**Parallel with.** V10.

---

### V12 — Export exactly the clips you selected

**User-visible outcome.** Select clips, hit `Cmd+E`, get exactly those clips as files — frame-accurate,
not snapped to the nearest keyframe. Or set an in/out range and export that. If a locked group has drifted
more than a frame, the export refuses until you confirm, because lipsync error is invisible in the editor
and unforgivable after upload.

**What it does.**
- `Export selected clips` and `Export range` as two distinct commands, never one overloaded verb. (R6)
- **Always re-encode.** There is no fast path and no "(fast)"/"(exact)" pair. `ffmpeg -c copy` cuts only
  on keyframes, so a 12.4 s request can silently yield 10.0 s; and burned captions or PiP force a
  re-encode on nearly every export anyway.
- The uniform-crop restriction at `lib/ffmpeg-util.js:435-439` lifted, with per-clip filter chains grouped
  by `EffectStack.signature()`. This is what unblocks per-clip crop in the inspector.
- The drift guard: `Err('UNRESOLVED_DRIFT')` for a locked group drifting > 33 ms without `confirmed: true`.

**Owned paths.** `lib/node/ffmpeg-util.ts` · `lib/domain/commands/{exportSelection,exportRange}.ts` ·
`src/main/ipc/render.ts` · `scripts/smoke-apply-args.js` (mixed-effect fixtures) ·
`scripts/smoke-export.ts`.

**Depends on.** V7, V2.

**What proves it.**
```
node scripts/smoke-apply-args.js
node scripts/smoke-export.ts
STEM_OUT_ROOT=~/Movies/stem-recorder npm run smoke:apply
npm run preflight
```
Argument-vector assertions for mixed-effect fixtures. A real export of a 12.4 s selection probes to
12.4 s ± the existing duration tolerance — that is the assertion that would have caught the keyframe trap
had a fast path shipped. An export with unresolved drift refuses without a confirm flag and succeeds with
one.

**Explicit non-scope.** No multiple outputs (V13). No export queue, no per-destination presets, no
VideoToolbox.

**Parallel with.** V15, V16.

---

### V13 — One edit, two shapes

**User-visible outcome.** Apply once and get both the horizontal and the vertical file. Vertical is not a
checkbox on a render; it is one of a list of output targets, and adding a third costs nothing.

**What it does.**
- `render.vertical: boolean` becomes `outputs: OutputTarget[]`. This is the one place the previous draft
  hardcoded the shape R22 forbids. (R19, R22)
- `render.apply(takeId, outputIds)` — one call, M renders.
- The v1 migration produces a two-entry `outputs` array whose `9:16` target's default framing reproduces
  exactly what `verticalCropScaleFilter` produces today, so a migrated take exports byte-identically.
- `Add output` / `Remove output` in the inspector's Outputs tab, with `LAST_OUTPUT` refused.

**Owned paths.** `lib/domain/output-target.ts` · `lib/domain/commands/outputs.ts` ·
`lib/node/ffmpeg-util.ts` output loop · `src/renderer/components/inspector/OutputsTab.tsx` ·
`scripts/smoke-outputs.ts` · `scripts/smoke-migrate-v1v2.ts` (extended).

**Depends on.** V12, V10.

**What proves it.**
```
node scripts/smoke-outputs.ts
node scripts/smoke-migrate-v1v2.ts
STEM_OUT_ROOT=~/Movies/stem-recorder npm run smoke:apply
npm run preflight
```
The migration assertion is the strong one: a v1 take with `vertical: true` migrates to a two-entry
`outputs` array and the argument vector for its `9:16` output is deep-equal to the vector v1 produced.
And Apply on a two-output project writes two files with the expected dimensions.

**Explicit non-scope.** No framing UI (V14) — this slice ships the model and the render loop, with
framing as a constant.

**Parallel with.** V15, V17.

---

### V14 — Frame the vertical crop by eye, on the preview

**User-visible outcome.** A 9:16 rectangle drawn over the 16:9 preview, draggable, so you position the
vertical crop while you edit instead of discovering it was wrong after the export. Rule-of-thirds and
safe-area guides underneath it.

**What it does.**
- `FramingOverlay` — an SVG layer absolutely positioned over the preview, recalculated on resize,
  structurally separate from every render path so it cannot leak into output. (R20)
- One draggable rectangle per enabled `OutputTarget` whose aspect differs from the canvas; dragging writes
  `framing` through `Set output framing`.
- Passive guides: rule of thirds inside the active target, and safe areas at **93% action / 90% title**
  (SMPTE ST 2046-1:2009 / EBU R95 rev 1.1, which supersede RP 218's deprecated 90/80 — those were sized
  for CRT overscan). Social UI-safe zones as a *variant* of the 9:16 guide, with copy labelling their
  numbers approximate, because published figures for the same platform disagree by 10–20%.
- Line-only, never dimming. White line with a dark outline. Multiple guides differentiated by colour **or**
  opacity, not both. At most two or three visible guide types.
- **Not a track and not a renderable layer.** That is CapCut's anti-pattern — its safe-zone guide is an
  overlay track the user must remember to delete before exporting.

**Owned paths.** `src/renderer/components/organisms/FramingOverlay.tsx` ·
`src/renderer/components/guides/**` · `src/renderer/hooks/useFramingDrag.ts` ·
`src/renderer/components/organisms/__tests__/FramingOverlay.test.tsx`.

**Depends on.** V13, V5.

**What proves it.**
```
npx vitest run src/renderer/components/organisms
node scripts/smoke-apply-args.js
npm run preflight
npm start
```
The assertion that matters: with the framing overlay visible and every guide enabled, the export planner's
argument vector is **byte-identical** to the vector with the overlay hidden. Guides that cannot leak into
output is a claim about the render path, so it is asserted there. Plus: dragging the 9:16 rectangle to a
known position writes the expected normalized rect, and the rendered vertical output is cropped at that
position.

**Explicit non-scope.** No auto-reframe, no speaker tracking. The founder is one static speaker and a
fixed crop takes ten seconds.

**Parallel with.** V17, V18.

---

### V15 — It saves itself, and it comes back after a crash

**User-visible outcome.** The top bar shows the project name and "Auto saved: 13:17:07". Kill the app
mid-edit and reopen: it offers the newer autosave.

**What it does.**
- Autosave on an interval to `edit/manifest.autosave.json`, never over `manifest.json`. (S5)
- Atomic save of `manifest.json` — temp file, rename.
- Dirty state in the store, shown in the top bar. (A12)
- `edit/session.json` for view state (selection, playhead, track heights) — deliberately not in the
  manifest, so a project opened elsewhere does not fail on a missing track height.
- Recovery prompt on open when an autosave is newer. (R17, completing)

**Owned paths.** `src/renderer/store/autosave.ts` · `lib/node/session-store.ts` ·
`src/renderer/components/organisms/RecoveryDialog.tsx` · `TopBar` autosave stamp ·
`scripts/smoke-autosave-recovery.ts`.

**Depends on.** V2, V3.

**What proves it.**
```
node scripts/smoke-autosave-recovery.ts
npm run preflight
npm start
```
The load-bearing case is **"previously saved, then crashed"**, not "never saved" — the second is the one
everyone tests and the first is the one that costs real time. The smoke constructs both fixtures and
asserts the recovery offer appears for the first and that accepting it restores the autosave while
declining it leaves `manifest.json` untouched.

**Explicit non-scope.** No version history, no branching saves.

**Parallel with.** V12, V13, V16.

---

### V16 — Capture the cursor while you still can

**User-visible outcome.** Nothing, yet. That is the point: the data is retroactive-hostile, so every
recording made without it is permanently ineligible for auto-zoom, click highlighting and cursor
smoothing. This slice records it so the feature is possible later.

**What it does.**
- A cursor and click event stream written as a fourth stem, `cursor.json`, during screen capture.
- Registered as a `CaptureInput` with `media` of its own kind, so R22's "N inputs" holds for a non-media
  input too.

**Owned paths.** `renderer/index.html` record view cursor listener · `main.js` cursor sidecar writer ·
`lib/node/cursor-sidecar.ts` · `scripts/smoke-cursor-sidecar.ts`.

**Depends on.** V1 (it shares the record path — V16 rebases onto V1, it does not run concurrently with it).

**What proves it.**
```
node scripts/smoke-cursor-sidecar.ts
npm run preflight
```
Record a 10 s take with deliberate clicks; assert `cursor.json` exists, its timestamps are monotonic and
inside `[0, duration]`, and every recorded click has a position.

**Explicit non-scope.** No zoom, no click highlight, no cursor smoothing, no keystroke display. This slice
is the data and nothing else.

**Parallel with.** V12, V13, V15 (all after V1).

---

### V17 — Auto-zoom

**User-visible outcome.** A recording with the cursor sidecar gets zoom keyframes generated from click
events, animated in the export.

**What it does.** The `zoom` effect's `Animatable<Rect>` params driven by a generator over `cursor.json`,
plus the ffmpeg render path for a crop rect that changes over time.

**Owned paths.** `lib/domain/auto-zoom.ts` · `lib/node/ffmpeg-util.ts` zoom filter chain ·
`scripts/smoke-auto-zoom.ts`.

**Depends on.** V16, V12.

**Blocked on a spec.** The **render** side is genuinely unspecified: animating a crop rect in ffmpeg
(`zoompan`, or `crop` with time expressions) is real design work. The model side is settled. This slice
does not start until that short spec exists.

**What proves it.**
```
node scripts/smoke-auto-zoom.ts
STEM_OUT_ROOT=~/Movies/stem-recorder npm run smoke:apply
```

**Explicit non-scope.** No manual zoom keyframe UI.

**Parallel with.** V14, V18.

---

### V18 — Delete the silence and the filler words

**User-visible outcome.** One action removes every silent gap and every filler word from a talk, as one
undoable step. Whisper word timings already exist in `asr.json`; nothing new is computed.

**What it does.** Silence and filler detection over the existing word timings, French included (`euh`,
`bah`, `du coup`), producing a range list handed to the **batch** `rippleDelete` from V7 — one command
call, one undo entry, never a UI loop.

**Owned paths.** `lib/domain/transcript-cut.ts` · `src/renderer/components/inspector/TranscriptTab.tsx` ·
`scripts/smoke-transcript-cut.ts`.

**Depends on.** V7 (batch ripple), V10 (inspector).

**What proves it.**
```
node scripts/smoke-transcript-cut.ts
node scripts/smoke-undo.ts
npm run preflight
```
A fixture transcript with 200 fillers produces one undo entry, and undoing it restores the timeline
exactly.

**Explicit non-scope.** No transcript-as-document editing surface (delete text → delete video) — that is
its own slice and its own UI.

**Parallel with.** V14, V17.

---

### V19 — Overlays (R18) — DEFERRED, unknown named

**Not schedulable.** The founder asked for overlays on video and asked for research; that research is
outstanding. No scope is invented here.

**The named unknowns**, each of which changes the slice by an order of magnitude:

1. **Which primitives** — text, logo/watermark, shapes, lower-thirds, images. A watermark is one ffmpeg
   `overlay` filter. Editable text with per-character timing is a vector-editing surface with its own
   selection model, undo interactions and render path.
2. **Timeline objects or clip effects.** As `Effect` entries they inherit the existing stack, undo and
   signature machinery for free. As their own track type they can outlive a clip and span an edit, which
   is what a lower-third usually wants.
3. **Per-output or not.** A watermark positioned for 16:9 is in the wrong place in 9:16, so overlays
   interact with V13 and V14 directly.

**What is already safe.** Nothing in V1–V18 forecloses either answer: an overlay as an `Effect` variant
needs no schema change, and an overlay track needs one `Track.kind` value.

**Next action.** Research dispatch, then a spec, then a slice. Not before.

---

### V20 — Documentation reconciliation

**User-visible outcome.** `ARCHITECTURE.md` and `CLAUDE.md` describe the app that exists.

**What it does.**
- `ARCHITECTURE.md:180-185` — the "Sequenced (deliberately NOT in this repo yet)" section listing
  TypeScript, Vite, `src/main` and a React rewrite of `studio.js` — is **replaced, not quietly
  overridden**. It is now the active plan.
- `ARCHITECTURE.md:35` — "renderer never requires … `lib/*`" — replaced by the restated layer invariant.
  It has been false in practice since `renderer/index.html:1090-1092` landed.
- `ARCHITECTURE.md`'s ASR outputs list gains `captions.srt` (ledger H1).
- `CLAUDE.md`'s standing rule "Don't rewrite `renderer/studio.js` into React/TS or move `main.js`" is
  withdrawn.

Each slice folds its own share of the docs into its own PR; V20 is the final reconciliation pass, not the
only documentation work.

**Owned paths.** `ARCHITECTURE.md` · `CLAUDE.md` · `README.md`.

**Depends on.** Everything it documents.

**What proves it.** `npm run preflight`, plus a read-through against the merged tree. A doc that
confidently describes a mechanism is the most common place a broken mechanism hides, because nobody
re-checks what is written down.

---

## 2. Dependency graph

```
S0 (in flight, blocking)
├── V1  audio ──────────────┬── V16 cursor sidecar
├── V2  model ──────────────┤
└── V3  shell ── V4 theme ──┴── V5 timeline ── V6 move ── V7 split/join/delete ─┬── V11 menus
                                     │                          │              │
                                     │                          ├── V8 headers │
                                     │                          ├── V9 import  │
                                     │                          └── V10 inspector
                                     │                                    │
                                     └── V15 autosave                     └── V12 export ── V13 outputs ── V14 framing
                                                                                    V17 auto-zoom (needs V16)
                                                                                    V18 transcript cut (needs V7 + V10)
                                     V19 overlays — DEFERRED, unknown named
                                     V20 docs — last
```

V2 and V16 both touch a file V1 owns (`lib/domain/source.ts` and the record path respectively), so both
**rebase onto V1** rather than running truly concurrently with it. That is a sequencing note, not a
dependency on V1's behaviour.

## 3. Parallel sets, in order

| Round | Slices | Why they are safe together |
|---|---|---|
| 0 | S0 | blocking, solo, already dispatched |
| 1 | **V1 · V2 · V3** | V1 owns the record path and ffmpeg audio mapping; V2 owns `lib/domain/**` and the manifest; V3 owns the shell, menu and keymap. Only `lib/domain/source.ts` is shared, and V2 rebases onto V1 for it |
| 2 | **V4** | solo — it owns every stylesheet, and running it before V5 means the timeline is written against tokens from birth |
| 3 | **V5** | solo — it owns `src/renderer/components/timeline/**` outright and deletes the old timeline code |
| 4 | **V6** | solo — it owns the drag hook and selection store that V7, V8 and V9 all read |
| 5 | **V7 · V8 · V9** | V7 owns `lib/domain/commands/{split,join,delete,…}` and the timeline toolbar; V8 owns the track header components and per-track state; V9 owns the media panel and the import IPC. Disjoint |
| 6 | **V10 · V11 · V15 · V16** | V10 owns the inspector and app toolbar; V11 owns `components/menus/**`; V15 owns autosave and the top-bar stamp; V16 owns the record path (rebased onto V1). Disjoint |
| 7 | **V12** | solo — it owns `lib/node/ffmpeg-util.ts`, which V13 then extends |
| 8 | **V13 · V18** | V13 owns the output model and the render loop; V18 owns transcript cutting. Disjoint |
| 9 | **V14 · V17** | V14 owns the framing overlay; V17 owns the zoom render path. V17 additionally needs its render spec written first |
| 10 | **V20** | last |
| — | **V19** | not schedulable — research outstanding |

**Every round leaves the app running and usable.** After round 1 the app records with sound, opens
projects in the new format and has a menu. After round 3 the timeline is React and fast. After round 5
you can edit. Nothing is half-migrated at a merge boundary, because no slice is a layer.

## 4. Coverage matrix

Every requirement id from `ledger-n0-timeline.md` — R1–R23, M1–M2, X1–X4, T1–T2, S1–S5, A1–A12 — mapped
to the slice that delivers it. Where two slices contribute, the **primary** is bold.

| Id | Requirement | Slice |
|---|---|---|
| R1 | Remove the duplicate waveform in the Selection sidebar | **V10** (relocated, not merely deleted) |
| R2 | Waveforms for audio embedded in video tracks | V1 (probe `hasAudio`) · **V5** (draw it) |
| R3 | Add a track, attach any media from anywhere | V8 (add track) · **V9** (import, copy-in) |
| R4 | Move a segment left/right and between tracks | **V6** |
| R5 | Merge / unsplit adjacent segments | **V7** (permissive join) |
| R6 | Export a selected segment or group of segments | **V12** |
| R7 | Light + dark mode from a settings menu | **V4** (three states: System/Light/Dark) |
| R8 | Cursor pointer on every clickable surface | **V4** (rule + lint, not a sweep) |
| R9 | Component + atomic design | **V3** (layering established) · V5 · V10 |
| R10 | Object-oriented model | **V2** |
| R11 | Per-lane selection | **V5** (fixed by the model change, not separately) |
| R12 | App shell layout — left / main / right / footer | **V3** |
| R13 | Click anywhere on the timeline moves the playhead | **V5** |
| R14 | Timeline always shows the current clock time | **V2** (format) · V3 (player readout) · V5 (timeline clock) |
| R15 | Split acts on the selected segments | **V7** |
| R16 | Keyboard bindings and shortcuts | **V3** (registry, menu, dialog) |
| R17 | The edit is a resumable project artifact | V2 (the document) · **V15** (autosave, recovery, session) |
| R18 | Overlays on video | **V19 — DEFERRED. Scope unresolved, research outstanding** |
| R19 | Multiple outputs from one finished edit | **V13** |
| R20 | Per-output framing control on the preview | **V14** |
| R21 | Audio source selection, exclude the redundant stem | **V1** (route + planner) · V10 (the control) |
| R22 | Do not hardcode the three-stem shape | V1 (capture inputs) · **V2** (model) · V13 (outputs) |
| R23 | Capture defaults — cam muxed with mic, screen picture-only | **V1** |
| M1 | Top bar shows "Electron" | **V3** (custom menu template's first submenu) |
| M2 | There is no application menu at all | **V3** |
| X1 | Context menu contents depend on selection | **V11** |
| X2 | Context menu agrees with toolbar and keymap | **V11** (one `check()`, one `label`, asserted across all three) |
| X3 | Clip context menu — take | **V11** |
| X4 | Clip context menu — refuse | **V11** |
| T1 | Per-track lock, hide, mute, overflow | **V8** |
| T2 | Waveform under the video clip in the same track | **V5** |
| S1 | Left sidebar — media / stems panel | V3 (region) · **V9** (content, Added badge, Media lost) |
| S2 | Main — player with `current / total` | **V3** |
| S3 | Right sidebar — tabbed inspector | **V10** |
| S4 | Footer — timeline with its own toolbar | V3 (region) · **V5** (ruler, tracks, zoom) · V7 (verbs) |
| S5 | Auto-save with a visible timestamp | **V15** |
| A1 | Toolbar overload | **V10** |
| A2 | Status messages have no home | V3 (region) · **V10** (content) |
| A3 | Gap chips must survive | **V5** (carried from `lib/gap-chips.js`, not rebuilt) |
| A4 | The UI already needs `start` vs `sourceIn` | **V2** |
| A5 | Playhead time label collides with the ruler | **V5** |
| A6 | Clip labelling — filename + duration | **V5** |
| A7 | Timecode format | **V2** (`mm:ss.mmm`) |
| A8 | Context menus grey rather than hide, shortcuts inline | **V11** |
| A9 | Media panel states — Added, Media lost | **V9** |
| A10 | Shortcuts discoverable from the top bar | **V3** |
| A11 | Player controls — fit / ratio / fullscreen | **V3** |
| A12 | Project identity in the top bar | V3 (name, dirty) · **V15** (autosave stamp) |

**48 requirements. 47 have a slice. One does not.**

### The uncovered requirement

**R18 — overlays on video.** Deliberately uncovered, not dropped. `ledger-n0-timeline.md` records it as
"Scope unknown — text, logo/watermark, shapes, lower-thirds, images? Research dispatched", and that
research has not returned. V19 carries it with its three unknowns named (§1, V19). Inventing a scope for
it would be the worst outcome — the primitive set changes the cost by an order of magnitude, and the
timeline-object-vs-clip-effect question changes which slice it belongs after.

### Not requirements, not in any slice — surfaced for a scope call

Research classes these as "Stem will feel broken without them". **None came from the founder**, so none
is in scope, and none has been smuggled into a slice.

| Item | Why research called it table stakes | Where it would be cheapest |
|---|---|---|
| **CFR at capture** | Variable-frame-rate screen capture against clock-locked audio is progressive desync, worse past ~30 min. One ffmpeg flag at capture, expensive in post | V1 or V16 — both already open the record path |
| **Music ducking** | Stem ships a music bed that does not duck. `musicMixGraph` (`lib/ffmpeg-util.js:233`) mixes at a fixed gain with no sidechain. Research calls this a defect, not a gap | V12 (the ffmpeg slice) |
| **Two-pass loudness normalisation** | Ends "every video is a different volume" permanently. One analysis pass | V12 |
| **WAV or AAC mic stem instead of mp3** | mp3 carries encoder delay and padding, so cutting introduces small offsets and clicks and there is no exact grid | V1 |
| **Proxy editing** | A 45-minute 4K talk will not scrub at source resolution | Its own slice, after the model is stable |

The first four are each nearly free while a slice that already owns that file is open, and expensive
afterwards. That is the only reason they are surfaced here rather than left in the research ledger.

## 5. One thing this plan asks of S0

`scripts/smoke-export-bundle.js` passes 12 assertions — **Measured**, `node scripts/smoke-export-bundle.js`
exits 0 and prints `{"ok": true, "cases": 12}` — and appears in neither `package.json` `scripts` nor
`scripts/preflight.js`. It is dead coverage, and it violates the repo's own rule in `CLAUDE.md` ("When
adding a smoke, wire it into both").

S0 should wire it in and strengthen the `R-PREFLIGHT-WIRED` architecture rule from "`package.json`
defines `scripts.preflight`" to "**every `scripts/smoke-*` appears in `scripts/preflight`**", so the next
one cannot go missing silently. That is the same class of failure as the `require()`-grep guard that
stops testing under `import` syntax: a gate that has quietly stopped covering something, with nothing to
say so.

## 6. Open loops

- **R18 is uncovered and cannot be scoped until its research returns.** V19 names the three unknowns. No
  slice depends on the answer, so this blocks nothing else.
- **Five table-stakes items are not founder requirements and are in no slice** (§4): CFR at capture, music
  ducking, loudness normalisation, WAV/AAC mic stem, proxy editing. The first four are cheap only while
  V1, V12 or V16 is open. Founder call on whether to widen those slices.
- **V17's render path needs a short spec before the slice starts.** Animating a crop rect in ffmpeg
  (`zoompan`, or `crop` with time expressions) is real design work and the model side being settled does
  not settle it.
- **Per-clip crop must not appear in the UI before V12.** `applyClips` throws on non-uniform crops
  (`lib/ffmpeg-util.js:435-439`). V10 ships crop applied to the whole selection, and the planner returns
  `Err('MIXED_EFFECTS')` if it ever sees a mixed take. This is the one place where a slice could quietly
  ship a UI the renderer cannot honour, so it is called out in V10's non-scope as well as here.
- **Every Electron-version-dependent measurement needs re-confirming after a clean install**, including
  the ~21,000-node figure V5 is justified by. The tree it was measured in had Electron 37.10.3 against a
  declared `^41.10.5`.
- **`Solo` is in no slice and no requirement asks for it.** If it is ever added it is monitor-only.
- **V15 could move earlier than round 6.** It depends only on V2 and V3 and its risk is low; it sits in
  round 6 because rounds 4 and 5 are already the critical path and adding a lane there costs more than it
  saves. If capacity allows, it can join round 4.
