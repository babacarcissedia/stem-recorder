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
 * rgba() literals (overlays over user video) are excluded: they composite over
 * user content, not a themed surface, and have no token to measure against.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOKENS = path.join(ROOT, 'src/renderer/src/tokens.css');

const THRESHOLDS = { normal: 4.5, large: 3, ui: 3 };

const PAIRS = [
  ['text-primary', 'surface-app', 'normal', 'index.html:10 body'],
  ['text-muted', 'surface-app', 'normal', 'index.html:19 p.lead in body'],
  ['text-primary', 'surface-raised', 'normal', 'index.html:90 button.secondary'],
  ['text-muted', 'surface-raised', 'normal', 'app-shell.css:34 autosave in .shell-top-bar:18'],
  ['text-primary', 'surface-subtle', 'normal', 'index.html:106 .toggle span in .toggle:103'],
  ['text-muted', 'surface-subtle', 'normal', 'index.html:107 .toggle small in .toggle:103'],
  ['positive', 'surface-subtle', 'normal', 'index.html:116 .takes a'],
  ['accent', 'surface-subtle', 'normal', 'index.html:252 .cue-time in .cue-row:247'],
  ['text-on-accent', 'accent-soft', 'normal', 'index.html:88 button'],
  ['text-primary', 'accent-soft', 'normal', 'app-shell.css:154 .shell-icon-button.active'],
  ['text-muted', 'accent-soft', 'normal', 'timeline.css:543 .clip-meta span in .clip-row.selected:540'],
  ['warn', 'negative-surface', 'normal', 'index.html:91 button.danger'],
  ['surface-raised', 'record-surface', 'normal', 'index.html:93 button.rec'],
  ['timeline-text', 'surface-control', 'normal', 'timeline.css:61 .tl-toolbar button'],
  ['text-primary', 'surface-control', 'normal', 'timeline.css:707 in :705'],
  ['text-primary', 'surface-sunken', 'normal', 'timeline.css:719 in :718'],
  ['accent-foreground', 'accent', 'normal', 'timeline.css:69 .tl-toolbar button.primary, timeline.css:39, timeline.css:685, index.html:169, index.html:230, index.html:243'],
  ['timeline-text-muted', 'toolbar-surface', 'normal', 'index.html:171 .tl-time in .tl-toolbar:163'],
  ['negative-on-surface', 'negative-surface', 'normal', 'timeline.css:75 .tl-toolbar button.danger'],
  ['positive-text', 'positive-surface', 'normal', 'timeline.css:81 .tl-toolbar button.on'],
  ['timeline-text-muted', 'clip-gap-a', 'normal', 'timeline.css:577 .asr-provider button'],
  ['menu-text', 'menu-surface', 'normal', 'index.html:239 .ctx-menu button in .ctx-menu:234'],
  ['menu-text-disabled', 'menu-surface', 'normal', 'index.html:243 .ctx-menu button:disabled'],
  ['surface-raised', 'text-primary', 'normal', 'app-shell.css:102 stage-empty on stage:98 (text-primary as a fill)'],
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

  ['border-subtle', 'surface-raised', 'ui', 'app-shell.css:55 .shell-sidebar border'],
  ['border-subtle', 'surface-app', 'ui', 'index.html:30 .stage-wrap border in body:10'],
  ['border-strong', 'surface-control', 'ui', 'timeline.css:60 .tl-toolbar button border'],
  ['border-strong', 'surface-raised', 'ui', 'app-shell.css:147 .shell-icon-button border, index.html:84 select/button border'],
  ['border-strong', 'surface-subtle', 'ui', 'index.html:221 .clip-row border, index.html:248 .cue-row border, index.html:119 .takes a border'],
  ['border-strong', 'timeline-surface-sunken', 'ui', 'timeline.css:611 .cue-row border'],
  ['timeline-border', 'timeline-surface', 'ui', 'timeline.css:50 .tl-toolbar border'],
  ['border-subtle', 'timeline-track', 'ui', 'timeline.css:181 .timeline-shell border'],
  ['focus-ring', 'surface-app', 'ui', 'affordance.css:53 :focus-visible outline, offset 2px onto the page'],
  ['focus-ring', 'surface-raised', 'ui', 'affordance.css:53 outline on panel-hosted controls'],
  ['focus-ring', 'timeline-surface', 'ui', 'affordance.css:53 outline on .tl-toolbar:48 controls'],
  ['focus-ring', 'menu-surface', 'ui', 'affordance.css:53 outline on .ctx-menu:234 items'],
  ['clip-wave', 'clip-audio-top', 'ui', 'timeline.css:390 .tl-clip .wave b over .tl-clip.audio:330'],
  ['accent', 'timeline-surface-sunken', 'ui', 'timeline.css:539 .clip-row.selected border'],
  ['accent-muted-border', 'accent-soft', 'ui', 'timeline.css:617 .cue-row:hover border on :618'],
  ['accent-soft-border', 'accent-soft', 'ui', 'index.html:88 button border'],
  ['accent-strong', 'accent', 'ui', 'timeline.css:68 .tl-toolbar button.primary border'],
  ['positive-border', 'positive-surface', 'ui', 'timeline.css:80 .tl-toolbar button.on border'],
  ['negative-border', 'negative-surface', 'ui', 'timeline.css:74 .tl-toolbar button.danger border'],
  ['record-border', 'record-surface', 'ui', 'index.html:94 button.rec border'],
];

