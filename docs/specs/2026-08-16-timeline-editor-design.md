# Stem Studio — timeline editor architecture (reconciled)

Supersedes the N0 architecture draft (`.tasks/n0-architecture.md`, 2026-08-16). That draft was written
before eight decisions landed and rests on two premises that were later tested and found wrong. This
document keeps everything in it that survived, corrects what did not, and adds the four requirements it
never covered.

Companion: `2026-08-16-timeline-editor-plans.md` — the vertical slice set and coverage matrix.

Claims carry a label: **Measured** (executed a command, read the output) · **Cited** (read it in a
document or in source, with `file:line`) · **Inferred** (follows from measured facts) · **Speculation**.

Everything below is design. Type signatures and schema shapes only, no implementation.

---

## 1. Corrections to the previous draft

Four of these are factual errors found by re-testing the draft's own premises. Two are decisions that
postdate it. The draft's reasoning was frequently sound on a premise that was wrong — where that is the
case it is said plainly, because a future reader needs to know the claim was tested rather than
rewritten.

### 1.1 The `-an` claim is wrong twice over (R2)

**The draft said** (`n0-architecture.md:33-36`, §10 item 1):

> Video stems are recorded with no audio at all. `main.js:85` passes `-an` when transcoding
> `screen`/`cam` to mp4. There is no embedded audio in any `screen.mp4` or `cam.mp4` ever produced by
> this app. This makes **R2 retroactively impossible**.

**Both halves fail.**

First, the `-an` no longer exists. `finalizeStem` now transcodes video stems with `-c:a aac -b:a 160k`
(`main.js:80-88`, landed as `ebf78a3`, PR #37). **Cited.**

Second, every take on disk that has a `cam.mp4` carries an audio stream on both video stems.
**Measured**, `ffprobe -show_entries stream=index,codec_type` over `~/Movies/stem-recorder/*/`:

```
collection-guard          screen.mp4: 0,video 1,audio   cam.mp4: 0,video 1,audio
take-2026-08-14T21-17-42  screen.mp4: 0,video 1,audio   cam.mp4: 0,video 1,audio
take-2026-08-14T21-27-30  screen.mp4: 0,video 1,audio   cam.mp4: 0,video 1,audio
take-demo-edit-t1         screen.mp4: 0,video 1,audio   cam.mp4: 0,video 1,audio
take-thumbs               screen.mp4: 0,video           (no cam)
```

**Corrected statement.** R2 — "waveforms for audio embedded in video tracks" — works **today, for every
take on disk**. It is not retroactively impossible and it is not new-takes-only.

**Where the draft's reasoning was right on a wrong premise.** It correctly concluded that *the app* does
not produce video stems with sound. It is right about that, for a reason it did not have: the app
captures screen and cam at `audio: false` (§1.2), so the streams reaching `finalizeStem` carry no audio
to strip. The `-an` was removing nothing. The takes that do have embedded audio came from
`dual-record.sh`, the ffmpeg shell script, not the app — their manifests carry the script's
`stamp=` / `ffmpeg=` / `targets=` format. The conclusion "app-recorded video stems are silent" survives;
the evidence offered for it does not, and the scope ("ever produced", "retroactively impossible") was
too wide.

**Consequences for the model.** `Extract audio` must **not** hardcode a `SOURCE_HAS_NO_AUDIO` outcome.
The draft's command table (`n0-architecture.md:552`) annotated it "Returns `SOURCE_HAS_NO_AUDIO` for
every take recorded to date" — delete that annotation. The predicate is `source.hasAudio`, probed per
source at ingest, and today it is `true` for five of the six sources on disk.

### 1.2 G3 — app-recorded takes export with no dialogue, and capture alone does not fix it

The draft does not mention this at all. It is the most severe defect in the product.

**The capture half. Cited:**

- screen is captured `audio: false` in all three constraint attempts —
  `renderer/index.html:772`, `:773`, `:780`
- cam is captured `audio: false` — `renderer/index.html:731`
- the mic is captured separately into its own stream — `renderer/index.html:739-741`
- `makeRecorder` clones whatever stream it is handed and merges nothing —
  `renderer/index.html:874-875`

**The export half, and this is the part not previously written down. Cited:**

- `studio:apply` sources only `manifest.source`, defaulting to `screen.mp4` — `main.js:208-210`
- in the PiP path, `applyClips` maps `'-map', '[v]', '-map', '0:a?'` — `lib/ffmpeg-util.js:507`.
  Input `0` is `srcPath`; cam is input `1` and **its audio is never mapped**
- in the non-PiP path the filter args are `-vf …` with no explicit `-map`
  (`lib/ffmpeg-util.js:485-489`), so ffmpeg default-selects audio from input 0 only
- `audio.mp3` is never an input to `applyClips` at any point in the function
- `freezeArgs` pushes a bare `-an` whenever `withSilence` is false — `lib/ffmpeg-util.js:361`

**New finding, and it shapes the slice cut.** The decided capture fix — cam muxed with the mic, screen
picture-only (R23) — **does not on its own restore audio to an export**. With cam muxed and screen
picture-only, the default render path still takes `manifest.source = screen.mp4` as input 0 and maps
`0:a?` from it. Input 0 has no audio stream; `?` makes the map optional; the output is silent. **Inferred
from the four cited lines above.**

So R21's audio-source rule is not a preference about which of three copies of the same sound is
authoritative. It is a **render-planner requirement**: the planner must choose an audio input and map it
explicitly, and there must be a path by which `audio.mp3` reaches the render at all. The rule, from
`ledger-ops.md` G3, with the fallback the naive version misses:

| Take contains | Authoritative audio |
|---|---|
| cam + screen + mic | cam's embedded audio |
| **screen + mic, no cam** | **`audio.mp3`** — nothing else carries sound |
| cam + mic, no screen | cam's embedded audio |

"Prefer embedded when it exists, fall back to the standalone mic file." A screen-only take has no
embedded audio anywhere, which is the case a rule stated as "always embedded" gets wrong. Exactly one
source is ever audible, and that mutual exclusion is enforced in the model (§4.4), not by asking the
user to remember.

### 1.3 Join is permissive (C14)

**The draft said** (`n0-architecture.md:541`): Merge requires a true through-edit —
`a.sourceId === b.sourceId && a.sourceOut === b.sourceIn && a.end === b.start &&
a.effects.signature() === b.effects.signature()` — and is greyed out otherwise.

**Decided after the draft was dispatched: join is permissive and always available.** It performs a true
merge when the clips are a genuine through-edit, and forms a same-track **group** otherwise. Never
greyed, never refused for adjacency-without-contiguity. §5.3 carries the reconciled command.

The draft's rejection codes `DIFFERENT_SOURCE` / `NOT_A_THROUGH_EDIT` / `EFFECTS_DIFFER` are retired.
`NOT_ADJACENT` survives — joining clips with a gap between them still has no meaning.

### 1.4 Export selection is accurate-always (C2)

**The draft** left this open (`n0-architecture.md:1313-1316`, open question 7) with a recommendation.
**Decided: re-encode, always.** There is no fast / stream-copy path and no "(fast)" / "(exact)" pair of
commands. Burned captions and PiP force a re-encode on nearly every export anyway, so a stream-copy path
would rarely fire and would exist only to occasionally surprise a user with a clip 2.4 s shorter than
requested.

### 1.5 Move collision pushes the neighbour (C3)

**The draft said** move refuses on collision — `WOULD_OVERWRITE` in the command table
(`n0-architecture.md:542`), "The model never overwrites" (`:252`), and the decisions log entry "Refuse
overwrite-on-collision when moving clips".

**Decided: push the neighbour**, with a dropzone animation showing where it will go. Not refuse, not
overwrite.

The model-level statement is unchanged and still correct: `Track.insert` throws `InvariantError('OVERLAP')`
and the model never overwrites. What changes is the **command**, which now computes a push plan — the
moved clip lands where it was dropped, and every later clip on that track shifts right by the overlap
amount. Nothing is ever destroyed, so the research's actual objection (silent loss of an unrepeatable
take) is honoured by a different mechanism than the one it proposed.

`WOULD_OVERWRITE` is retired as an error code. It is replaced by a plan outcome, not a rejection.

### 1.6 Nudge and timecode are settled (K-d, A7)

`mm:ss.mmm` throughout, including the clip header bar, which the founder's reference renders as
`HH:MM:SS:FF`. Deliberate, logged override — the audio stem has no frame grid.

Nudge: **plain arrow = 10 ms, `Shift`+arrow = 1 s.** The draft carried this as open question 5. Closed.

Split `Cmd+B`, join `Cmd+Shift+B`, `Delete` ripples, `Shift+Delete` lifts. Unchanged from the draft,
restated here because they are the four bindings most likely to be re-litigated.

### 1.7 R22 — the draft hardcodes the three-stem shape in four places

R22 says capture is **N inputs**, export is **M outputs**, and the project between them is one edit. The
draft's `Source` registry is shaped for that, but four things downstream are not:

| Where | What is hardcoded | Fix |
|---|---|---|
| `render.vertical: boolean` (`n0-architecture.md:402`) | exactly one alternate output, named by a boolean | `outputs: OutputTarget[]` — §4.5. This is also the whole of R19 |
| `Track.kind: 'video' \| 'audio'` | fine as a *media* kind; not fine as a *role* | keep the kind, add no role enum. "screen" / "cam" / "mic" are `Source.label` strings, never types |
| §3.5 "A drag started on the screen clip yields three `ClipRef`s, one per track" | assumes 3 | the closure is over the link group, whatever its size |
| the v1→v2 migration loop `for each track in [cam, screen, audio]` | **correct as written** | a v1 document genuinely has exactly those three. Migration may hardcode the shape of the thing it is migrating; nothing downstream may |

The capture side is where the assumption actually lives today: `main.js:158` writes a literal
`targets=screen.mp4,cam.mp4,audio.mp3` into the take manifest. **Cited.** That string becomes a list of
capture-input descriptors (§4.6).

### 1.8 Four requirements the draft never covered

R17 partially, R18, R19 and R20 do not appear in the draft's design sections or its slice list.

