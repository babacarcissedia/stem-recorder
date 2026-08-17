#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { formatTimecode, secondsToMs } = require('../lib/domain/ms.ts');

assert.strictEqual(formatTimecode(secondsToMs(0)), '00:00.000');
assert.strictEqual(formatTimecode(secondsToMs(65.432)), '01:05.432');

const root = path.resolve(__dirname, '..');
const studioPath = path.join(root, 'src/renderer/src/studio.ts');
const source = fs.readFileSync(studioPath, 'utf8');

assert.match(
  source,
  /import \{\s*formatTimecode,\s*secondsToMs\s*\} from ['"]\.\.\/\.\.\/\.\.\/lib\/domain\/ms\.ts['"];?/,
  'Studio must import formatTimecode and secondsToMs from lib/domain/ms.ts',
);

const adapterMatches = source.match(/function\s+formatSecondsTimecode\s*\(/g) || [];
assert.strictEqual(adapterMatches.length, 1, 'Studio must define exactly one seconds display adapter');

const adapterMatch = source.match(/function\s+formatSecondsTimecode\s*\([\s\S]*?\n  \}/);
assert.ok(adapterMatch, 'Studio seconds display adapter must be present');
const adapter = adapterMatch[0];
assert.match(adapter, /value\s*==\s*null/, 'adapter must handle nullish values');
assert.match(adapter, /!Number\.isFinite\(value\)/, 'adapter must reject non-finite values');
assert.match(adapter, /return ['\"]\\u2014['\"]/, 'adapter must display unavailable values as unavailable glyph');
assert.match(adapter, /Math\.max\(0,\s*value\)/, 'adapter must clamp finite negatives to zero');
assert.match(adapter, /formatTimecode\(secondsToMs\(Math\.max\(0,\s*value\)\)\)/, 'adapter must convert seconds to ms before V2 formatting');

assert.doesNotMatch(source, /function\s+fmt\s*\(/, 'legacy fmt formatter must be removed');
assert.doesNotMatch(source, /function\s+fmtClock\s*\(/, 'legacy fmtClock formatter must be removed');
assert.doesNotMatch(source, /\bfmt\s*\(/, 'legacy fmt call sites must be removed');
assert.doesNotMatch(source, /\bfmtClock\s*\(/, 'legacy fmtClock call sites must be removed');

const activeUsageCount = (source.match(/formatSecondsTimecode\(/g) || []).length - 1;
assert.ok(activeUsageCount >= 25, `expected legacy Studio readouts to use adapter, found ${activeUsageCount}`);

for (const needle of [
  'editTimeLabel.textContent = `out ${formatSecondsTimecode(outputTime)} · src ${formatSecondsTimecode(mapped.sourceTime)}`',
  'tlOutTime) tlOutTime.textContent = `${formatSecondsTimecode(outputTime)} / ${formatSecondsTimecode(total)}`',
  'span.textContent = formatSecondsTimecode(t)',
  'time.textContent = formatSecondsTimecode(cue.start)',
  'Split at ${formatSecondsTimecode(mapped.sourceTime)}',
  'Trimmed #${selectedIdx + 1} → ${formatSecondsTimecode(inn)} → ${formatSecondsTimecode(out)}',
]) {
  assert.ok(source.includes(needle), `missing adapter-backed readout: ${needle}`);
}

for (const needle of [
  'hold ${formatSecondsTimecode(dur)}',
  'hold ${formatSecondsTimecode(ops.clipDuration(clip, duration))}',
  'hold ${formatSecondsTimecode(ops.clipDuration(c, duration))}',
]) {
  assert.ok(source.includes(needle), `freeze hold readout must use adapter: ${needle}`);
}

assert.doesNotMatch(source, /hold \$\{[^}]*\.toFixed\([^}]*\)\}s/, 'freeze hold readouts must not use raw toFixed seconds');
assert.doesNotMatch(source, /\.toFixed\([^)]*\)s/, 'no inline toFixed seconds presentation should remain');

console.log(JSON.stringify({ ok: true, cases: 19 }, null, 2));