// Seeded from the first run of this gate. Each floor is the unrounded measured
// ratio, so a grandfathered pair cannot regress while it remains below WCAG.
const BASELINE_EXCEPTIONS = new Map([
  ['light|accent-muted-border|accent-soft', 1.1649718085572776],
  ['light|accent-soft-border|accent-soft', 1.1649718085572776],
  ['light|accent-strong|accent', 1.4089921851754046],
  ['light|border-subtle|surface-app', 1.3688636519559692],
  ['light|border-subtle|surface-raised', 1.5046206661919197],
  ['light|border-subtle|timeline-track', 1],
  ['light|menu-text-disabled|menu-surface', 4.3624051910043535],
  ['light|negative-border|negative-surface', 1.2020156319772222],
  ['light|record-border|record-surface', 1.3860806766780116],
  ['light|timeline-border|timeline-surface', 1.2097594857063192],
  ['light|timeline-text-muted|toolbar-surface', 2.8015988584388496],
  ['light|timeline-text-muted|clip-gap-a', 2.2133039091944253],
  ['light|timeline-text-muted|timeline-track', 3.9123560303668827],
  ['light|warn|negative-surface', 4.266730447239321],
  ['dark|accent-muted-border|accent-soft', 2.0709432023240306],
  ['dark|accent-soft-border|accent-soft', 2.5600715340498503],
  ['dark|accent-strong|accent', 1.3404854894308253],
  ['dark|border-subtle|surface-app', 1.3891658179548516],
  ['dark|border-subtle|surface-raised', 1.2657994443512934],
  ['dark|border-subtle|timeline-track', 1.4712335591628987],
  ['dark|menu-text-disabled|menu-surface', 3.271509693653111],
  ['dark|negative-border|negative-surface', 1.3726098416063528],
  ['dark|positive-border|positive-surface', 1.5678184328989055],
  ['dark|record-border|record-surface', 1.3860806766780116],
  ['dark|surface-raised|record-surface', 3.5165446476705915],
  ['dark|timeline-border|timeline-surface', 1.3009407431374673],]);

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
  const baseline = BASELINE_EXCEPTIONS.get('light|timeline-text-muted|toolbar-surface');
  if (baseline !== 2.8015988584388496) throw new Error('contrast self-test baseline changed');
  if (exceptionStatus(baseline - 0.01, THRESHOLDS.normal, baseline) !== 'regressed') {
    throw new Error('contrast self-test did not reject a degraded grandfathered pair');
  }
  if (exceptionStatus(baseline, THRESHOLDS.normal, baseline) !== 'grandfathered') {
    throw new Error('contrast self-test did not retain its recorded floor');
  }
  if (exceptionStatus(THRESHOLDS.normal, THRESHOLDS.normal, baseline) !== 'stale') {
    throw new Error('contrast self-test did not reject a stale exception');
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