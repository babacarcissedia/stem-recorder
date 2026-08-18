#!/usr/bin/env node
'use strict';

/**
 * Sibling of check-hex-literals for the non-color token families: spacing,
 * radius, typography, elevation. Same ratchet contract, per-file ceilings that
 * fail on increase, so raw literals only ever go down.
 *
 * @media conditions are excluded from the length count: CSS resolves media
 * queries before custom properties, so var() is not usable there and those
 * literals can never be migrated.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src/renderer');

const FAMILIES = {
  length: {
    pattern: /\b[0-9]*\.?[0-9]+(px|rem)\b/g,
    advice: 'use a --space-* / --size-* token from tokens.css',
  },
  radius: {
    pattern: /border-radius:[^;}]*?[0-9]+(px|rem)/g,
    advice: 'use a --radius-* token from tokens.css',
  },
  fontSize: {
    pattern: /font-size:[^;}]*?[0-9]*\.?[0-9]+(px|rem)/g,
    advice: 'use a --text-* token from tokens.css',
  },
  shadow: {
    pattern: /box-shadow:[^;}]*?[0-9]+px/g,
    advice: 'use an --elevation-* / --ring-* / --scrim-* token from tokens.css',
  },
  fontFamily: {
    pattern: /font-family:[^;}]*?["']/g,
    advice: 'use --font-sans / --font-mono from tokens.css',
  },
  color: {
    pattern: /\brgba?\(/g,
    advice: 'use a color token from tokens.css',
  },
};

// tokens.css is the definition file: it is the one place raw literals belong,
// exactly as it already holds every raw hex.
const LEDGER = {
  'src/renderer/index.html': { length: 9, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0, color: 0 },
  'src/renderer/src/timeline.css': { length: 41, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0, color: 0 },
  'src/renderer/src/app-shell.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0, color: 0 },
  'src/renderer/src/components/timeline/timeline-panel.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0, color: 0 },
  'src/renderer/src/affordance.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0, color: 0 },
  'src/renderer/src/tokens.css': { length: 96, radius: 0, fontSize: 0, shadow: 0, fontFamily: 2, color: 22 },
  'src/renderer/src/fonts.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 5, color: 0 },
};

function shippedFiles(dir, extensions, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) shippedFiles(absolute, extensions, found);
    else if (extensions.test(entry.name)) found.push(path.relative(ROOT, absolute));
  }
  return found;
}

const STYLE_FILES = shippedFiles(RENDERER, /\.(css|html)$/);
const COLOR_FILES = shippedFiles(RENDERER, /\.(css|html|ts|tsx)$/);
const COLOR_LEDGER = {
  ...Object.fromEntries(Object.entries(LEDGER).map(([relative, ceilings]) => [relative, ceilings.color])),
  'src/renderer/src/app-shell.tsx': 0,
  'src/renderer/src/components/atoms/icon-button.tsx': 0,
  'src/renderer/src/components/layout/shell-layout.tsx': 0,
  'src/renderer/src/components/legacy/legacy-editor-island.tsx': 0,
  'src/renderer/src/components/player/player-panel.tsx': 0,
  'src/renderer/src/components/player/player-transport.tsx': 0,
  'src/renderer/src/components/sidebar/inspector-sidebar.tsx': 0,
  'src/renderer/src/components/sidebar/media-sidebar.tsx': 0,
  'src/renderer/src/components/timeline/timeline-footer.tsx': 0,
  'src/renderer/src/components/timeline/timeline-panel.tsx': 0,
  'src/renderer/src/components/timeline/timeline-track-row.tsx': 0,
  'src/renderer/src/components/timeline/timeline-clip.tsx': 0,
  'src/renderer/src/components/timeline/timeline-ruler.tsx': 0,
  'src/renderer/src/components/timeline/timeline-playhead.tsx': 0,
  'src/renderer/src/components/timeline/use-timeline-project.ts': 0,
  'src/renderer/src/components/top-bar/top-bar.tsx': 0,
  'src/renderer/src/global.d.ts': 0,
  'src/renderer/src/main.tsx': 0,
  'src/renderer/src/recorder-panel.ts': 0,
  'src/renderer/src/shortcuts/command-bus.ts': 0,
  'src/renderer/src/shortcuts/use-keyboard-shortcuts.ts': 0,
  'src/renderer/src/studio.ts': 0,
  'src/renderer/src/theme/apply-theme.ts': 0,
};

function count(relative, family) {
  const text = fs
    .readFileSync(path.join(ROOT, relative), 'utf8')
    .split('\n')
    .filter((line) => !line.includes('@media'))
    .join('\n');
  return (text.match(FAMILIES[family].pattern) || []).length;
}

const failures = [];

for (const relative of STYLE_FILES) {
  if (!LEDGER[relative]) {
    failures.push(
      `${relative}: not in LEDGER. Add it to scripts/check-style-literals.js pinned at 0 for every family so a new file cannot open a fresh pocket of raw literals`
    );
  }
}

for (const relative of COLOR_FILES) {
  if (!Object.hasOwn(COLOR_LEDGER, relative)) {
    failures.push(
      `${relative}: not in COLOR_LEDGER. Add it to scripts/check-style-literals.js pinned at 0 so a new renderer source file cannot open a raw rgba pocket`
    );
  }
}

for (const [relative, ceilings] of Object.entries(LEDGER)) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    failures.push(`${relative}: missing. Update LEDGER in scripts/check-style-literals.js, the file this entry gates no longer exists`);
    continue;
  }
  for (const [family, ceiling] of Object.entries(ceilings)) {
    if (family === 'color') continue;
    const actual = count(relative, family);
    if (actual > ceiling) {
      failures.push(`${relative}: ${actual} raw ${family} literals, ledger ceiling is ${ceiling}. ${FAMILIES[family].advice}`);
    }
  }
}

for (const [relative, ceiling] of Object.entries(COLOR_LEDGER)) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    failures.push(`${relative}: missing. Update COLOR_LEDGER in scripts/check-style-literals.js, the file this entry gates no longer exists`);
    continue;
  }
  const actual = count(relative, 'color');
  if (actual > ceiling) {
    failures.push(`${relative}: ${actual} raw color literals, ledger ceiling is ${ceiling}. ${FAMILIES.color.advice}`);
  }
}

if (failures.length) {
  console.error('check-style-literals: FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const summary = Object.keys(LEDGER)
  .map((relative) => `${relative}<=${Object.values(LEDGER[relative]).reduce((a, b) => a + b, 0)}`)
  .join(', ');
console.log(`check-style-literals: OK (${summary})`);