- **R17 — the edit is a resumable project artifact.** The draft has autosave as slice S11, framed as a
  safety net. The requirement is stronger: the project file *is* the thing. §4.7.
- **R18 — overlays on video.** Absent. Scope genuinely unresolved; research outstanding. Carried as a
  deferred slice with a named unknown (§9). No design is invented for it here.
- **R19 — multiple outputs from one edit.** Absent, and actively contradicted by `render.vertical`
  being a boolean. §4.5.
- **R20 — per-output framing adjusted on the preview, plus guides.** Absent. §4.5 and §6.4.

### 1.9 `scripts/smoke-export-bundle.js` is not in the gate

**Measured.** `node scripts/smoke-export-bundle.js` exits 0 and reports `{"ok": true, "cases": 12}`. It
appears in neither `package.json` `scripts` nor `scripts/preflight.js`. **Cited** — the preflight step
list is `scripts/preflight.js:14-33` and contains no such entry.

The draft lists it as a surviving preflight step (`n0-architecture.md:892`, `:900`). It is not running
today, so "survives unchanged" would have quietly kept it not running. Twelve passing assertions are
dead coverage. This also violates the repo's own standing rule (`CLAUDE.md`: "When adding a smoke, wire
it into both `package.json` scripts and `scripts/preflight.js`"). Wiring it in belongs to the toolchain
slice.

### 1.10 The hex-literal count under-counts the surface

