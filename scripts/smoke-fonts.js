#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REMOTE_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

let cases = 0;
const check = (name, fn) => {
  fn();
  cases += 1;
};

const assertNoRemoteOrigin = (label, source) => {
  for (const origin of REMOTE_ORIGINS) {
    assert.ok(!source.includes(origin), `${label} still references ${origin}`);
  }
};

check('index.html carries no Google Fonts link or preconnect', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  assertNoRemoteOrigin('src/renderer/index.html', html);
  assert.ok(!/rel="preconnect"/.test(html), 'index.html still preconnects to a remote origin');
});

check('production and development CSP drop the remote font origins', () => {
  const csp = fs.readFileSync(path.join(ROOT, 'src/main/csp.ts'), 'utf8');
  assertNoRemoteOrigin('src/main/csp.ts', csp);
  const styleSrcLines = csp.match(/"style-src[^"]*"/g) || [];
  assert.strictEqual(styleSrcLines.length, 2, 'expected a style-src directive in both CSP policies');
  for (const line of styleSrcLines) assert.ok(!/https:\/\//.test(line), `${line} still allows a remote origin`);
  const fontSrcLines = csp.match(/"font-src[^"]*"/g) || [];
  assert.strictEqual(fontSrcLines.length, 2, 'expected a font-src directive in both CSP policies');
  for (const line of fontSrcLines) assert.strictEqual(line, '"font-src \'self\'"', `${line} does not scope font-src to 'self'`);
});

check('fonts.css declares local @font-face rules for every vendored weight', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/src/fonts.css'), 'utf8');
  assertNoRemoteOrigin('src/renderer/src/fonts.css', css);
  assert.ok(!/url\(["']?https?:/.test(css), 'fonts.css references a remote font URL');

  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1]);
  assert.strictEqual(faces.length, 5, 'expected 5 vendored @font-face rules (Sans 400/500/600/700, Mono 500)');

  const expected = [
    ['IBM Plex Sans', 400, 'IBMPlexSans-Regular.woff2'],
    ['IBM Plex Sans', 500, 'IBMPlexSans-Medium.woff2'],
    ['IBM Plex Sans', 600, 'IBMPlexSans-SemiBold.woff2'],
    ['IBM Plex Sans', 700, 'IBMPlexSans-Bold.woff2'],
    ['IBM Plex Mono', 500, 'IBMPlexMono-Medium.woff2'],
  ];
  for (const [family, weight, file] of expected) {
    const face = faces.find((block) => block.includes(`"${family}"`) && block.includes(`font-weight: ${weight};`));
    assert.ok(face, `missing @font-face for ${family} ${weight}`);
    assert.ok(face.includes(`url("./fonts/ibm-plex/${file}") format("woff2")`), `${family} ${weight} does not point at ${file}`);
    assert.ok(face.includes('font-display: swap;'), `${family} ${weight} is missing font-display: swap`);
  }
});

check('the vendored woff2 files and OFL licence are on disk', () => {
  const fontsDir = path.join(ROOT, 'src/renderer/src/fonts/ibm-plex');
  for (const file of [
    'IBMPlexSans-Regular.woff2',
    'IBMPlexSans-Medium.woff2',
    'IBMPlexSans-SemiBold.woff2',
    'IBMPlexSans-Bold.woff2',
    'IBMPlexMono-Medium.woff2',
  ]) {
    const stat = fs.statSync(path.join(fontsDir, file));
    assert.ok(stat.isFile() && stat.size > 1000, `${file} is missing or suspiciously small`);
  }
  const licence = fs.readFileSync(path.join(fontsDir, 'LICENSE.txt'), 'utf8');
  assert.ok(/SIL Open Font License/.test(licence), 'LICENSE.txt is not the SIL Open Font License');
});

check('main.tsx imports fonts.css so the faces are registered', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/renderer/src/main.tsx'), 'utf8');
  assert.ok(/import '\.\/fonts\.css';/.test(main), 'main.tsx does not import fonts.css');
});

// Emitted artifacts only exist after `npm run build`; skip cleanly on a
// checkout that has not built, but never let a stale build read as green.
{
  const outHtml = path.join(ROOT, 'out/renderer/index.html');
  if (fs.existsSync(outHtml)) {
    check('emitted renderer HTML carries no remote font origin', () => {
      assertNoRemoteOrigin('out/renderer/index.html', fs.readFileSync(outHtml, 'utf8'));
    });

    check('emitted renderer CSS carries no remote font origin and ships the woff2 assets', () => {
      const assetsDir = path.join(ROOT, 'out/renderer/assets');
      const cssFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith('.css'));
      assert.ok(cssFiles.length > 0, 'no emitted renderer CSS found under out/renderer/assets');
      for (const file of cssFiles) assertNoRemoteOrigin(`out/renderer/assets/${file}`, fs.readFileSync(path.join(assetsDir, file), 'utf8'));

      const woff2Files = fs.readdirSync(assetsDir).filter((file) => file.endsWith('.woff2'));
      assert.strictEqual(woff2Files.length, 5, `expected 5 emitted woff2 files, found ${woff2Files.length}`);
    });

    check('emitted main-process bundle carries no remote font origin', () => {
      const outMain = path.join(ROOT, 'out/main/index.js');
      assertNoRemoteOrigin('out/main/index.js', fs.readFileSync(outMain, 'utf8'));
    });
  } else {
    console.log('== smoke:fonts: skipped emitted-artifact checks (out/ not built, run `npm run build` first)');
  }
}

console.log(JSON.stringify({ ok: true, cases }));
