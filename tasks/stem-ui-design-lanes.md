# Stem Studio · design-loop UX ledger (fleet)

**Mode:** design-loop → screenshot UX-audit (applicable subset) → orchestrating-lanes autonomous  
**Source skill:** `traxelio-app/.claude/skills/design-loop` (Sites/traxelio ecosystem)  
**Surface:** Stem Studio Electron Edit (+ Record/Library where noted)  
**Snapshot:** 2026-08-15T19:35:00Z  
**Authority:** founder — Selection **sidebar to the left**; design findings → ledger → fleet; merge when preflight passes

## Applicable vs skipped (design-loop)

| Design-loop piece | Stem applicability |
|---|---|
| Screenshot UX-audit mode | **Yes** — built Edit surface |
| 4-lane tribunal (heuristics / flow / a11y / evidence) | **Yes** — findings below |
| Findings → fix lanes | **Yes** — this ledger |
| Prototype boards / mobile tokens / Expo snap | **Skip** — desktop Electron; no `theme.js` |
| Cross-surface mobile+backend presentation | **Skip** — single desktop app |
| Capture fidelity | **Downgraded to code+structure audit** — window capture blocked in agent env; re-harvest with real snaps when founder walks Edit |

## Journey (Edit) — ASCII until captures land

```
Library → open take → Edit
  → preview (screen|cam) + Selection (In/Out, wave, clips, transcript)
  → timeline tools (split/freeze/crop/PiP/…)
  → Apply → final.mp4
Degrade: no cam → PiP/Mirror/Rotate disabled; no VTT → burn skips; no libass → burn skips w/ status
```

## Verdict (Edit surface)

**pass-with-conditions** — CapCut-like loop is completable; chrome density + panel side + light/dark split need fix lanes before any HERO-GRADE marketing stills.

## Findings → fix lanes

| id | sev | lane | heuristic / note | Done when |
|---|---|---|---|---|
| `stem-ui-sidebar-left` | **done** | Layout | #21 → `42160ec` Selection left of preview | Selection leftmost; preflight |
| `stem-ui-toolbar-overflow` | major | Heuristics / minimalist | Timeline toolbar is a flat strip of 15+ actions — recognition fail, hard to scan. Group: Transport \| Edit \| Cam \| Captions/Export; overflow “More”. | Primary actions visible; secondary in menu; preflight |
| `stem-ui-chrome-theme` | **done** | Consistency | #22 → `bc91b16` Edit view is one dark shell: vars re-scoped on `#view-edit` (cards `#1a1f2a`, shell `#12161f`, gold accent); Record/Library stay light. `:where()` overrides keep toolbar/wave/crop rules untouched. | Edit view one cohesive theme; no mixed panel skins |
| `stem-ui-edit-lead` | minor | Minimalist | Edit lead paragraph teaches CapCut pause recipe in the header — noisy. Move to first-run tip or help popover. | Header = title + back only (or one short line) |
| `stem-ui-status-prominence` | minor | System status | `#editStatus` easy to miss for Apply skips (libass, missing music/VTT). Pin status near Apply or toast. | Skip/ok reasons visible at Apply |
| `stem-ui-a11y-targets` | polish | Touch/a11y | Wave ± and dense toolbar buttons likely &lt;44px. Bump hit targets / padding. | Targets ≥44px where practical |
| `stem-ui-capture-pass` | polish | Evidence | Re-run audit with real Edit screenshots (happy + busy: long transcript, PiP on, freeze selected) once sidebar+theme land; tag HERO-GRADE. | Captures in `.tasks/` + ledger update |

## Graph

```
stem-ui-sidebar-left [LEAF · FIRST]
    └──► stem-ui-chrome-theme [DONE · #22 · bc91b16]
    └──► stem-ui-toolbar-overflow [ready · may collide studio.js/index]
    └──► stem-ui-edit-lead [ready · light]
stem-ui-status-prominence [ready · light · after sidebar]
stem-ui-a11y-targets [queued · after toolbar]
stem-ui-capture-pass [queued · after majors]
```

## Capacity

`renderer/index.html` + `timeline.css` + `studio.js`: **1** Stem UI implementer.

## Stop

Majors closed (sidebar, theme, toolbar) OR founder says stop. Minors/polish can trail.