The draft's theming gate (`n0-architecture.md:964`) says "the 102 hardcoded hex literals in
`timeline.css` go to zero". The 102 is correct — **Measured**, `grep -oE '#[0-9a-fA-F]{3,8}\b'
renderer/timeline.css | wc -l` → `102`, against 20 `var(--` reads. (The ledger's figure of 97 is stale.)

But `renderer/index.html` carries **72 more**. **Measured**, same grep. The gate must cover every
renderer source file, not one stylesheet, or it passes with a third of the problem intact.

### 1.11 `smoke-clip-ops.js` retirement is decided

The draft flagged this as needing founder approval (`n0-architecture.md:1300-1302`). **Decided:** its
110 assertions (**Measured**, `grep -c assert scripts/smoke-clip-ops.js`) are **ported onto the class
API before the file retires**, so coverage never dips. It is not deleted and replaced; it is
transliterated and then deleted.

---

## 2. What the existing code is

The draft's §0 findings, minus the two corrected above, plus the ones the corrections added. All
**Cited** unless marked otherwise.

**The renderer already imports `lib/`, and the guard cannot see it.** `renderer/index.html:1090-1092`
loads `../lib/clip-ops.js`, `../lib/undo-stack.js`, `../lib/gap-chips.js` as `<script src>`. Those files
publish `globalThis.StemClipOps` / `StemUndoStack` / `StemGapChips`, which `renderer/studio.js:9-10`
reads. `scripts/check-architecture.js:48-54` scans only `renderer/**/*.js` for `require()` strings and
never parses `index.html`, so the crossing is invisible. `ARCHITECTURE.md:35` ("renderer never
requires … `lib/*`") is already false in practice. The rewrite restates the invariant correctly rather
than restoring it: pure domain code is shared, privileged I/O is not.

**`check-architecture.js` stops testing anything under `import` syntax.** Its only mechanism is a
`require(...)` regex (`scripts/check-architecture.js:39-45`). It does not fail loudly when the syntax
changes — it silently passes everything. This is the failure mode the guard itself exists to catch.

**`ffmpeg-util.applyClips` refuses non-uniform crops.** `lib/ffmpeg-util.js:435-439` throws
`clips have different crop rects — one crop per take for now`. Per-clip effects can be expressed in the
model on day one; the renderer must not offer them until the export planner renders per-clip filter
chains.

**`renderTimeline()` is the measured performance problem, and it is not React's fault.**
`renderer/studio.js:542` rebuilds every lane, clip, filmstrip tile and waveform bar on every call;
`waveBarsEl` (`studio.js:469`) emits one `<b>` per 3 px of track width; `refreshAll()` (`studio.js:667`)
calls it and sits inside the trim-drag move handler. That is the ~21,000-node-per-`pointermove` figure
at default zoom on the real 580.6 s take.

**Selection is a single integer.** `renderer/studio.js:96` — `selectedIdx`. `doSplit` (`studio.js:1530`)
maps the playhead to a clip index and ignores selection entirely. R11 and R15 are the same defect
surfacing twice.

**There is no CSP and no application menu.** `renderer/index.html` has no `meta http-equiv`; `main.js`
never calls `setApplicationMenu`. `index.html:7-9` loads Google Fonts over the network, which a real CSP
forces self-hosting.

**Theming today is one dark skin scoped to `#view-edit`** (`renderer/timeline.css:701-712`), over a
9-property light base at `renderer/index.html:11-20`. No `localStorage` anywhere.

**The window paints `#f6f4ef` before anything loads** — `main.js:100`, hardcoded. That is the current
flash-of-wrong-theme source.

**Toolchain caveat.** `node_modules` holds Electron 37.10.3 against a declared `^41.10.5`
(`package.json:49`). Any measurement taken in that tree — including the ~21,000-node figure — is
re-confirmed after a clean install before a slice is built on it.

---

## 3. Layers

### 3.1 Target tree

```
electron.vite.config.ts
tsconfig.json                 project references
tsconfig.domain.json          lib/domain — erasable-only TS, no build step
tsconfig.node.json            lib/node, src/main, src/preload, scripts
tsconfig.renderer.json        src/renderer — DOM lib, JSX

src/
  shared/                     types only, zero runtime, imported by every layer
    ipc.ts                    StudioApi, every payload type
    keymap.ts                 the single keymap registry
    tokens.ts                 raw ramp + semantic aliases (source of tokens.css)
  main/
    index.ts   window.ts   protocol.ts   menu.ts   theme.ts   ipc/
  preload/
    index.ts                  contextBridge, implements StudioApi
  renderer/
    main.tsx   store/   app/   components/   styles/

lib/
  domain/                     PURE. no node:*, no electron, no npm runtime deps
    ticks.ts  timeline.ts  track.ts  clip.ts  selection.ts  link-group.ts
    marker.ts  source.ts  audio-route.ts  output-target.ts
    effects/  animatable.ts  manifest/  commands/  undo.ts
    captions.ts  export-presets.ts  apply-duration.ts  gap-chips.ts
  node/                       I/O boundary. main-process only
    paths.ts  edit-manifest.ts  ffmpeg-util.ts  media-cache.ts
    waveform-png.ts  transcribe.ts  export-bundle-io.ts  settings-store.ts

scripts/
  check-architecture.ts       import-graph rules + --self-test
  preflight.ts
  fixtures/arch-violations/   deliberate violations, one rule each
  smoke-*.ts                  run by bare `node`, no node_modules
```

### 3.2 Where the no-build-step property survives

Exactly for `lib/domain/**` and `scripts/**`, run by bare `node scripts/smoke-x.ts`. That is the property
worth protecting — the current smokes cost 0.019 s and need no `node_modules`.

The price is a dialect rule, and it is checkable:

> Every file under `lib/domain/**` and `scripts/**` is **erasable-only TypeScript** — no `enum`, no
> `namespace`, no parameter properties, no legacy decorators, no `import x = require()`. Type-only
> imports written `import type`. Relative imports carry the `.ts` extension.

`tsconfig.domain.json` sets `erasableSyntaxOnly` and `verbatimModuleSyntax`; the architecture check
enforces the same rule structurally so a smoke can never silently stop running under bare `node`.

`src/main` and `src/preload` are **built by electron-vite**, not run raw. Node 24's native type
stripping was verified against the `node` CLI, never against Electron's own main-process loader
(`n0-conflicts.md` C13), and the packaged build wants a bundle regardless for `asarUnpack` and
`rollupOptions.external`. The convention that correction established holds for this document too: a
claim records *what was executed to verify it*, not merely that it was verified.

### 3.3 Sandbox constraints

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` stay exactly as they are
(`main.js:103-105`). Consequences:

- The preload is a **single bundled CommonJS file**. Not ESM, no `require` of `lib/**`, no filesystem.
  It is `ipcRenderer.invoke` wrappers and a small set of event subscriptions.
- **Class instances cannot cross the bridge.** structured-clone strips prototypes. Only `ManifestV2` —
  plain JSON — crosses. Enforced by type, not convention (§7).
- The renderer has no `fs`. Media arrives as `stem-media://` URLs resolved in main with a
  take-directory containment check, so the CSP names one scheme and a moved stem yields a clean 404 the
  UI renders as "Media lost" (S1 / A9) instead of a black frame. This replaces the `file://` URLs built
  at `lib/edit-manifest.js:147`.

### 3.4 The restated layer invariant

Replacing `ARCHITECTURE.md:35-41`:

1. `lib/domain/**` is pure and portable: no `node:*`, no `electron`, no npm runtime dependency,
   erasable TS only. Runs in the renderer bundle, in main, and under bare `node`.
2. `lib/node/**` is main-process only. Nothing in `src/renderer/**` or `src/preload/**` imports it.
3. `src/renderer/**` imports `src/renderer/**`, `lib/domain/**`, `src/shared/**`, and declared UI
   dependencies. Never `electron`, `node:*`, `lib/node/**`, or `src/main/**`.
4. `src/preload/**` imports only `electron` and type-only from `src/shared/**`.
5. `src/main/window.ts` keeps the three hardening flags, and a CSP is installed.
6. Every `contextBridge` key is declared in `src/shared/ipc.ts` and its payloads are JSON-assignable.
7. `index.html` loads nothing outside the Vite module graph — this closes `index.html:1090`.

---

## 4. The domain model

### 4.1 Time

```ts
export type Ticks = number
export const TICKS_PER_SECOND = 90_000
export function secondsToTicks(s: number): Ticks
export function ticksToSeconds(t: Ticks): number
export function formatTimecode(t: Ticks): string
```

`Ticks` is an integer; every constructor floors and asserts integrality. 90 kHz divides evenly for
24/25/30/50/60 and the 1001-denominator NTSC rates, so a later frame-accurate path stays open without
float drift. Conversion to seconds happens **once**, at the ffmpeg boundary in `lib/node`.
`formatTimecode` emits `mm:ss.mmm`.

### 4.2 Classes and their invariants

**Class constructors and mutators enforce representation invariants and throw `InvariantError`.** An
`InvariantError` reaching a user is a bug, never a workflow. Every user-reachable rejection happens
earlier, in a command's `check()` (§5), which returns a typed error the UI renders. That split is what
makes the toolbar, application menu and context menu agree by construction (X2).

#### `Clip`

```ts
class Clip {
  readonly id: ClipId
  readonly sourceId: SourceId
  start: Ticks
  duration: Ticks
  sourceIn: Ticks
  linkGroupId: LinkGroupId | null
  enabled: boolean
  effects: EffectStack
  label: string

  get end(): Ticks
  get sourceOut(): Ticks
  sourceTimeAt(timelineTime: Ticks): Ticks
  timelineTimeAt(sourceTime: Ticks): Ticks
  withSlip(delta: Ticks): Clip
  toJSON(): ClipV2
}
```

Four-point clip: `start` / `duration` / `sourceIn`, with `end` and `sourceOut` derived. `sourceOut` is
**not** `sourceIn + duration` in general — a speed effect breaks the 1:1 — so it is computed through the
effect stack. `sourceTimeAt` / `timelineTimeAt` are the **one canonical mapping**. Waveforms,
filmstrips, caption cues, word timings, gap chips and marker remapping all call these two methods and
never do their own arithmetic. This is the most load-bearing rule in the model and the architecture
check cannot enforce it — code review must.

Invariants: `duration > 0` · `start >= 0` · `sourceIn >= 0` · `sourceOut <= source.availableDuration` ·
all three integral.

Freeze is an effect, not a flag: `{ type: 'freeze' }` with `duration` the hold and `sourceIn` the held
frame — identical semantics to today's `{ freeze: true }` (`lib/clip-ops.js:298-317`).

#### `Track`

```ts
class Track {
  readonly id: TrackId
  kind: 'video' | 'audio'
  name: string
  muted: boolean; hidden: boolean; locked: boolean
  heightPx: number
  showWaveform: boolean
  gainDb: number

  get clips(): readonly Clip[]
  clipAt(t: Ticks): Clip | null
  clipsInRange(a: Ticks, b: Ticks): Clip[]
  insert(clip: Clip): void
  remove(clipId: ClipId): Clip
  neighbours(clipId: ClipId): { before: Clip | null; after: Clip | null }
  clipsFrom(t: Ticks): Clip[]
}
```

Invariants: clips sorted ascending by `start`; for adjacent `a`, `b` — `a.end <= b.start` (touching is
legal, overlap is not); every `clip.sourceId` resolves in `Timeline.sources`; a clip's kind matches the
track's kind.

`insert` throws `InvariantError('OVERLAP')`. **The model never overwrites and never pushes** — pushing
is a command-level plan (§5.4) that calls `remove`/`insert` in an order the model accepts. `clipsFrom`
exists for the push planner.

`kind` is a *media* kind. It is not a role. There is no `'screen' | 'cam' | 'mic'` type anywhere in the
model (R22) — those are `Source.label` strings.

#### `Timeline`

```ts
class Timeline {
  readonly schemaVersion: 2
  readonly timebase: { ticksPerSecond: 90_000 }
  takeId: string
  sources: Map<SourceId, Source>
  tracks: Track[]
  linkGroups: Map<LinkGroupId, LinkGroup>
  markers: Marker[]
  audioRoute: AudioRoute
  outputs: OutputTarget[]
  render: RenderSettings

  get duration(): Ticks
  track(id: TrackId): Track
  clip(ref: ClipRef): Clip
  linkedSiblings(ref: ClipRef): ClipRef[]
  editPoints(): Ticks[]
  normalize(): void
  toJSON(): ManifestV2
  static fromJSON(doc: ManifestV2): Timeline
}
```

`normalize()` re-sorts, re-derives `duration`, drops link groups with fewer than two members, clamps
markers into `[0, duration]`, re-resolves `audioRoute` against the current source set, and asserts every
per-track invariant. It runs after every command and in `fromJSON`. It never silently repairs an
overlap — an overlap at `normalize()` time is an `InvariantError`, because a command should have planned
around it.

#### `Source`

```ts
type Source = {
  id: SourceId
  path: string              // relative to the take dir
  label: string             // 'screen.mp4', 'cam.mp4', 'b-roll.mov' — a name, not a role
  kind: 'video' | 'audio'
  availableDuration: Ticks
  hasAudio: boolean         // probed at ingest, never assumed
  peaksKey: string | null
  present: boolean
  origin: 'capture' | 'import'
}
```

Relative paths mean a moved take folder still opens. `present: false` drives the "Media lost" tile
(S1 / A9); every command touching a clip on an absent source returns `Err('SOURCE_MISSING')` rather than
throwing. `hasAudio` is the R2 predicate and is **probed with ffprobe at ingest**, per source — not
inferred from the file's role and not assumed from the recorder's configuration. §1.1 is what happens
when it is assumed.

`origin` distinguishes a captured stem from an imported file (R3), which the export bundle needs.

#### `LinkGroup`

```ts
class LinkGroup {
  readonly id: LinkGroupId
  members: Set<ClipId>
  locked: boolean
  kind: 'sync' | 'join'
  driftOf(timeline: Timeline): Map<ClipId, Ticks>
}
```

`locked: true` means members move as one and `start`/`duration` stay equal across them. `driftOf`
returns each member's signed offset from the reference member. Drift is **allowed, not an error** — that
is how a J/L cut is made — but it is surfaced: a badge with the signed offset in `mm:ss.mmm` on every
member, and the export commands return `Err('UNRESOLVED_DRIFT')` when a locked group drifts more than
33 ms without an explicit confirm flag.

`kind: 'join'` is new, and it is what makes permissive join possible (§1.3, §5.3): a same-track group of
clips that are adjacent but not source-contiguous. A `join` group is single-track by construction; a
`sync` group spans tracks. They are the same mechanism with different membership rules, which is why
they are one class rather than two.

Two distinctly named user-facing things: **Linked Selection** (global, temporary, a toolbar toggle) and
**Ungroup** (per-group, permanent, a command).

#### `Selection`

```ts
class Selection {
  clips: ReadonlySet<ClipRef>
  range: { in: Ticks | null; out: Ticks | null }
  markers: ReadonlySet<MarkerId>
  focus: ClipRef | null

  isEmpty(): boolean
  tracksTouched(): TrackId[]
  expandLinked(t: Timeline, linkedSelection: boolean): Selection
  sameTrack(): boolean
  areAdjacent(t: Timeline): boolean
}
```

First-class app state (R15), holding **both** a clip set and an I/O range. Commands that can read either
state a precedence rule in `check()`: Split and Delete prefer the clip set when non-empty and fall back
to the range; Export offers both as two distinct commands, never one overloaded verb.

#### `Marker`

```ts
class Marker { id: MarkerId; at: Ticks; label: string; color: string; kind: 'marker' | 'chapter' }
```

Markers live in the timeline's time space and are remapped by the **same pass** that remaps clips. A
ripple delete of `[a, b)` shifts every marker at `>= b` back by `b - a` and deletes markers inside
`[a, b)`. A bare float timestamp goes stale on the first ripple; this does not.

#### Effects and `Animatable<T>`

```ts
type Animatable<T> =
  | { kind: 'const'; value: T }
  | { kind: 'keyed'; keys: Array<{ at: Ticks; value: T; ease: EaseKind }> }

function evaluate<T>(a: Animatable<T>, at: Ticks): T

type Effect =
  | { id: EffectId; type: 'crop';   enabled: boolean; params: { rect: Animatable<Rect> } }
  | { id: EffectId; type: 'mirror'; enabled: boolean; params: {} }
  | { id: EffectId; type: 'rotate'; enabled: boolean; params: { degrees: 90 | 180 | 270 } }
  | { id: EffectId; type: 'pip';    enabled: boolean; params: { layout: Animatable<PipLayout> } }
  | { id: EffectId; type: 'freeze'; enabled: boolean; params: {} }
  | { id: EffectId; type: 'speed';  enabled: boolean; params: { rate: number } }
  | { id: EffectId; type: 'zoom';   enabled: boolean; params: { rect: Animatable<Rect> } }

class EffectStack { list: Effect[]; signature(): string }
```

Every animatable parameter is typed `Animatable<T>` from day one even where only `{ kind: 'const' }` is
ever written. The expensive retrofit is the **type**, not the data: a call site reading `clip.crop.zoom`
as a number would have to become "evaluate at t" in every consumer at once. `evaluate()` is the only
reader.

`signature()` is a stable hash of the enabled stack. The React `Clip` component takes it as a primitive
prop so effect changes invalidate exactly the clips that changed (§6), and the export planner groups
clips by signature.

### 4.3 Manifest v2 schema

Plain JSON. This crosses the bridge and lands at `<take>/edit/manifest.json`.

```jsonc
{
  "schemaVersion": 2,
  "takeId": "take-20260816-1203",
  "timebase": { "ticksPerSecond": 90000 },
  "sources": {
    "src-screen": { "path": "screen.mp4", "label": "screen.mp4", "kind": "video",
                    "availableDuration": 52254000, "hasAudio": false, "origin": "capture" },
    "src-cam":    { "path": "cam.mp4",    "label": "cam.mp4",    "kind": "video",
                    "availableDuration": 52254000, "hasAudio": true,  "origin": "capture" },
    "src-mic":    { "path": "audio.mp3",  "label": "audio.mp3",  "kind": "audio",
                    "availableDuration": 52254000, "hasAudio": true,  "origin": "capture" }
  },
  "tracks": [
    { "id": "trk-cam", "kind": "video", "name": "cam.mp4", "heightPx": 72,
      "showWaveform": true, "clips": [ /* ClipV2 */ ] },
    { "id": "trk-screen", "kind": "video", "name": "screen.mp4", "clips": [] },
    { "id": "trk-mic", "kind": "audio", "name": "audio.mp3", "clips": [] }
  ],
  "linkGroups": { "lg-1": { "members": ["clip-a", "clip-b", "clip-c"], "locked": true, "kind": "sync" } },
  "markers": [ { "id": "mk-1", "at": 900000, "label": "intro", "kind": "chapter" } ],
  "audioRoute": { "activeSourceId": "src-cam", "resolvedBy": "auto" },
  "outputs": [
    { "id": "out-h", "name": "Horizontal", "aspect": "16:9", "width": 1920, "height": 1080,
      "framing": { "kind": "const", "value": { "x": 0, "y": 0, "w": 1, "h": 1 } }, "enabled": true },
    { "id": "out-v", "name": "Vertical", "aspect": "9:16", "width": 1080, "height": 1920,
      "framing": { "kind": "const", "value": { "x": 0.28, "y": 0, "w": 0.44, "h": 1 } }, "enabled": true }
  ],
  "render": {
    "captions": { "burn": true, "style": "karaoke" },
    "exportRate": 1.25,
    "music": { "path": "/abs/path.mp3", "gainDb": -18 }
  },
  "updatedAt": "2026-08-16T12:03:00.000Z"
}
```

```jsonc
// ClipV2
{ "id": "clip-a", "sourceId": "src-screen", "start": 0, "duration": 450000,
  "sourceIn": 0, "linkGroup": "lg-1", "enabled": true,
  "effects": [ { "id": "fx-1", "type": "crop", "enabled": true,
                 "params": { "rect": { "kind": "const", "value": { "x": 0, "y": 0, "w": 0.8, "h": 1 } } } } ] }
