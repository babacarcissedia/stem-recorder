#!/usr/bin/env node
'use strict';

/**
 * Enforceable layer boundaries (see ARCHITECTURE.md). Exit 1 on any violation.
 *
 *  1. renderer/ is untrusted UI: no require() except relative UI modules —
 *     everything else goes through the preload contextBridge API.
 *  2. Pure edit-model modules (clip-ops, undo-stack, gap-chips) stay free of
 *     electron / fs / child_process so they run anywhere (smokes, future web).
 *  3. main.js keeps the hardened BrowserWindow flags.
 *  4. package.json exposes the preflight gate.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

function requiresIn(source) {
  const out = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) out.push(match[1]);
  return out;
}

// 1. renderer/**/*.js — relative UI modules only (in practice: no require at all)
for (const rel of listJs('renderer')) {
  for (const dep of requiresIn(read(rel))) {
    if (!dep.startsWith('./')) {
      fail(`${rel}: require('${dep}') — renderer is untrusted UI; use the preload bridge (window.stemStudio / window.batchRecorder)`);
    }
  }
}

// 2. pure edit-model modules
const PURE = [
  'lib/domain/clip-ops.ts',
  'lib/domain/undo-stack.ts',
  'lib/domain/gap-chips.ts',
  'lib/domain/captions.ts',
  'lib/domain/export-presets.ts',
  'lib/domain/export-bundle.ts',
];
const IMPURE = new Set(['electron', 'fs', 'child_process']);
for (const rel of PURE) {
  for (const dep of requiresIn(read(rel))) {
    if (IMPURE.has(dep)) {
      fail(`${rel}: require('${dep}') — edit-model modules must stay pure (no electron/fs/child_process)`);
    }
  }
}

// 3. main.js window hardening
const main = read('main.js');
for (const flag of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true']) {
  if (!main.includes(flag)) {
    fail(`main.js: missing "${flag}" in BrowserWindow webPreferences`);
  }
}

// 4. preflight script wired
const pkg = JSON.parse(read('package.json'));
if (!pkg.scripts || !pkg.scripts.preflight) {
  fail('package.json: scripts.preflight is not defined');
}

if (failures.length) {
  console.error('check-architecture: FAIL');
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}
console.log('check-architecture: OK (renderer isolation, pure edit model, window hardening, preflight wired)');
