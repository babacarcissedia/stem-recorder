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
};

// tokens.css is the definition file: it is the one place raw literals belong,
// exactly as it already holds every raw hex.
const LEDGER = {
  'src/renderer/index.html': { length: 9, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0 },
  'src/renderer/src/timeline.css': { length: 41, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0 },
  'src/renderer/src/app-shell.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0 },
  'src/renderer/src/affordance.css': { length: 0, radius: 0, fontSize: 0, shadow: 0, fontFamily: 0 },
  'src/renderer/src/tokens.css': { length: 96, radius: 0, fontSize: 0, shadow: 0, fontFamily: 2 },
};

function shippedFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) shippedFiles(absolute, found);
    else if (/\.(css|html)$/.test(entry.name)) found.push(path.relative(ROOT, absolute));
  }
  return found;
}

function count(relative, family) {
  const text = fs
    .readFileSync(path.join(ROOT, relative), 'utf8')
    .split('\n')
    .filter((line) => !line.includes('@media'))
    .join('\n');
  return (text.match(FAMILIES[family].pattern) || []).length;
}

const failures = [];

for (const relative of shippedFiles(RENDERER)) {
  if (!LEDGER[relative]) {
    failures.push(
      `${relative}: not in LEDGER. Add it to scripts/check-style-literals.js pinned at 0 for every family so a new file cannot open a fresh pocket of raw literals`
    );
  }
}

for (const [relative, ceilings] of Object.entries(LEDGER)) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    failures.push(`${relative}: missing. Update LEDGER in scripts/check-style-literals.js, the file this entry gates no longer exists`);
    continue;
  }
  for (const [family, ceiling] of Object.entries(ceilings)) {
    const actual = count(relative, family);
    if (actual > ceiling) {
      failures.push(`${relative}: ${actual} raw ${family} literals, ledger ceiling is ${ceiling}. ${FAMILIES[family].advice}`);
    }
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