```

Absent-key conventions carry over from v1 (`lib/clip-ops.js:189-239`): defaults are not stored.
`enabled: true`, `locked: false`, `gainDb: 0`, an empty `effects` array — omitted on write.

Two v1 `render` keys have moved out of `render` because they were the hardcoded shape R22 forbids:
`vertical: boolean` becomes an entry in `outputs`, and the implicit "audio comes from the source" becomes
`audioRoute`. `captions`, `exportRate` and `music` are unchanged in meaning, so that whole render path is
untouched by the model rewrite.

### 4.4 `AudioRoute` — R21, and the G3 fallback

```ts
type AudioRoute = {
  activeSourceId: SourceId | null
  resolvedBy: 'auto' | 'user'
}

function resolveAudioRoute(sources: Iterable<Source>): SourceId | null
```

**Exactly one source is audible in a render.** That is a model-level invariant, not a UI convention:
`normalize()` asserts that `activeSourceId` names a source with `hasAudio === true` and is `present`,
and re-resolves to `auto` if it does not.

`resolveAudioRoute` implements the §1.2 table:

1. a `video` source with `hasAudio` whose label is the cam, if one exists
2. otherwise any `video` source with `hasAudio`
3. otherwise any `audio` source with `hasAudio` — this is the screen-only case, and it is the branch a
   rule stated as "always prefer embedded" omits
4. otherwise `null`, and the export planner emits explicit silence rather than a failed map

`resolvedBy: 'user'` pins a manual choice so `normalize()` will not overwrite it while the named source
stays valid. R21's "simple way to exclude by removing on the project" is this field plus a one-click
control in the inspector's Audio tab: choosing a source deactivates the others, because there is one
field and it holds one id.

**The export planner reads `audioRoute` and maps that input explicitly.** It does not rely on ffmpeg's
default stream selection and it does not use `0:a?`. That is the fix for the export half of G3 (§1.2)
and it is the reason the audio work cannot be a capture-only slice.

### 4.5 `OutputTarget` — R19 and R20

```ts
type OutputTarget = {
  id: OutputId
  name: string
  aspect: string
  width: number
  height: number
  framing: Animatable<Rect>     // normalized 0..1 over the composed canvas
  enabled: boolean
  captionStyle?: CaptionStyleId
}
```

R19 — "multiple outputs from one finished edit" — is the **normal case**, not an edge (`ledger-n0-timeline.md`
N0-W). One edit decision list, M render passes. The v1 `vertical: boolean` migrates to a two-entry
`outputs` array: a full-frame `16:9` and a `9:16` whose default `framing` reproduces exactly what
`verticalCropScaleFilter` produces today, so a migrated take exports byte-identically.

`framing` is `Animatable<Rect>` rather than a plain rect for the same reason every other parameter is:
the retrofit cost is the type, not the data. v2 only ever writes `{ kind: 'const' }`.

R20 — per-output framing adjusted **on the preview** — is `framing` edited through a draggable rectangle
drawn over the player, one per enabled output. The guide layer is view-time chrome only (§6.4): it is
never a track, never a renderable layer, and structurally cannot leak into an export. That is the CapCut
anti-pattern the guides research names explicitly — its safe-zone guide is an overlay *track* the user
must remember to delete before exporting.

### 4.6 Capture inputs — R22 and R23

The capture side is where the three-stem shape is currently baked in (`main.js:158` writes a literal
`targets=screen.mp4,cam.mp4,audio.mp3`).

```ts
type CaptureInput = {
  id: string
  label: string
  media: 'video' | 'audio'
  target: string                       // the file it finalizes to
  muxedAudioFrom: string | null        // id of an audio input muxed into this stream
}
```

R23's decided default is expressed as data, not as code shape:

```
[ { id: 'screen', media: 'video', target: 'screen.mp4', muxedAudioFrom: null },
  { id: 'cam',    media: 'video', target: 'cam.mp4',    muxedAudioFrom: 'mic' },
  { id: 'mic',    media: 'audio', target: 'audio.mp3',  muxedAudioFrom: null } ]
```

**Cam is muxed with the mic — the only default. Screen stays picture-only. Screen audio is not
captured.** `audio.mp3` remains as the standalone mic file.

The mux is composed at the recorder, not at `getUserMedia`: `makeRecorder` already clones every track it
is handed (`renderer/index.html:874-875`), so the cam recorder's stream becomes the cam video track plus
a **clone of the already-captured mic track**. The mic is captured once and the capture graph stays
single. Changing the `getUserMedia` constraints instead would capture the mic twice and produce two
slightly different recordings of the same sound.

A second, later camera or microphone is another entry in this list and nothing downstream changes. That
is R22 satisfied in the one place it was not.

### 4.7 The project artifact — R17

The manifest **is** the document. Not a cache of UI state, not a safety net.

- **Open** loads it, migrates if needed, and restores selection and playhead from a sibling
  `edit/session.json` (view state, deliberately not in the manifest — a project opened on another
  machine should not fail because a track height is missing).
- **Dirty state** is a store flag, shown in the top bar next to the project name.
- **Save** writes `manifest.json` atomically (temp file, rename).
- **Autosave** writes `edit/manifest.autosave.json` on an interval, never over `manifest.json`.
- **Recovery** on open: if an autosave is newer than the manifest, offer it. The path that matters is
  **"previously saved, then crashed"**, not "never saved" — the second is the one everyone tests.
- **The take folder is a self-contained, movable bundle.** Every source path is relative and every
  imported file is copied in (R3), so moving or archiving the folder loses nothing.

### 4.8 `schemaVersion` chain and the v1→v2 migration

```ts
type Migration = (doc: unknown) => unknown
const MIGRATIONS: Record<number, Migration> = { 1: v1ToV2 }
const CURRENT_SCHEMA_VERSION = 2

function loadManifest(raw: unknown): Result<ManifestV2, LoadError>
```

- **Absent `schemaVersion` means v1** — unambiguous, since v1 writes `version: 1`
  (`lib/edit-manifest.js:57`, `:90`) and never `schemaVersion`.
- Sequential chain of pure JSON→JSON functions applied until `CURRENT_SCHEMA_VERSION`.
- `schemaVersion > CURRENT` → `Err('FROM_THE_FUTURE')` naming both versions. Refuse; never mangle.
- Before overwriting a migrated file, write `<take>/edit/manifest.v1.bak.json`. A broken migration must
  not destroy the only copy of an unrepeatable take.
- Lazy upgrade on open, persisted on next save — not eagerly on library listing.

**v1→v2 is not `start = in`.** v1 semantics are *kept segments concatenated, gaps removed*
(`lib/clip-ops.js:104-131` — output time is the running sum of clip durations):

```
cursor = 0
for i, v1clip in v1.clips:
  seg = (v1clip.out ?? probedDuration) - v1clip.in
  group = "lg-<i>"
  for each track in [cam, screen, audio] that has a source file:
    emit Clip { start: cursor, duration: seg, sourceIn: v1clip.in, linkGroup: group }
  linkGroups[group] = { members: [...], locked: true, kind: 'sync' }
  cursor += seg
```

Effects mapped in the same pass: v1 `crop` → a `crop` effect on the screen-track clip; `freeze: true` →
a `freeze` effect; take-level `cam.mirror` / `cam.rotate` / `cam.pipLayout` (`lib/clip-ops.js:189-198`) →
`mirror` / `rotate` / `pip` effects on **every** cam-track clip, so the stack is per-clip from day one.
`captions` / `exportRate` / `music` move verbatim into `render`; `vertical` becomes an `outputs` entry
(§4.5); `audioRoute` is computed by `resolveAudioRoute` over the probed sources (§4.4).

**Every migrated group is `locked: true`.** A v1 take then behaves exactly as it does today and nothing
drifts unless the user deliberately unlocks. That is the entire safety story.

**The migration's test** — `scripts/smoke-migrate-v1v2.ts`:

> For each v1 fixture manifest, build the ffmpeg argument vector v1 would produce, migrate to v2, build
> the vector the v2 export planner produces, and assert the two are **deep-equal**.

This reuses what `scripts/smoke-apply-args.js` already does — it asserts on argument vectors rather than
rendered bytes, so it is fast, hermetic and needs no media on disk. A byte-identical export is the
claim; an identical arg vector is how you prove it without a GPU-hour. Fixtures must include: one clip ·
many clips · a freeze segment · a crop · cam mirror+rotate+pipLayout · captions karaoke · exportRate ≠ 1
· music · vertical · a take with no cam · a take with no audio · **a take whose only audio is
`audio.mp3`** (the §1.2 fallback branch).

---

## 5. Operations as commands

### 5.1 The command interface

```ts
type CommandError = { code: ErrorCode; message: string; refs?: ClipRef[] }
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

