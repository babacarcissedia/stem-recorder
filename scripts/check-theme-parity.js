#!/usr/bin/env node
'use strict';

/**
 * The invariant the two-layer token model rests on: the light and dark layer-2
 * blocks must define the same alias set.
 *
 * A miss does not surface as a missing value. `:root, :root[data-theme="light"]`
 * matches under both themes, so an alias defined only in light silently keeps
 * its light value in dark, producing a wrong colour rather than an absent one.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELATIVE = 'src/renderer/src/tokens.css';

const source = fs.readFileSync(path.join(ROOT, RELATIVE), 'utf8');
const lightStart = source.indexOf(':root,');
const darkStart = source.indexOf(':root[data-theme="dark"]');

const failures = [];

if (lightStart === -1 || darkStart === -1 || darkStart < lightStart) {
  console.error('check-theme-parity: FAIL');
  console.error(`  - ${RELATIVE}: expected a ':root, :root[data-theme="light"]' block followed by a ':root[data-theme="dark"]' block`);
  process.exit(1);
}

const aliasesIn = (block) =>
  new Set(
    [...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith('--ramp-'))
  );

const light = aliasesIn(source.slice(lightStart, darkStart));
const dark = aliasesIn(source.slice(darkStart));

for (const alias of light) {
  if (!dark.has(alias)) failures.push(`${alias}: defined in light, missing in dark — dark inherits the light value through :root`);
}
for (const alias of dark) {
  if (!light.has(alias)) failures.push(`${alias}: defined in dark, missing in light — light has no value at all`);
}

if (failures.length) {
  console.error('check-theme-parity: FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`check-theme-parity: OK (${light.size} aliases in both blocks)`);
