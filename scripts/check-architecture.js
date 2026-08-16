#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const RENDERER_ALLOWED_PACKAGES = new Set([
  'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
]);

const PRELOAD_ALLOWED_PACKAGES = new Set(['electron']);

const RULES = [
  'renderer-isolation',
  'renderer-bridge-only',
  'domain-purity',
  'html-script-src',
  'html-inline-script',
  'window-hardening',
  'csp-policy',
  'preload-sandbox',
  'preflight-wired',
];

const SPECIFIER_PATTERNS = [
  /\bimport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function listSourceFiles(root, relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(root, relative));
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) found.push(relative);
  }
  return found;
}

function specifiersIn(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\b(?:import|export)\s+type\s[^;]*?from\s*(['"])[^'"]*\1/g, ' ');
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(stripped)) !== null) found.add(match[1]);
  }
  return [...found];
}

function classifySpecifier(fromRelative, specifier) {
  const bare = specifier.replace(/^node:/, '');
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(bare)) {
    return { kind: 'builtin', name: bare, specifier };
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return { kind: 'package', name: specifier, specifier };
  }
  const resolved = path.normalize(path.join(path.dirname(fromRelative), specifier));
  return { kind: 'file', name: resolved.split(path.sep).join('/'), specifier };
}

function scriptTagsIn(html) {
  const tags = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    tags.push({ src: srcMatch ? srcMatch[1] : null, body: match[2] });
  }
  return tags;
}

function localStylesheetHrefsIn(html) {
  const hrefs = [];
  const pattern = /<link\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(match[1])) continue;
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    if (hrefMatch && !/^https?:/i.test(hrefMatch[1])) hrefs.push(hrefMatch[1]);
  }
  return hrefs;
}