interface Command<P = void> {
  readonly id: CommandId
  readonly label: string
  check(ctx: CommandContext, p: P): Result<void, CommandError>
  apply(ctx: CommandContext, p: P): Result<void, CommandError>
}

type CommandContext = { timeline: Timeline; selection: Selection; playhead: Ticks; options: EditorOptions }
```

`check()` is pure and cheap. **Three surfaces read it and nothing else decides enablement:** the toolbar
renders `disabled` with the error message as tooltip; the context menu renders the item **greyed, not
hidden** (A8) with the same message; the application menu's `enabled` flag is pushed to main from the
same evaluation. That is the mechanical answer to X2 — a verb cannot be disabled in one surface and
offered in another, because there is one predicate and one `label`.

`apply()` re-runs `check()` first and returns the same error. Never trust the caller's gating.

### 5.2 Undo

Snapshot-based, named by the command that produced it:

```ts
type UndoEntry = {
  label: string
  before: ManifestV2; after: ManifestV2
  selectionBefore: SelectionJSON; selectionAfter: SelectionJSON
}
```

- One entry per **gesture**, not per event. A drag commits on `pointerup`; in-flight positions are never
  recorded.
- Bounded ring, 100 entries (matching `lib/undo-stack.js:13`).
- Serialized as plain JSON, so an entry cannot alias live class instances.
- **Async media results never enter the stack.** Transcription, filmstrips, waveform PNGs and proxies
  write to `edit/` and `edit/.cache/` and notify the store through a separate, non-undoable channel. A
  transcription completing mid-session must not be reverted by an unrelated undo.
- Composition is trivial by construction: any command, however many tracks it touches, produces exactly
  one entry, because the entry is a whole-timeline snapshot taken before `apply()` and after
  `normalize()`.

### 5.3 The command catalogue

Reconciled. Changes from the draft are marked.

| Command | Precondition (`check`) | Rejects with | Undo |
|---|---|---|---|
| **Split** `timeline.split` | selection non-empty *or* playhead over ≥1 clip; split point strictly inside each target with ≥100 ms either side; target track unlocked | `NOTHING_TO_SPLIT` · `SPLIT_AT_EDGE` · `TRACK_LOCKED` · `CANNOT_SPLIT_FREEZE` | one entry; splits every selected clip (R15) and every linked sibling |
| **Ripple delete** `timeline.rippleDelete` | selection non-empty; no target track locked | `NOTHING_SELECTED` · `TRACK_LOCKED` | one entry; removes clips, closes the gap on each affected track, remaps markers |
| **Lift** `timeline.lift` | as above | as above | one entry; removes clips, leaves the gap |
| **Join** `timeline.join` **(CHANGED — §1.3)** | ≥2 selected clips, all on **one** track, adjacent in track order with no gap between them | `NOT_ADJACENT` · `NEED_TWO_CLIPS` · `TRACK_LOCKED` | one entry. **Never greyed for source discontinuity.** Produces a true merge when every adjacent pair satisfies `a.sourceId === b.sourceId && a.sourceOut === b.sourceIn && a.effects.signature() === b.effects.signature()`; otherwise a `kind: 'join'` `LinkGroup` over the selection. The result is reported so the UI can say which happened |
| **Move** `timeline.move` **(CHANGED — §1.5)** | target start ≥ 0; destination track kind matches clip kind; no destination track locked | `KIND_MISMATCH` · `NEGATIVE_START` · `TRACK_LOCKED` | one entry, atomic across tracks (§5.4). **Collisions push, they do not refuse.** `WOULD_OVERWRITE` retired |
| **Trim** `timeline.trim` | resulting `duration >= 100 ms`; `sourceIn >= 0` and `sourceOut <= availableDuration` | `TOO_SHORT` · `PAST_SOURCE_BOUNDS` | one entry on `pointerup`. A trim that grows into a neighbour pushes it, same rule as Move |
| **Add track** `timeline.addTrack` | none | — | one entry |
| **Import media** `timeline.importMedia` **(NEW — R3)** | a take is open | `NO_TAKE` · `COPY_FAILED` · `UNREADABLE_MEDIA` | one entry. Main opens a file dialog, **copies** the file into the take folder, probes it, registers a `Source` with `origin: 'import'`, and places a clip on a new track |
| **Remove track** `timeline.removeTrack` | track exists; timeline keeps ≥1 track | `LAST_TRACK` | one entry; removes its clips, prunes link groups |
| **Group** `timeline.group` | ≥2 selected clips on ≥2 distinct tracks, none already in a different group | `NEED_TWO_TRACKS` · `ALREADY_GROUPED` | one entry; creates a `sync` group |
| **Ungroup** `timeline.ungroup` | selection intersects ≥1 link group | `NOT_GROUPED` | one entry; works on `sync` and `join` groups alike |
| **Export selected clips** `export.selection` | selection non-empty; every source present; no unresolved drift > 33 ms in a locked group (or `confirmed: true`) | `NOTHING_SELECTED` · `SOURCE_MISSING` · `UNRESOLVED_DRIFT` | not undoable. **Always re-encodes** (§1.4) |
| **Export range** `export.range` | `range.in` and `range.out` set, `out > in` | `RANGE_INCOMPLETE` | as above |
| **Move into sync** `timeline.moveIntoSync` | selection in a link group with drift ≠ 0 | `NO_DRIFT` | one entry; adjusts `start` |
| **Slip into sync** `timeline.slipIntoSync` | as above, slip stays inside source bounds | `NO_DRIFT` · `PAST_SOURCE_BOUNDS` | one entry; adjusts `sourceIn`, keeps `start` |
| **Extract audio** `timeline.extractAudio` **(CHANGED — §1.1)** | selected clip's source `hasAudio === true` | `SOURCE_HAS_NO_AUDIO` | one entry; adds an audio track and a linked clip. **Available today for every take on disk that has a cam stem** |
| **Set audio source** `timeline.setAudioSource` **(NEW — R21)** | the named source exists, is present, and `hasAudio` | `SOURCE_HAS_NO_AUDIO` · `SOURCE_MISSING` | one entry; sets `audioRoute.activeSourceId` and `resolvedBy: 'user'`. Setting one deactivates all others by construction |
| **Add output** / **Remove output** / **Set output framing** **(NEW — R19, R20)** | ≥1 output remains enabled | `LAST_OUTPUT` | one entry each |
| **Copy / Paste attributes** `clip.copyAttrs` / `clip.pasteAttrs` | a clip is focused / the clipboard is non-empty and the target kind matches | `NO_FOCUS` · `EMPTY_ATTR_CLIPBOARD` · `KIND_MISMATCH` | one entry on paste |
| **Toggle clip enabled** `clip.setEnabled` | selection non-empty | `NOTHING_SELECTED` | one entry |
| **Add marker** `timeline.addMarker` | none | — | one entry |

Two things are deliberately *absent* and their absence is the design: there is no `overwrite` variant of
Move, and there are no modal trim tools (ripple/roll/slip/slide as separate modes). One drag behaviour:
free positional move that pushes what is in the way.

### 5.4 Move, with the push plan

The gesture never touches the model. On `pointerup`:

1. **Expand.** `selection.expandLinked(timeline, linkedSelectionOn)` returns the transitive closure of
   the selected clips through their locked link groups. A drag started on one member of a group yields
   one `ClipRef` per member — however many that is (R22: not "three").
2. **Plan the move.** Compute one `delta: Ticks` and one `deltaTrack` from the gesture. Build
   `MovePlan = Array<{ ref, toTrackId, toStart }>` for the whole closure.
3. **Plan the pushes.** For each destination track, take the clips **not in the plan** whose spans
   intersect any planned span, and compute a right-shift for each such clip and every clip after it on
   that track, equal to the largest overlap on that track. Append them to the plan. Pushes cascade
   forward only; a push never moves a clip left and never crosses a track boundary.
4. **Validate the whole plan.** Every destination track exists, matches kind, is unlocked, and every
   resulting `start >= 0`. Overlap is checked *after* pushes are folded in, excluding clips that are
   themselves in the plan — otherwise a group sliding within its own track collides with itself. If any
   entry fails, return `Err` naming the offending refs and write **nothing**.
5. **Snapshot once**, apply the whole plan, `normalize()`, push one `UndoEntry`.

The all-or-nothing property comes from validating the entire plan before the first write. There is no
partial state to roll back because there is no partial write.

**The dropzone animation** is a renderer concern reading the same plan: during the drag, `planMove` is
called on each `pointermove` (pure, cheap, no model mutation) and the pushed clips' ghosts translate to
their planned positions. The user sees where everything lands before releasing. On `Escape` the inline
styles are restored and nothing is dispatched.

Snapping applies to the plan's **reference member** and propagates as one delta, so a locked group
cannot snap its members to different edges and silently desync. Snap targets: the playhead, every clip
edge on every track, zero, and every marker. Threshold ≈ 8 px converted to ticks at the current zoom,
with break-out hysteresis (~14 px) so the clip does not jitter at the boundary.

### 5.5 Ripple delete, precisely

`Delete` ripples, `Shift+Delete` lifts (Final Cut polarity). In a multi-track timeline, ripple must not
desync the other stems.

Rule: **ripple closes the gap on every track the deleted span touches, using the span of the deleted
selection expanded through link groups.** Deleting one member of a locked group deletes all members and
shifts all their tracks by the same amount, so the group stays in sync. Deleting a clip in an *unlocked*
group ripples only its own track and the resulting drift is flagged as drift, not hidden.

Batch capability is a hard requirement, not an optimisation: transcript-driven cutting is hundreds of
ripple deletes and must be **one command call with a list of ranges, producing one undo entry** — never
a UI loop. `rippleDelete` takes `{ refs: ClipRef[] } | { ranges: Array<[Ticks, Ticks]> }` and resolves
the union before touching anything.

---

## 6. The React tree

### 6.1 Shell regions (R12)

```
┌──────────────────────── TopBar ─────────────────────────┐  A12 project name · dirty · autosave stamp · A10 · theme
├──────────┬──────────────────────────┬───────────────────┤
│ Left     │ Main                     │ Right             │
│ Media    │ PlayerStage + guides     │ Inspector         │  S1 · S2 · S3 · R20
│ (S1)     │ + Transport (A11)        │ (tabbed)          │
├──────────┴──────────────────────────┴───────────────────┤
│ StatusBar                                               │  A2
├─────────────────────────────────────────────────────────┤
│ Footer — TimelineToolbar · Ruler · Chips · TrackList     │  S4 · docked to the viewport bottom
└─────────────────────────────────────────────────────────┘
```

The footer is `grid-template-rows: … min-content` with the timeline pinned; only the track list scrolls.
R12's "never scroll to reach the timeline" is a layout invariant, not a behaviour.

### 6.2 Component inventory (atomic design, R9)

**Atoms** (one per file, target < 70 lines): `Button` · `IconButton` · `Icon` · `Toggle` · `Slider` ·
`NumberField` · `TimecodeField` · `Badge` · `Kbd` · `Spinner` · `StatusDot` · `Tooltip` · `MenuItem` ·
`Separator`.

**Molecules**: `ToolbarGroup` · `TrackHeaderControls` (T1) · `ClipHeaderBar` (A6 — filename + duration,
replacing the `#1` index at `studio.js:585`) · `GapChip` (A3 — carried over from `lib/gap-chips.js`, not
rebuilt) · `MediaTile` (S1/A9 — thumbnail, duration, `Added` badge, `Media lost` state) ·
`TransportControls` (A11) · `TimecodeReadout` (R14/S2) · `ZoomSlider` (S4) · `ShortcutRow` ·
`InspectorField` · `DriftBadge` · `OutputChip` (R19) · `AudioSourceRow` (R21).

