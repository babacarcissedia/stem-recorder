#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { toMediaUrl, fromMediaUrl, MEDIA_SCHEME, MEDIA_HOST } = require('../lib/node/media-url.js');

let cases = 0;
const check = (name, fn) => { fn(); cases += 1; };

check('round trips an ordinary take path', () => {
  const file = path.join('/Users/someone/Movies/stem-recorder/take-2026-08-16T10-00-00', 'screen.mp4');
  const url = toMediaUrl(file);
  assert.ok(url.startsWith(`${MEDIA_SCHEME}://${MEDIA_HOST}/`));
  assert.strictEqual(fromMediaUrl(url), file);
});

check('round trips spaces, accents and hash characters', () => {
  const file = '/Users/someone/Movies/stem-recorder/take été #2/final cut.mp4';
  assert.strictEqual(fromMediaUrl(toMediaUrl(file)), file);
});

check('encodes without characters that need URL escaping', () => {
  const url = toMediaUrl('/tmp/a b/c?d#e.mp4');
  assert.ok(/^app:\/\/media\/[A-Za-z0-9_-]+$/.test(url), `unexpected encoding: ${url}`);
});

check('rejects other schemes and hosts', () => {
  assert.strictEqual(fromMediaUrl('file:///tmp/screen.mp4'), null);
  assert.strictEqual(fromMediaUrl('app://bundle/index.html'), null);
  assert.strictEqual(fromMediaUrl('not a url'), null);
  assert.strictEqual(fromMediaUrl(`${MEDIA_SCHEME}://${MEDIA_HOST}/`), null);
});

console.log(JSON.stringify({ ok: true, cases }, null, 2));