function productionPolicyEntries(source) {
  const start = source.indexOf('const PRODUCTION_POLICY = [');
  if (start < 0) return null;
  const end = source.indexOf('].join(', start);
  if (end < 0) return null;
  const entries = [];
  const pattern = /(["'])((?:\\.|(?!\1)[\s\S])*)\1/g;
  const block = source.slice(start, end);
  let match;
  while ((match = pattern.exec(block)) !== null) entries.push(match[2]);
  return entries;
}

function inspect(root) {
  const failures = [];
  const fail = (rule, message) => failures.push({ rule, message });
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
  const exists = (relative) => fs.existsSync(path.join(root, relative));

  for (const relative of listSourceFiles(root, path.join('src', 'renderer'))) {
    for (const specifier of specifiersIn(read(relative))) {
      const dependency = classifySpecifier(relative, specifier);
      if (dependency.kind === 'builtin') {
        fail('renderer-isolation', `${relative}: imports node builtin '${dependency.specifier}' — the renderer is untrusted UI and reaches privilege only through window.stemStudio / window.batchRecorder`);
      } else if (dependency.kind === 'package' && !RENDERER_ALLOWED_PACKAGES.has(dependency.name)) {
        fail('renderer-isolation', `${relative}: imports package '${dependency.specifier}' — renderer packages are limited to ${[...RENDERER_ALLOWED_PACKAGES].join(', ')}`);
      } else if (dependency.kind === 'file' && dependency.name.startsWith('lib/node/')) {
        fail('renderer-bridge-only', `${relative}: imports '${dependency.specifier}' — lib/node is privileged and main-only; cross the preload bridge instead`);
      } else if (dependency.kind === 'file'
        && !dependency.name.startsWith('src/renderer/')
        && !dependency.name.startsWith('lib/domain/')) {
        fail('renderer-bridge-only', `${relative}: imports '${dependency.specifier}' — the renderer may only import src/renderer and lib/domain modules`);
      }
    }
  }

  for (const relative of listSourceFiles(root, path.join('lib', 'domain'))) {
    for (const specifier of specifiersIn(read(relative))) {
      const dependency = classifySpecifier(relative, specifier);
      if (dependency.kind === 'builtin' || dependency.kind === 'package') {
        fail('domain-purity', `${relative}: imports '${dependency.specifier}' — lib/domain stays pure and portable so it keeps running under bare node and inside the renderer`);
      } else if (!dependency.name.startsWith('lib/domain/')) {
        fail('domain-purity', `${relative}: imports '${dependency.specifier}' — lib/domain may only depend on lib/domain`);
      }
    }
  }

  for (const relative of listSourceFiles(root, path.join('src', 'preload'))) {
    for (const specifier of specifiersIn(read(relative))) {
      const dependency = classifySpecifier(relative, specifier);
      if (dependency.kind === 'builtin') {
        fail('preload-sandbox', `${relative}: imports node builtin '${dependency.specifier}' — a sandboxed preload has no Node runtime, only the electron bridge`);
      } else if (dependency.kind === 'package' && !PRELOAD_ALLOWED_PACKAGES.has(dependency.name)) {
        fail('preload-sandbox', `${relative}: imports package '${dependency.specifier}' — the preload may only import electron`);
      } else if (dependency.kind === 'file' && !dependency.name.startsWith('src/preload/')) {
        fail('preload-sandbox', `${relative}: imports '${dependency.specifier}' — the preload ships as one self-contained bundled file`);
      }
    }
  }

  const indexHtml = path.join('src', 'renderer', 'index.html');
  if (!exists(indexHtml)) {
    fail('html-script-src', `${indexHtml}: missing — the renderer entry document is where a <script src> silently bypasses the bridge`);
  } else {
    const html = read(indexHtml);
    for (const tag of scriptTagsIn(html)) {
      if (!tag.src) {
        if (tag.body.trim()) {
          fail('html-inline-script', `${indexHtml}: inline <script> block — the bundled renderer runs under script-src 'self', so page scripts belong in src/renderer/src`);
        }
        continue;
      }
      if (/^https?:/i.test(tag.src)) {
        fail('html-script-src', `${indexHtml}: <script src="${tag.src}"> — remote scripts are blocked by the content security policy`);
        continue;
      }
      const resolved = classifySpecifier(indexHtml, tag.src.replace(/^\//, './'));
      if (!resolved.name.startsWith('src/renderer/')) {
        fail('html-script-src', `${indexHtml}: <script src="${tag.src}"> loads '${resolved.name}' from outside the renderer root — this is how lib/ reaches the page without crossing the bridge`);
      }
    }
    for (const href of localStylesheetHrefsIn(html)) {
      const resolved = classifySpecifier(indexHtml, href.replace(/^\//, './'));
      if (!resolved.name.startsWith('src/renderer/')) {
        fail('html-script-src', `${indexHtml}: <link rel="stylesheet" href="${href}"> loads '${resolved.name}' from outside the renderer root`);
      }
    }
  }

  const mainIndex = path.join('src', 'main', 'index.ts');
  if (!exists(mainIndex)) {
    fail('window-hardening', `${mainIndex}: missing — the main entry declares the hardened BrowserWindow`);
  } else {
    const main = read(mainIndex);
    for (const flag of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true']) {
      if (!main.includes(flag)) {
        fail('window-hardening', `${mainIndex}: missing "${flag}" in BrowserWindow webPreferences`);
      }
    }
    if (!/Content-Security-Policy/i.test(main)) {
      fail('csp-policy', `${mainIndex}: never sets a Content-Security-Policy response header`);
    }
  }

  const cspModule = path.join('src', 'main', 'csp.ts');
  if (!exists(cspModule)) {
    fail('csp-policy', `${cspModule}: missing — the production content security policy lives in one reviewable place`);
  } else {
    const entries = productionPolicyEntries(read(cspModule));
    if (!entries) {
      fail('csp-policy', `${cspModule}: no PRODUCTION_POLICY array found`);
    } else {
      const directives = new Map(entries.map((entry) => [entry.split(/\s+/)[0], entry]));
      if (directives.get('default-src') !== "default-src 'none'") {
        fail('csp-policy', `${cspModule}: PRODUCTION_POLICY must start from "default-src 'none'"`);
      }
      const scriptSrc = directives.get('script-src');
      if (scriptSrc !== "script-src 'self'") {
        fail('csp-policy', `${cspModule}: PRODUCTION_POLICY script-src must be exactly "script-src 'self'", found "${scriptSrc || 'nothing'}"`);
      }
      for (const [name, entry] of directives) {
        if (name !== 'style-src' && /'unsafe-(inline|eval)'/.test(entry)) {
          fail('csp-policy', `${cspModule}: PRODUCTION_POLICY "${entry}" relaxes a directive that must stay strict`);
        }
      }
    }
  }

  if (!exists('package.json')) {
    fail('preflight-wired', 'package.json: missing');
  } else {
    const pkg = JSON.parse(read('package.json'));
    if (!pkg.scripts || !pkg.scripts.preflight) {
      fail('preflight-wired', 'package.json: scripts.preflight is not defined');
    }
  }

  return failures;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, destination);
    else fs.copyFileSync(source, destination);
  }
}

function selfTest() {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'arch-violations');
  const baseline = path.join(fixtureRoot, '_baseline');
  const problems = [];

  const baselineFailures = inspect(baseline);
  if (baselineFailures.length) {
    for (const failure of baselineFailures) {
      problems.push(`_baseline is meant to be clean but tripped [${failure.rule}] ${failure.message}`);
    }
  }

  for (const rule of RULES) {
    const overlay = path.join(fixtureRoot, rule);
    if (!fs.existsSync(overlay)) {
      problems.push(`${rule}: no fixture at scripts/fixtures/arch-violations/${rule}`);
      continue;
    }
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-arch-'));
    try {
      copyTree(baseline, workspace);
      copyTree(overlay, workspace);
      const tripped = new Set(inspect(workspace).map((failure) => failure.rule));
      if (!tripped.has(rule)) problems.push(`${rule}: fixture did not trip its own rule`);
      const collateral = [...tripped].filter((name) => name !== rule);
      if (collateral.length) problems.push(`${rule}: fixture also tripped ${collateral.join(', ')}`);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  if (problems.length) {
    console.error('check-architecture --self-test: FAIL');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`check-architecture --self-test: OK (${RULES.length} rules, every fixture trips its own rule and only its own)`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const failures = inspect(path.join(__dirname, '..'));
  if (failures.length) {
    console.error('check-architecture: FAIL');
    for (const failure of failures) console.error(`  - [${failure.rule}] ${failure.message}`);
    process.exit(1);
  }
  console.log(`check-architecture: OK (${RULES.join(', ')})`);
}