**Organisms**: `MediaPanel` · `PlayerStage` · `FramingOverlay` (R20) · `InspectorPanel` with tabs
`Position & Size` / `Speed` / `Audio` / `Captions` / `Outputs` (S3 — where Crop, Mirror, Rotate and PiP
move to, off the toolbar, answering A1) · `TimelineToolbar` · `TimelineRuler` · `ChipsRow` · `TrackList`
· `Track` · `TrackHeader` · `Clip` · `PlayheadLayer` · `SelectionMarquee` · `ClipContextMenu` /
`TrackContextMenu` / `GapContextMenu` / `EmptyContextMenu` (X1) · `ShortcutsDialog` (A10) ·
`SettingsDialog` (R7) · `StatusBar` (A2) · `TopBar`.

**Templates**: `EditorShell`, `LibraryShell`, `RecordShell`. **Pages**: `RecordView`, `LibraryView`,
`EditorView`.

A1 is answered structurally: today's 23 always-visible toolbar controls split into **app toolbar** (save,
apply, export bundle, transcribe), **timeline toolbar** (split, join, delete, snap, zoom) and
**inspector** (crop, mirror, rotate, PiP, speed, music, captions, outputs, audio source). Nothing needs
an overflow menu after that, and the under-used `More ▾` is retired.

### 6.3 Store binding and memoization

```ts
class TimelineStore {
  private timeline: Timeline
  private selection: Selection
  private version = 0
  subscribe(listener: () => void): () => void
  getSnapshot(): number
  dispatch<P>(cmd: Command<P>, p: P): Result<void, CommandError>
  read(): { timeline: Timeline; selection: Selection }
}
```

`getSnapshot()` returns the cached **integer**, so `Object.is` is trivially stable and the
`useSyncExternalStore` infinite-loop trap is sidestepped by construction. Components call
`useTimeline()`, which subscribes and reads live class instances out of `read()` — the version is the
invalidation signal, the instances are the data. No MobX (viral tracking rules), no Immer (it would
destroy the invariants that are the point of the class model).

`dispatch` is the only mutation path: `check`, `apply`, `normalize`, push the undo entry, `version++`,
notify. A rejected command does not bump the version.

Three memoization boundaries, and they are the whole performance story:

1. **`Clip` is `React.memo`**, keyed by `clip.id`, receiving **only primitives**: `leftPct` · `widthPct`
   · `label` · `selected` · `enabled` · `effectSignature` · `sourceId` · `filmstripKey` ·
   `waveformKey`. No object props, so the default shallow compare is exact.
2. **`Track` is `React.memo`** on a per-track version integer the store maintains alongside the global
   one. Changing a clip on one track re-renders no other track.
3. **`TrackList` subscribes; `Clip` does not.** Only `TrackList` and `InspectorPanel` call
   `useTimeline()`. Everything below receives props.

**Percent-of-container geometry.** `leftPct = clip.start / timeline.duration`,
`widthPct = clip.duration / timeline.duration`, both fixed under zoom. Zoom writes **one** style
property — the track container's width — and no clip re-renders at all. The current pixel-based
`trackWidthPx()` recomputation (`studio.js:213`) disappears.

**The two imperative writes.** Exactly two per-frame paths bypass React, via refs and direct style
writes — not canvas, not a component boundary:

1. **Playhead position.** `PlayheadLayer` renders once and holds a ref. `usePlayheadDriver()` writes
   `el.style.transform` inside a `requestVideoFrameCallback` callback, reading **`mediaTime`** rather
   than `currentTime` — HTML5 `currentTime` is not frame-accurate, so preview and export disagree
   otherwise. Zero React renders during playback. `TimecodeReadout` is throttled to 10 Hz and *does* go
   through React, because a text node at 10 Hz is free.
2. **The dragged clip's edges, and its push ghosts.** `useClipDrag()` captures the pointer, calls
   `planMove` in ticks, and writes `style.left` / `style.width` directly on the dragged element's ref,
   on its linked siblings' refs, and on the refs of every clip the plan pushes (§5.4). On `pointerup` it
   dispatches `Move` or `Trim` — one store update, one React render, one undo entry.

Explicitly not used: `startTransition` around drag (interruptible and lower-priority, visibly laggy).
React Compiler is irrelevant to a subtree that genuinely changes 60×/sec, which is why the two paths
above exist at all.

`waveBarsEl` (`studio.js:469`) is **deleted**. A track's waveform is one `<img>` per visible zoom slice,
sourced from a main-process ffmpeg render (§8.4). T2's "waveform under the video clip inside the same
track" is a layout of the `Clip` component: when `track.showWaveform && source.hasAudio`, the clip box
splits into a filmstrip band and a waveform band. Filmstrip tiles stay `<img>`-per-tile.

### 6.4 The framing and guide overlay (R20)

An **SVG overlay absolutely positioned over the preview element**, recalculated on resize, structurally
separate from every render and export path so it cannot leak into output.

- One draggable/resizable rectangle per enabled `OutputTarget` whose aspect differs from the composed
  canvas. Dragging it writes `framing` through `Set output framing`.
- Passive guides layered under it: rule of thirds inside the active target, and broadcast safe areas at
  **93% action / 90% title** (SMPTE ST 2046-1:2009 and EBU R95 rev 1.1, which supersede RP 218's
  deprecated 90/80 pair — those were sized for CRT overscan). Social UI-safe zones ship as a *variant*
  of the 9:16 guide, not a separate primitive, and any UI copy labels their numbers approximate, because
  published figures for the same platform disagree by 10–20%.
- **Line-only, not dimming.** Dimming outside the region obscures the content being framed. White line
  with a dark outline so it reads over arbitrary content. Multiple guides differentiated by colour **or**
  opacity, not both. Cap visible guide types at two or three.
- Do not confuse "safe area" (framing) with Resolve's "Broadcast Safe" (a colour-gamut clamp) — same
  name, unrelated jobs, and a documented source of confusion in Resolve's own community.

---

## 7. IPC contract

```ts
export interface StudioApi {
  takes: {
    list(): Promise<TakeSummary[]>
    open(takeId: string): Promise<OpenTakeResult>
    saveManifest(takeId: string, doc: ManifestV2): Promise<SaveResult>
    openFolder(takeId: string): Promise<void>
    revealSource(takeId: string, sourceId: string): Promise<void>
  }
  media: {
    filmstrip(takeId: string, sourceId: string): Promise<FilmstripData | null>
    waveform(takeId: string, sourceId: string, slice: WaveformSliceRequest): Promise<WaveformSlice | null>
    probe(takeId: string): Promise<SourceProbe[]>
    importFile(takeId: string): Promise<ImportedSource | null>
  }
  render: {
    apply(takeId: string, outputIds: OutputId[]): Promise<ApplyResult[]>
    exportSelection(takeId: string, req: ExportSelectionRequest): Promise<ExportResult>
    exportRange(takeId: string, req: ExportRangeRequest): Promise<ExportResult>
    exportBundle(takeId: string): Promise<BundleResult | null>
    ffmpegOk(): Promise<boolean>
  }
  asr: { /* unchanged */ }
  settings: {
    get(): Promise<Settings>
    setThemeSource(v: 'system' | 'light' | 'dark'): Promise<ResolvedTheme>
    set<K extends keyof Settings>(k: K, v: Settings[K]): Promise<void>
  }
  ui: {
    onMenuCommand(cb: (id: CommandId) => void): () => void
    onThemeChanged(cb: (t: ResolvedTheme) => void): () => void
    setCommandEnablement(map: Record<CommandId, boolean>): void
    setTyping(isTyping: boolean): void
  }
  chooseMusic(): Promise<string | null>
}
declare global { interface Window { stemStudio: StudioApi; batchRecorder: RecorderApi } }
```

`render.apply` takes a list of output ids (R19) — one call, M renders. The v1 signature took none and
produced one file.

Rules:

- **Class instances cannot cross.** Only `ManifestV2` and the other plain-data types move. The renderer
  calls `Timeline.fromJSON(doc)` on receipt and `timeline.toJSON()` before sending. In TypeScript a
  leaked instance is a compile error; in plain JS it was a silent runtime failure.
- **Every payload type is JSON-assignable**, enforced by a `type Json` constraint and re-checked by the
  architecture guard.
- **Main validates every input** before use, as today (`main.js:310`, `:319`, `:334`). Take ids stay
  restricted to `[a-zA-Z0-9._-]` (`lib/edit-manifest.js:47`); source ids resolve through the manifest and
  are never used as paths; every resolved path is asserted to live inside the take directory.
