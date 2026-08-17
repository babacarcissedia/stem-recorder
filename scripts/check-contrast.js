#!/usr/bin/env node
'use strict';

/**
 * WCAG 2.2 contrast gate over the semantic token pairs the stylesheets actually
 * paint. Thresholds are unrounded: 2.999 fails 3:1.
 *
 * Nothing in tokens.css records that --timeline-text-faint is ever painted on
 * --timeline-surface, so PAIRS is hand-derived and every entry cites the
 * declaration that pairs them. A pair earns its place by appearing as a
 * co-located color/background in one rule, or as a color whose nearest
 * background-bearing ancestor is named in `where`.
 *
 * rgba() literals are excluded: this token-only gate cannot calculate their
 * composited color against an arbitrary underlying surface.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOKENS = path.join(ROOT, 'src/renderer/src/tokens.css');

const THRESHOLDS = { normal: 4.5, large: 3, ui: 3 };

const PAIRS = [
  ['text-primary', 'surface-app', 'normal', 'index.html:10 body, app-shell.css:1 .shell-root'],
  ['text-muted', 'surface-app', 'normal', 'index.html:19 p.lead in body'],
  ['text-primary', 'surface-raised', 'normal', 'index.html:90 button.secondary'],
  ['text-muted', 'surface-raised', 'normal', 'index.html:82 label in .panel:74'],
  ['text-primary', 'surface-subtle', 'normal', 'index.html:106 .toggle span in .toggle:103'],
  ['text-muted', 'surface-subtle', 'normal', 'index.html:107 .toggle small in .toggle:103'],
  ['positive', 'surface-subtle', 'normal', 'index.html:116 .takes a'],
  ['accent', 'timeline-surface-sunken', 'normal', 'index.html:253 .cue-time in .cue-row, timeline.css:610 .cue-row background'],
  ['text-on-accent', 'accent-soft', 'normal', 'index.html:88 button'],
  ['text-muted', 'accent-soft', 'normal', 'timeline.css:543 .clip-meta span in .clip-row.selected:540'],
  ['warn', 'negative-surface', 'normal', 'index.html:91 button.danger'],
  ['surface-raised', 'record-surface', 'normal', 'index.html:93 button.rec'],
  ['timeline-text', 'surface-control', 'normal', 'timeline.css:61 .tl-toolbar button'],
  ['text-primary', 'surface-control', 'normal', 'timeline.css:707 in :705'],
  ['text-primary', 'surface-sunken', 'normal', 'timeline.css:719 in :718'],
  ['accent-foreground', 'accent', 'normal', 'timeline.css:39 .preview-switch button.active, timeline.css:69 .tl-toolbar button.primary, timeline.css:685 .crop-actions button.primary, index.html:243 .ctx-menu button:hover'],
  ['negative-on-surface', 'negative-surface', 'normal', 'timeline.css:75 .tl-toolbar button.danger'],
  ['positive-text', 'positive-surface', 'normal', 'timeline.css:81 .tl-toolbar button.on'],
  ['timeline-text-muted', 'clip-gap-a', 'normal', 'timeline.css:577 .asr-provider button'],
  ['menu-text', 'menu-surface', 'normal', 'index.html:239 .ctx-menu button in .ctx-menu:234'],
  ['menu-text-disabled', 'menu-surface', 'normal', 'index.html:243 .ctx-menu button:disabled'],
  ['timeline-text', 'timeline-track', 'normal', 'timeline.css:265 .tl-lane-meta strong in .timeline-shell:180'],
  ['timeline-text-muted', 'timeline-track', 'normal', 'timeline.css:260 .tl-lane-meta in .timeline-shell:180'],
  ['timeline-text-muted', 'timeline-surface', 'normal', 'timeline.css:100 .tl-time in .tl-toolbar:48'],
  ['text-muted', 'timeline-surface-sunken', 'normal', 'timeline.css:543 .clip-meta span in .clip-row:534'],
  ['text-primary', 'timeline-surface-sunken', 'normal', 'timeline.css:628 .cue-text in .cue-row:610'],
  ['chip-text', 'chip-gap', 'normal', 'timeline.css:232 .tl-chip.gap:235'],
  ['chip-text', 'chip-retake', 'normal', 'timeline.css:232 .tl-chip.retake:236'],
  ['text-on-dark', 'clip-default-top', 'normal', 'timeline.css:318 .tl-clip gradient index.html:199'],
  ['text-on-dark', 'clip-default-bottom', 'normal', 'timeline.css:318 .tl-clip gradient index.html:199'],
  ['text-on-dark', 'clip-screen-top', 'normal', 'timeline.css:318 over .tl-clip.screen:322'],
  ['text-on-dark', 'clip-screen-bottom', 'normal', 'timeline.css:318 over .tl-clip.screen:322'],
  ['text-on-dark', 'clip-cam-top', 'normal', 'timeline.css:318 over .tl-clip.cam:326'],
  ['text-on-dark', 'clip-cam-bottom', 'normal', 'timeline.css:318 over .tl-clip.cam:326'],
  ['text-on-dark', 'clip-audio-top', 'normal', 'timeline.css:318 over .tl-clip.audio:330'],
  ['text-on-dark', 'clip-audio-bottom', 'normal', 'timeline.css:318 over .tl-clip.audio:330'],
  ['text-on-dark', 'clip-selected-top', 'normal', 'timeline.css:318 over .tl-clip.freeze:345'],
  ['text-on-dark', 'clip-selected-bottom', 'normal', 'timeline.css:318 over .tl-clip.freeze:345'],
  ['text-muted', 'wave-surface-top', 'normal', 'timeline.css:500 .wave-panel-empty in .wave-panel:479'],
  ['text-muted', 'wave-surface-bottom', 'normal', 'timeline.css:500 .wave-panel-empty in .wave-panel:479'],
  ['accent', 'accent-muted-surface', 'normal', 'timeline.css:691 #cropBtn.on'],

  ['border-subtle', 'surface-raised', 'ui', 'index.html:74 .panel border'],
  ['border-subtle', 'surface-app', 'ui', 'timeline.css:697 #view-edit border'],
  ['border-subtle', 'surface-sunken', 'ui', 'index.html:31 .stage-wrap border, timeline.css:712 #view-edit .stage-wrap border'],
  ['border-subtle', 'timeline-track', 'ui', 'timeline.css:181 .timeline-shell border'],
  ['border-strong', 'surface-control', 'ui', 'timeline.css:60 .tl-toolbar button border'],
  ['border-strong', 'surface-control-hover', 'ui', 'timeline.css:106 #tlMoreBtn expanded, timeline.css:521,527 wave zoom buttons hovered'],
  ['border-strong', 'surface-raised', 'ui', 'index.html:84 select border'],
  ['border-strong', 'surface-subtle', 'ui', 'index.html:119 .takes a border'],
  ['border-strong', 'clip-gap-a', 'ui', 'timeline.css:147 .tl-more-row.asr-provider button border, timeline.css:576 button background'],
  ['border-strong', 'positive-surface', 'ui', 'timeline.css:565 ASR provider border around active child at timeline.css:581'],
  ['border-strong', 'timeline-surface-sunken', 'ui', 'timeline.css:611 .cue-row border'],
  ['surface-raised', 'timeline-track', 'ui', 'timeline.css:431 playhead over timeline track'],
  ['surface-raised', 'timeline-surface-sunken', 'ui', 'timeline.css:440 playhead cap over sunken timeline surface'],
  ['surface-stage-border', 'surface-stage', 'ui', 'index.html:39 .stage border'],
  ['surface-control-hover', 'menu-surface', 'ui', 'index.html:235 .ctx-menu border'],
  ['timeline-border', 'timeline-surface', 'ui', 'timeline.css:50 .tl-toolbar border'],
  ['wave-border', 'wave-surface-top', 'ui', 'timeline.css:480 .wave-panel border over gradient top'],
  ['wave-border', 'wave-surface-bottom', 'ui', 'timeline.css:480 .wave-panel border over gradient bottom'],
  ['focus-ring', 'surface-app', 'ui', 'affordance.css:53 :focus-visible outline, offset 2px onto the page'],
  ['focus-ring', 'surface-raised', 'ui', 'affordance.css:53 outline on panel-hosted controls and app-shell.css:10 .shell-route'],
  ['focus-ring', 'timeline-surface', 'ui', 'affordance.css:53 outline on .tl-toolbar:48 controls'],
  ['focus-ring', 'timeline-track', 'ui', 'affordance.css:53 outline on timeline chips and reveal controls over timeline.css:180'],
  ['focus-ring', 'wave-surface-top', 'ui', 'affordance.css:53 outline on timeline.css:513 wave zoom controls'],
  ['focus-ring', 'wave-surface-bottom', 'ui', 'affordance.css:53 outline on timeline.css:513 wave zoom controls'],
  ['focus-ring', 'menu-surface', 'ui', 'affordance.css:53 outline on .ctx-menu:234 items'],
  ['accent', 'surface-raised', 'ui', 'index.html:232 .transcript-panel.flash outline'],
  ['accent', 'surface-sunken', 'ui', 'index.html:259 .cue-edit input border, timeline.css:726 background'],
  ['accent', 'accent-soft', 'ui', 'timeline.css:539 .clip-row.selected border'],
  ['accent-muted-border', 'accent-soft', 'ui', 'timeline.css:617 .cue-row:hover border on :618'],
  ['accent-soft-border', 'accent-soft', 'ui', 'index.html:89 button border'],
  ['accent-soft-border', 'surface-raised', 'ui', 'index.html:91 button.secondary border'],
  ['accent-strong', 'accent', 'ui', 'timeline.css:68 .tl-toolbar button.primary border'],
  ['positive-border', 'positive-surface', 'ui', 'timeline.css:80 .tl-toolbar button.on border'],
  ['negative-border', 'negative-surface', 'ui', 'timeline.css:74 .tl-toolbar button.danger border'],
  ['negative-surface', 'negative-surface', 'ui', 'index.html:130 .secure-warn border'],
  ['record-border', 'record-surface', 'ui', 'index.html:94 button.rec border'],
  ['clip-outline', 'clip-screen-top', 'ui', 'timeline.css:351 .tl-clip.selected border over screen gradient'],
  ['clip-outline', 'clip-screen-bottom', 'ui', 'timeline.css:351 .tl-clip.selected border over screen gradient'],
  ['clip-outline', 'clip-cam-top', 'ui', 'timeline.css:351 .tl-clip.selected border over cam gradient'],
  ['clip-outline', 'clip-cam-bottom', 'ui', 'timeline.css:351 .tl-clip.selected border over cam gradient'],
  ['clip-outline', 'clip-audio-top', 'ui', 'timeline.css:351 .tl-clip.selected border over audio gradient'],
  ['clip-outline', 'clip-audio-bottom', 'ui', 'timeline.css:351 .tl-clip.selected border over audio gradient'],
  ['clip-outline', 'clip-selected-top', 'ui', 'timeline.css:351 .tl-clip.selected border over freeze gradient'],
  ['clip-outline', 'clip-selected-bottom', 'ui', 'timeline.css:351 .tl-clip.selected border over freeze gradient'],
  ['clip-wave', 'clip-audio-top', 'ui', 'timeline.css:390 .tl-clip .wave b over .tl-clip.audio:330'],
  ['clip-wave', 'clip-audio-bottom', 'ui', 'timeline.css:390 .tl-clip .wave b over .tl-clip.audio:330'],
];

// Seeded from the first run of this gate. Each floor is the unrounded measured
// ratio, so a grandfathered pair cannot regress while it remains below WCAG.
const BASELINE_EXCEPTIONS = new Map([
  ['light|accent-muted-border|accent-soft', 1.1649718085572776],
  ['light|accent-soft-border|accent-soft', 1.1649718085572776],
  ['light|accent-soft-border|surface-raised', 1.483181081029539],
  ['light|accent-strong|accent', 1.4089921851754046],
  ['light|border-strong|clip-gap-a', 2.9866232499023737],
  ['light|border-subtle|surface-app', 1.3688636519559692],
  ['light|border-subtle|surface-raised', 1.5046206661919197],
  ['light|border-subtle|surface-sunken', 1.2097594857063192],
  ['light|border-subtle|timeline-track', 1],
  ['light|menu-text-disabled|menu-surface', 4.3624051910043535],
  ['light|negative-border|negative-surface', 1.2020156319772222],
  ['light|negative-surface|negative-surface', 1],
  ['light|record-border|record-surface', 1.3860806766780116],
  ['light|surface-control-hover|menu-surface', 1.2437353738238686],
  ['light|surface-raised|timeline-surface-sunken', 1.1989288029432743],
  ['light|surface-raised|timeline-track', 1.5046206661919197],
  ['light|surface-stage-border|surface-stage', 1.315580450768191],
  ['light|timeline-border|timeline-surface', 1.2097594857063192],
  ['light|timeline-text-muted|clip-gap-a', 2.2133039091944253],
  ['light|timeline-text-muted|timeline-track', 3.9123560303668827],
  ['light|warn|negative-surface', 4.266730447239321],
  ['light|wave-border|wave-surface-top', 1.2097594857063192],
  ['light|wave-border|wave-surface-bottom', 1.2549708227028964],
  ['dark|accent-muted-border|accent-soft', 2.0709432023240306],
  ['dark|accent-soft-border|accent-soft', 2.5600715340498503],
  ['dark|accent-strong|accent', 1.3404854894308253],
  ['dark|border-strong|surface-control-hover', 2.7711041571601007],
  ['dark|border-strong|positive-surface', 2.6758942337022837],
  ['dark|border-subtle|surface-app', 1.3891658179548516],
  ['dark|border-subtle|surface-raised', 1.2657994443512934],
  ['dark|border-subtle|surface-sunken', 1.4712335591628987],
  ['dark|border-subtle|timeline-track', 1.4712335591628987],
  ['dark|menu-text-disabled|menu-surface', 3.271509693653111],
  ['dark|negative-border|negative-surface', 1.3726098416063528],
  ['dark|negative-surface|negative-surface', 1],
  ['dark|positive-border|positive-surface', 1.5678184328989055],
  ['dark|record-border|record-surface', 1.3860806766780116],
  ['dark|surface-control-hover|menu-surface', 1.542322647928917],
  ['dark|surface-raised|record-surface', 3.5165446476705915],
  ['dark|surface-raised|timeline-surface-sunken', 1.056292494845051],
  ['dark|surface-raised|timeline-track', 1.1622959432699764],
  ['dark|surface-stage-border|surface-stage', 1.315580450768191],
  ['dark|timeline-border|timeline-surface', 1.3009407431374673],
  ['dark|wave-border|wave-surface-top', 1.3460354786155893],
  ['dark|wave-border|wave-surface-bottom', 1.4145452698812746],
]);

function blocks(source) {
  const cut = (start, end) => source.slice(start, end === -1 ? undefined : end);
  const lightStart = source.indexOf(':root,');
  const darkStart = source.indexOf(':root[data-theme="dark"]');
  return {
    base: cut(source.indexOf(':root {'), lightStart),
    light: cut(lightStart, darkStart),
    dark: cut(darkStart, -1),
  };
}

function declarations(block) {
  const map = new Map();
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) map.set(match[1], match[2].trim());
  return map;
}

function resolve(name, theme, base, seen = new Set()) {
  const key = `--${name}`;
  if (seen.has(key)) throw new Error(`cycle resolving ${key}`);
  seen.add(key);
  const value = theme.get(key) ?? base.get(key);
  if (value === undefined) throw new Error(`${key} is defined in neither the theme block nor :root`);
  const reference = value.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
  if (reference) return resolve(reference[1], theme, base, seen);
  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (!hex) throw new Error(`--${name} resolves to "${value}", which is not a six-digit hex`);
  return hex[1];
}

function channel(component) {
  const srgb = component / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((offset) => channel(parseInt(hex.slice(offset, offset + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function exceptionStatus(ratio, threshold, baseline) {
  if (ratio >= threshold) return baseline === undefined ? 'passes' : 'stale';
  if (baseline === undefined) return 'below-threshold';
  return ratio < baseline ? 'regressed' : 'grandfathered';
}

function selfTest() {
  const baseline = BASELINE_EXCEPTIONS.get('light|wave-border|wave-surface-top');
  if (baseline !== 1.2097594857063192) throw new Error('contrast self-test baseline changed');
  if (exceptionStatus(baseline - 0.01, THRESHOLDS.normal, baseline) !== 'regressed') {
    throw new Error('contrast self-test did not reject a degraded grandfathered pair');
  }
  if (exceptionStatus(baseline, THRESHOLDS.normal, baseline) !== 'grandfathered') {
    throw new Error('contrast self-test did not retain its recorded floor');
  }
  if (exceptionStatus(THRESHOLDS.normal, THRESHOLDS.normal, baseline) !== 'stale') {
    throw new Error('contrast self-test did not reject a stale exception');
  }

  const newBaseline = BASELINE_EXCEPTIONS.get('dark|border-strong|surface-control-hover');
  if (newBaseline !== 2.7711041571601007) throw new Error('contrast self-test new baseline changed');
  if (exceptionStatus(newBaseline - 0.01, THRESHOLDS.ui, newBaseline) !== 'regressed') {
    throw new Error('contrast self-test did not reject a degraded new floor');
  }
  if (exceptionStatus(THRESHOLDS.ui, THRESHOLDS.ui, newBaseline) !== 'stale') {
    throw new Error('contrast self-test did not reject a stale new floor');
  }
}

selfTest();

const source = fs.readFileSync(TOKENS, 'utf8');
const parsed = blocks(source);
const base = declarations(parsed.base);
const themes = { light: declarations(parsed.light), dark: declarations(parsed.dark) };

const failures = [];
const stale = [];
const measuredExceptions = new Set();
let measured = 0;
let allowed = 0;

for (const [name, theme] of Object.entries(themes)) {
  for (const [fg, bg, size, where] of PAIRS) {
    const ratio = contrast(resolve(fg, theme, base), resolve(bg, theme, base));
    const threshold = THRESHOLDS[size];
    const key = `${name}|${fg}|${bg}`;
    const baseline = BASELINE_EXCEPTIONS.get(key);
    if (baseline !== undefined) measuredExceptions.add(key);
    const status = exceptionStatus(ratio, threshold, baseline);
    measured += 1;
    if (status === 'grandfathered') {
      allowed += 1;
    } else if (status === 'regressed') {
      failures.push(
        `${key}: ${ratio.toFixed(2)}:1, below grandfathered baseline ${baseline.toPrecision(17)}:1 (${size}), ${where}`
      );
    } else if (status === 'below-threshold') {
      failures.push(`${key}: ${ratio.toFixed(2)}:1, needs ${threshold}:1 (${size}), ${where}`);
    } else if (status === 'stale') {
      stale.push(`${key}: now ${ratio.toFixed(2)}:1, clears ${threshold}:1, delete it from BASELINE_EXCEPTIONS in scripts/check-contrast.js`);
    }
  }
}

for (const key of BASELINE_EXCEPTIONS.keys()) {
  if (!measuredExceptions.has(key)) stale.push(`${key}: no longer measured, delete it from BASELINE_EXCEPTIONS in scripts/check-contrast.js`);
}

if (failures.length || stale.length) {
  console.error('check-contrast: FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  for (const entry of stale) console.error(`  - ${entry}`);
  process.exit(1);
}

console.log(`check-contrast: OK (${measured} pairs measured across 2 themes, ${allowed} grandfathered)`);