#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Edit-T2d caption burn-in: subtitles filter escaping +
 * placement in the PiP graph (pure string assertions), and the take-level
 * plumbing — resolveBurn with the VTT present/absent, and the light cue
 * edit rewriting captions.vtt + transcript.txt. No ffmpeg binary needed.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  subtitlesFilter, pipFilterGraph, freezeStillChain, hasSubtitlesFilter, findFfmpeg,
} = require('../lib/ffmpeg-util');
const { resolveBurn, updateCueText, writeOutputs, readTranscript } = require('../lib/transcribe');
const { normalizeManifest } = require('../lib/edit-manifest');

// —— subtitlesFilter: quoted filename, libavfilter specials escaped ——
assert.strictEqual(
  subtitlesFilter('/takes/take-1/edit/captions.vtt'),
  "subtitles=filename='/takes/take-1/edit/captions.vtt'"
);
assert.strictEqual(
  subtitlesFilter("/od'd:path\\x/captions.vtt"),
  "subtitles=filename='/od\\'d\\:path\\\\x/captions.vtt'"
);

// —— pipFilterGraph: subtitles stage appended last, after the overlay ——
const plain = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24 });
const burned = pipFilterGraph({
  crop: null, cam: {}, pipWidth: 480, margin: 24, subtitlesPath: '/t/edit/captions.vtt',
});
assert.strictEqual(
  burned,
  '[0:v]null[base];[1:v]scale=w=480:h=-2[pip];[base][pip]overlay=x=W-w-24:y=H-h-24[ov];'
  + "[ov]subtitles=filename='/t/edit/captions.vtt'[v]"
);

// —— no subtitlesPath keeps the T2a/T2c graphs byte-for-byte ——
assert.strictEqual(pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, subtitlesPath: null }), plain);
const frozen = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, freezeDur: 1.5 });
assert.ok(frozen.endsWith(`[ov]${freezeStillChain(1.5)}[v]`));

// —— freeze + subtitles compose in order: still first, then the burn ——
const both = pipFilterGraph({
  crop: null, cam: {}, pipWidth: 480, margin: 24, freezeDur: 2, subtitlesPath: '/t/c.vtt',
});
assert.ok(both.endsWith(`[ov]${freezeStillChain(2)},${subtitlesFilter('/t/c.vtt')}[v]`));

// —— capability probe: a boolean per build (Apply skips the burn on false) ——
{
  const ffmpeg = findFfmpeg();
  if (ffmpeg) assert.strictEqual(typeof hasSubtitlesFilter(ffmpeg), 'boolean');
  assert.strictEqual(hasSubtitlesFilter('/nonexistent/ffmpeg-t2d-smoke'), false);
}

// —— manifest flag: only the explicit ON survives normalization ——
assert.strictEqual(normalizeManifest({ captions: { burn: true } }, 't', 10).captions.burn, true);
assert.strictEqual('captions' in normalizeManifest({ captions: { burn: false } }, 't', 10), false);
assert.strictEqual('captions' in normalizeManifest({}, 't', 10), false);

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-captions-smoke-'));
  try {
    const takeDir = path.join(tmp, 'take-demo');
    fs.mkdirSync(takeDir, { recursive: true });

    // —— resolveBurn: default OFF · ON without a VTT skips · ON with a VTT burns ——
    assert.deepStrictEqual(resolveBurn(takeDir, { clips: [] }), { burn: false, requested: false });
    const skipped = resolveBurn(takeDir, { captions: { burn: true } });
    assert.strictEqual(skipped.burn, false);
    assert.ok(/no captions\.vtt/.test(skipped.skipped));

    writeOutputs(takeDir, {
      provider: 'local',
      model: 'whisper-base',
      language: 'en',
      sourceFile: 'audio.mp3',
      text: 'Hello world.\nSecond cue.',
      cues: [
        { start: 0.5, end: 2, text: 'Hello world.' },
        { start: 3, end: 4.5, text: 'Second cue.' },
      ],
    });
    const live = resolveBurn(takeDir, { captions: { burn: true } });
    assert.strictEqual(live.burn, true);
    assert.strictEqual(live.vtt, path.join(takeDir, 'edit', 'captions.vtt'));

    // —— updateCueText: rewrites the VTT cue + transcript, keeps timing ——
    const res = updateCueText(takeDir, 1, '  Second cue, fixed.  ');
    assert.strictEqual(res.segments, 2);
    assert.deepStrictEqual(res.cue, { start: 3, end: 4.5, text: 'Second cue, fixed.' });
    const read = readTranscript(takeDir);
    assert.deepStrictEqual(read.cues, [
      { start: 0.5, end: 2, text: 'Hello world.' },
      { start: 3, end: 4.5, text: 'Second cue, fixed.' },
    ]);
    assert.strictEqual(read.text, 'Hello world.\nSecond cue, fixed.\n');

    // —— guard rails: bad index / empty text / missing VTT are clear errors ——
    assert.throws(() => updateCueText(takeDir, 2, 'x'), /out of range/);
    assert.throws(() => updateCueText(takeDir, -1, 'x'), /out of range/);
    assert.throws(() => updateCueText(takeDir, 0, '   '), /cannot be empty/);
    const bare = path.join(tmp, 'take-bare');
    fs.mkdirSync(bare, { recursive: true });
    assert.throws(() => updateCueText(bare, 0, 'x'), /no captions\.vtt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, cases: 20 }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