- **Two channels go main → renderer**: `ui.onMenuCommand` and `ui.onThemeChanged`. Both are exposed as
  subscribe functions returning an unsubscribe, never as raw emitters.
- **`ui.setCommandEnablement`** goes renderer → main on store-version changes, so the application menu
  greys the same items the toolbar greys. That is the last third of X2.

---

## 8. Build and gates

### 8.1 electron-vite

```ts
export default defineConfig({
  main:     { build: { rollupOptions: { external: [/* native deps */] } } },
  preload:  { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: { plugins: [react()], build: { rollupOptions: { input: 'src/renderer/index.html' } } },
})
```

electron-vite v5, electron-builder for packaging with `asarUnpack` for anything native, Vitest for
renderer unit tests.

### 8.2 Production loading and CSP

Dev: the Vite dev server with HMR. Production: a custom **`app://` scheme** via `protocol.handle`,
serving the built renderer from the asar. A bundled ESM renderer over `file://` has no proper origin for
`import()`/`fetch` and is flagged by Electron's own security guidance.

Media reaches the renderer over **`stem-media://<takeId>/<sourceId>`**, resolved in main through the
manifest and containment-checked against the take directory.

```
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' stem-media: data:;
media-src 'self' stem-media:;
font-src 'self';
connect-src 'self';
```

Two consequences: **Google Fonts must be self-hosted** (`renderer/index.html:7-9` breaks under
`font-src 'self'` — vendor IBM Plex in), and the inline `<style>` block at `index.html:10` moves into a
real stylesheet so `style-src` needs no `'unsafe-inline'`.

### 8.3 `scripts/check-architecture.ts`, rewritten

The current file greps for `require()` strings (`scripts/check-architecture.js:39-45`). Under `import`
syntax that check **silently passes everything** — it does not fail loudly, it stops testing.

- **Build the import graph from the TypeScript AST**, not from regex. `ts.preProcessFile` gives every
  import specifier per file, statically and cheaply, including `import type`, dynamic `import()` and
  re-exports.
- **Resolve specifiers to layers**: `renderer` · `main` · `preload` · `domain` · `node-lib` · `shared` ·
  `builtin` · `electron` · `external`.
- **Rules**, each with a stable id so a violation names the rule:

| id | rule |
|---|---|
| `R-RENDERER-IO` | `src/renderer/**` must not reach `electron`, `node:*`, `lib/node/**`, `src/main/**` |
| `R-DOMAIN-PURE` | `lib/domain/**` must not reach `node:*`, `electron`, `lib/node/**`, or any bare npm specifier |
| `R-DOMAIN-ERASABLE` | `lib/domain/**` and `scripts/**` contain no `enum`, `namespace`, parameter property, decorator, or `import x = require()` |
| `R-PRELOAD-THIN` | `src/preload/**` reaches only `electron` and type-only `src/shared/**` |
| `R-MAIN-NO-RENDERER` | `src/main/**` must not reach `src/renderer/**` |
| `R-WINDOW-HARDENED` | `src/main/window.ts` contains the three hardening flags |
| `R-CSP-PRESENT` | a CSP is installed for the app scheme |
| `R-IPC-DECLARED` | every `exposeInMainWorld` key appears in `StudioApi` |
| `R-HTML-GRAPH` | `src/renderer/index.html` has no `<script src>` outside the Vite graph |
| `R-PREFLIGHT-WIRED` | every `scripts/smoke-*.ts` appears in `scripts/preflight.ts` |
| `R-NO-RAW-HEX` | no hex colour literal in `src/renderer/**` outside `styles/tokens.css` |

`R-PREFLIGHT-WIRED` is strengthened from the draft's "`package.json` defines `scripts.preflight`" to
"every smoke is actually wired", because §1.9 is exactly the failure the weak version permits.

**Proving it fails on a deliberate violation.** `scripts/fixtures/arch-violations/` holds one small file
per rule, each containing exactly that violation, excluded from every tsconfig `include`.
`check-architecture --self-test` runs the rule engine over each fixture and asserts it reports **that
rule id and only that rule id**; a fixture that produces no finding, or the wrong finding, fails the
run. Preflight runs `--self-test` **before** the real pass, so the guard proves itself red on every run
rather than once in a PR nobody re-reads.

### 8.4 Waveform PNG

`lib/node/waveform-png.ts` renders, per source and per zoom slice, a PNG via ffmpeg `showwavespic`,
cached under `edit/.cache/wave-<sourceId>/<zoomLevel>-<sliceIndex>.png`, keyed on source hash + mtime +
slice, exactly like the existing filmstrip cache (`lib/media-cache.js:44-48`).

**Render it as a white-on-transparent mask, not a coloured image.** The renderer applies it as a CSS
`mask-image` over `background: var(--waveform)`. The PNG is then theme-independent: one cache, no
regeneration, no stale-colour bug when the theme flips. Passing the resolved colour into main instead
doubles the cache and reintroduces the "canvas ignores CSS variables" problem.

### 8.5 What `npm run preflight` runs, in order

1. `tsc --noEmit` across all project references. Native stripping deletes annotations without checking
   them — without this step TypeScript is decorative.
2. `check-architecture --self-test`
3. `check-architecture`
4. Domain smokes, bare `node`, no `node_modules`: `smoke-timeline-invariants` · `smoke-commands` ·
   `smoke-linked-move` · `smoke-push-plan` · `smoke-migrate-v1v2` · `smoke-undo` · `smoke-keymap` ·
   `smoke-audio-route` · `smoke-outputs` · `smoke-gaps` · `smoke-captions` · `smoke-captions-karaoke` ·
   `smoke-export-presets` · **`smoke-export-bundle`** (§1.9 — newly wired) · `smoke-apply-args` ·
   `smoke-pip` · `smoke-freeze` · `smoke-export`
5. I/O smokes: `smoke-thumbs` · `smoke-waveform-png` · `smoke-transcribe` · `smoke-caption-integration`
6. `vitest run` — renderer unit tests
7. `smoke-apply`, still skipped unless `STEM_OUT_ROOT` is set (`scripts/preflight.js:31`)

Fail-fast with real per-step exit codes, as today (`scripts/preflight.js:43-49`).

**Surviving unchanged** (only import path and extension move): `smoke-captions` ·
`smoke-captions-karaoke` · `smoke-export-presets` · `smoke-export-bundle` · `smoke-gap-chips` ·
`smoke-thumbs` · `smoke-transcribe` · `smoke-caption-integration`.

**Changing**: `smoke-apply-args` · `smoke-apply` · `smoke-freeze` · `smoke-export` · `smoke-pip` gain a
v2-plan builder in front of them; their assertions on argument vectors are untouched, which is what
makes them usable as the migration's proof.

**`smoke-clip-ops.js`**: its 110 assertions are ported onto the class API before it retires (§1.11). It
stays green against a v1-compat shim until `smoke-migrate-v1v2` and the ported assertions are both
green, then it is deleted in the same PR that lands the port.

---

## 9. Theming, keyboard, menus

### 9.1 Three theme states (R7)

System / Light / Dark, chosen in Settings and persisted in `app.getPath('userData')/settings.json` by
`lib/node/settings-store.ts` — not `localStorage`, because main must read it **before the window
exists**. Two states would mean deliberately ignoring the OS, which is not what a desktop app does.

Sequence, and the order matters:

1. `app.whenReady()` → read `settings.json`
2. `nativeTheme.themeSource = stored` — **before** `new BrowserWindow`. Chromium then drives
   `prefers-color-scheme` in the renderer for free
3. `new BrowserWindow({ backgroundColor: resolvedThemeSurface })` — replacing the hardcoded `'#f6f4ef'`
   at `main.js:100`
4. pass the resolved theme via `webPreferences.additionalArguments`; the preload reads it from
   `process.argv` and writes `document.documentElement.dataset.theme` at document-start, before first
   paint. Preload has DOM access under `contextIsolation`, so this needs no inline script and no CSP
   exemption
5. `nativeTheme.on('updated')` → `ui.onThemeChanged` → the renderer updates `data-theme`

### 9.2 Tokens

`src/shared/tokens.ts` is the single source; a build step emits `src/renderer/styles/tokens.css`, so CSS
and JS cannot disagree.

- **Raw ramp**: `--gray-0 … --gray-12`, `--gold-1 … --gold-6`, `--red-*`, `--green-*`. Never referenced
  by a component.
- **Semantic aliases**, the only thing components read: `--surface` · `--surface-raised` ·
  `--surface-sunken` · `--text` · `--text-muted` · `--border` · `--accent` · `--accent-soft` · `--ok` ·
  `--warn` · `--clip-video` · `--clip-audio` · `--clip-selected` · `--clip-disabled` · `--playhead` ·
  `--waveform` · `--filmstrip-bg` · `--chip-gap` · `--chip-retake` · `--ruler-tick` · `--track-header` ·
  `--dropzone`.

```css
:root                                   { /* light values for every alias */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])       { /* dark overrides */ }
}
:root[data-theme="dark"]                { /* dark overrides */ }
```

Every alias is defined in the bare `:root` block; the dark blocks only redefine. No colour gets its only
definition inside a media query.

`smoke-theme-tokens` asserts: every semantic alias resolves in all three states · **zero hex literals
anywhere in `src/renderer/**` outside `tokens.css`** (§1.10 — the gate covers every renderer file, not
one stylesheet) · `tokens.css` is byte-identical to what `tokens.ts` generates.

### 9.3 Cursor affordance (R8)

An enforceable rule, not a sweep: **interactive elements are `<button>`, `<a>`, or carry `role` +
`tabindex`**, and one base stylesheet rule gives `cursor: pointer` to
`button, a, [role="button"], [role="menuitem"], summary, label[for]`, plus explicit cursors for the
timeline's own affordances (`col-resize` on trim handles, `grab`/`grabbing` on clips, `ew-resize` on the
playhead). `jsx-a11y/no-noninteractive-element-interactions` fails the build when a `div` grows an
`onClick`. That is what makes R8 stay fixed instead of regressing.

### 9.4 One keymap registry (R16)

```ts
type Binding = {
  commandId: CommandId
  label: string
  accelerator: string | null
  keys: string[]
  menu: 'File' | 'Edit' | 'View' | 'Timeline' | 'Help' | null
  scope: 'app' | 'renderer'
}
```

