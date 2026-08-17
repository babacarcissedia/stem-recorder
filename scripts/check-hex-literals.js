#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

const LEDGER = {
  'src/renderer/src/timeline.css': 0,
  'src/renderer/index.html': 0,
  'src/renderer/src/app-shell.css': 0,
  'src/renderer/src/components/timeline/timeline-panel.css': 0,
  'src/renderer/src/affordance.css': 0,
  'src/renderer/src/tokens.css': 82,
};

function countHexLiterals(relative) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) return null;
  return (fs.readFileSync(absolute, 'utf8').match(HEX_PATTERN) || []).length;
}

const failures = [];
for (const [relative, ceiling] of Object.entries(LEDGER)) {
  const count = countHexLiterals(relative);
  if (count === null) {
    failures.push(`${relative}: missing — update LEDGER in scripts/check-hex-literals.js, the file this entry gates no longer exists`);
    continue;
  }
  if (count > ceiling) {
    failures.push(`${relative}: ${count} hex literals, ledger ceiling is ${ceiling} — extract new colors into shared tokens instead of adding raw hex`);
  }
}

if (failures.length) {
  console.error('check-hex-literals: FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`check-hex-literals: OK (${Object.keys(LEDGER).map((relative) => `${relative}<=${LEDGER[relative]}`).join(', ')})`);