`smoke-keymap.ts` asserts: no accelerator or bare key bound twice · every `commandId` resolves to a
registered command · every command with a menu entry has a `label` identical to the command's `label`,
so toolbar, menu and context menu cannot drift apart in naming.

**The split rule.** Anything with a modifier is an application-menu accelerator (`scope: 'app'`) —
macOS handles it natively, it works regardless of focus, and it is discoverable by opening the menu.
Bare keys and arrows are renderer handlers (`scope: 'renderer'`), because menus cannot carry
bare-letter accelerators without stealing every keystroke.

| Keys | Command | Scope |
|---|---|---|
| `Space` | play / pause | renderer |
| `J` / `K` / `L` | shuttle back / pause / shuttle forward | renderer |
| `I` / `O` | mark in / mark out | renderer |
| `←` / `→` | nudge playhead **10 ms** | renderer |
| `Shift+←` / `Shift+→` | nudge playhead **1 s** | renderer |
| `,` / `.` | nudge selected clips 10 ms | renderer |
| `Shift+,` / `Shift+.` | nudge selected clips 1 s | renderer |
| `↑` / `↓` | previous / next edit point | renderer |
| `N` | snapping toggle; hold during a drag inverts it momentarily | renderer |
| `M` | add marker | renderer |
| `Shift+Z` | zoom to fit | renderer |
| `Cmd+B` | **Split** | app · Timeline |
| `Cmd+Shift+B` | **Join** | app · Timeline |
| `Delete` / `Backspace` | **Ripple delete** | renderer |
| `Shift+Delete` | **Lift** | renderer |
| `Cmd+Z` / `Cmd+Shift+Z` | undo / redo | app · Edit |
| `Cmd+A` / `Cmd+Shift+A` | select all / deselect | app · Edit |
| `Cmd+C` / `Cmd+X` / `Cmd+V` | copy / cut / paste clips | app · Edit |
| `Cmd+Opt+C` / `Cmd+Opt+V` | copy / paste attributes | app · Edit |
| `Cmd+G` / `Cmd+Shift+G` | group / ungroup | app · Timeline |
| `Cmd+Shift+D` | toggle clip enabled | app · Timeline |
| `Cmd+=` / `Cmd+-` | zoom in / out | app · View |
| `Cmd+E` / `Cmd+Shift+E` | export selected clips / export range | app · File |
| `Cmd+I` | import media | app · File |
| `Cmd+S` | save | app · File |
| `Cmd+,` | settings | app · Stem Studio |
| `Cmd+/` | shortcuts dialog | app · Help |

`Cmd+B` for split matches CapCut on Mac — the tool in the founder's own reference screenshots — and
Final Cut. Ripple-by-default inverts Resolve and Premiere: a logged, intentional choice for a recorder
where a gap is almost always accidental dead air. Today's bare `S` / `B` split (`studio.js:2059`) is
**retired**, and that is a behaviour change worth naming out loud.

**The typing guard.** Renderer handlers bail when `document.activeElement` matches
`input, textarea, select, [contenteditable=""], [contenteditable="true"]`, or when `event.isComposing`
is true (IME). Today's check tests `tagName` only (`studio.js:2028-2029`) and misses both. For
application-menu accelerators the renderer pushes `ui.setTyping(true|false)` on focus change; main
disables the destructive Timeline items while a field has focus, so `Cmd+B` in a text field does nothing
rather than splitting a clip behind the dialog.

### 9.5 Menus (M1, M2)

There is no application menu today. `Menu.buildFromTemplate` is built in `src/main/menu.ts` from the
keymap registry, with submenus `Stem Studio` / `File` / `Edit` / `View` / `Timeline` / `Help`. The first
submenu carrying the app name is also the fix for M1: `app.setName()` already runs (`main.js:47`) and
`productName` is set (`package.json:3`), but on macOS an unpackaged `electron .` reads the bundle
`Info.plist` and always shows "Electron". A custom template's first submenu overrides that, so M1 comes
free with work M2 requires anyway.

Item enablement comes from `ui.setCommandEnablement`, pushed on every store version change.

### 9.6 Context menus (X1–X4)

Four menus, chosen by what the pointer hit and what is selected:

- **Clip** (X3): Copy · Cut · Paste · Copy attributes · Paste attributes · — · Split · Join · Delete
  (ripple) · Lift · — · Group / Ungroup · Move into sync · Slip into sync · — · Extract audio · Use as
  audio source · Transcript · — · Deactivate clip · Export selected clips · Open file location
- **Track header**: Rename · Mute · Hide · Lock · Show waveform · Add track above/below · Remove track
- **Gap**: Close gap (ripple) · Select clips either side · Mark range
- **Empty timeline**: Paste · Add track · Import media · Select all · Zoom to fit

Every item is greyed rather than hidden when unavailable (A8), with the `check()` error message as its
tooltip, and shows its accelerator inline.

**Refused (X4)**, and the refusals are load-bearing: split scenes / AI scene detection · compound clips
and multi-camera (the model deliberately does not nest) · save preset · edit effects with variable-speed
animation · a Render submenu (Stem has Apply) · Link to media / relinking (media lives in the take
folder) · Trim & Replace clip.

**Solo, if it ships at all, is monitor-only.** It affects preview, never export. Resolve's
render-affecting solo is a genuine footgun — a soloed track silently producing a one-track export is
unrecoverable after upload.

---

## 10. R18 — overlays, deliberately unresolved

The founder asked for overlays on video and asked for research. **That research is outstanding and no
design is invented here.**

What is known: the request is "overlays on video". What is not known, and what must be answered before a
slice can be specified:

- **Which primitives.** Text, logo/watermark, shapes, lower-thirds, images — these are four or five
  different subsystems with very different costs. A watermark is one ffmpeg `overlay` filter. Editable
  text with per-character timing is a vector-editing surface with its own selection model, its own undo
  interactions, and its own render path.
- **Whether overlays are timeline objects or clip effects.** As `Effect` entries they inherit the
  existing stack, undo and signature machinery for free. As their own track type they can outlive a clip
  and span an edit, which is what a lower-third usually wants.
- **Whether they are per-output.** A watermark positioned for 16:9 is in the wrong place in 9:16, so
  overlays interact with R19/R20 directly.

The model leaves room without paying for it: an overlay as an `Effect` variant needs no schema change,
and an overlay track needs one `Track.kind`. Nothing in slices V1–V18 forecloses either answer. This is
tracked as a deferred slice with the unknown named, not as a slice with an invented scope.

---

## 11. Conflicts still open

Named rather than papered over.

1. **A7 vs A6.** The founder's reference clip headers read `screen.mp4  00:02:54:15` — frame timecode.
   A7 is decided as `mm:ss.mmm`, so the clip header reads `screen.mp4 · 2:54.625`. The decision wins;
   this is a real disagreement between a requirement's reference image and a requirement's decision, and
   it is recorded so it is not read later as an oversight.
2. **Per-clip effects vs the export planner.** The model expresses per-clip crop from the first model
   slice, but `applyClips` throws on non-uniform crops (`lib/ffmpeg-util.js:435-439`). Until the export
   slice lands, the renderer must not offer per-clip crop: the inspector applies crop to the whole
   selection and the export planner returns `Err('MIXED_EFFECTS')` if it ever sees a mixed take.
3. **CFR at capture.** Research calls variable-frame-rate screen capture against clock-locked audio
   "guaranteed progressive desync past ~30 min" and classes it table stakes. **It is not one of the
   founder's requirements.** It is an ffmpeg flag in the capture slice and is nearly free while that
   slice is open. Founder call — it is listed as uncovered in the plan set rather than smuggled in.
4. **Music ducking and loudness normalisation.** Stem ships a music bed with no ducking, which research
   calls a defect rather than a gap (`musicMixGraph`, `lib/ffmpeg-util.js:233`, mixes at a fixed gain
   with no sidechain). Also not a founder requirement. Same treatment.
5. **The mp3 audio stem.** `main.js:70-77` writes `audio.mp3`. mp3 carries encoder delay and padding, so
   cutting introduces small offsets and clicks and there is no exact grid. WAV or AAC at capture removes
   a class of sync bug. Not a founder requirement; cheap during the capture slice.
6. **Auto-zoom's render path.** Animating a crop rect over time in ffmpeg (`zoompan`, or `crop` with
   time expressions) is real design work. The model side is settled (`Animatable<Rect>`); the render side
   warrants its own short spec before that slice starts.
7. **Electron main and `.ts`.** Verified for the `node` CLI (v24.18.0), unverified for Electron's own
   main-process loader. The design does not depend on the answer — electron-vite builds main regardless.
8. **Stale install.** Electron 37.10.3 in `node_modules` against `^41.10.5` declared. Re-measure
   anything Electron-version-dependent after a clean install.

---

## Open loops

- **R18 scope is unresolved** (§10). Research outstanding. No slice can be specified until the primitive
  set and the timeline-object-vs-effect question are answered.
- **Four table-stakes items are not founder requirements and are therefore not in any slice**: CFR at
  capture, music ducking, loudness normalisation, and WAV/AAC instead of mp3 for the mic stem. Each is
  cheap only while the capture slice is open. Founder call on whether to widen that slice.
- **The ~21,000-node measurement, and every other Electron-version-dependent figure, needs re-measuring
  after a clean `npm install`.** The tree used for the original measurement had Electron 37.10.3 against
  a declared `^41.10.5`.
- **The Premiere column in the keyboard research is secondary-sourced only** — `helpx.adobe.com` was
  unreachable from the research environment on every path. Ripple-delete, nudge and Extract/Lift each
  rest on a single third-party source. It does not change any decision taken here, because none of them
  follows Premiere.
- **`take-demo-edit-t1` and `take-thumbs` are fixture takes**, not recordings. They were included in the
  §1.1 audio census because they are what is on disk; `take-thumbs` is the only source there with no
  audio stream, which makes it the natural fixture for the `hasAudio: false` branch.
- **Whether `Solo` ships at all** is unspecified. If it does, it is monitor-only (§9.6). No requirement
  asks for it.
