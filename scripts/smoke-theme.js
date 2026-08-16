#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  THEME_PREFERENCES,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  themeCommandId,
  preferenceFromCommand,
  resolveTheme,
} = require('../lib/domain/theme.ts');
const { SHORTCUT_REGISTRY } = require('../lib/domain/shortcuts.ts');

const ROOT = path.join(__dirname, '..');
let cases = 0;
function check(condition, message) {
  cases += 1;
  assert.ok(condition, message);
}

{
  check(THEME_PREFERENCES.length === 3, 'three theme states (C5)');
  check(DEFAULT_THEME_PREFERENCE === 'system', 'default preference is system');
  check(!isThemePreference('sepia'), 'unknown preference is rejected');
  check(resolveTheme('system', true) === 'dark', 'system follows a dark OS');
  check(resolveTheme('system', false) === 'light', 'system follows a light OS');
  check(resolveTheme('light', true) === 'light', 'explicit light overrides a dark OS');
  check(resolveTheme('dark', false) === 'dark', 'explicit dark overrides a light OS');
}

{
  for (const preference of THEME_PREFERENCES) {
    const id = themeCommandId(preference);
    check(preferenceFromCommand(id) === preference, `${id} round-trips to ${preference}`);
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id && binding.menuGroup === 'View'),
      `${id} is a View entry in the shared shortcut registry`
    );
    check(
      SHORTCUT_REGISTRY.find((binding) => binding.id === id).accelerator === undefined,
      `${id} claims no accelerator, so it stays out of the keyboard path`
    );
  }
  check(preferenceFromCommand('timeline:split') === null, 'a non-theme command yields no preference');
}

// require('electron') outside an Electron process returns a binary path, not the
// API, so main-process wiring is asserted by parsing source (same as menu.ts).
{
  const menuSource = fs.readFileSync(path.join(ROOT, 'src', 'main', 'menu.ts'), 'utf8');
  check(/THEME_PREFERENCES\.map\(/.test(menuSource), 'the View menu builds its theme items from THEME_PREFERENCES');
  check(/commandItem\(themeCommandId\(preference\)\)/.test(menuSource), 'theme menu items come from the shared command registry');
  check(/type: 'radio'/.test(menuSource), 'theme items are radio items showing the active choice');

  const themeSource = fs.readFileSync(path.join(ROOT, 'src', 'main', 'theme.ts'), 'utf8');
  check(/nativeTheme\.themeSource = next/.test(themeSource), 'setting a preference drives nativeTheme.themeSource');
  check(/nativeTheme\.themeSource = preference/.test(themeSource), 'the persisted preference drives nativeTheme.themeSource at boot');
  check(/webContents\.send\('theme:changed'/.test(themeSource), 'main broadcasts the resolved theme to the renderer');
  check(/nativeTheme\.on\('updated', broadcast\)/.test(themeSource), 'an OS theme flip rebroadcasts while preference is system');
  check(/app\.getPath\('userData'\)/.test(themeSource), 'the preference persists in main-process userData, not the sandboxed renderer');

  const mainSource = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.ts'), 'utf8');
  check(/initTheme\(\);/.test(mainSource), 'main restores the persisted preference at startup');
  check(/if \(!isThemePreference\(preference\)\) return themeState\(\);/.test(mainSource), 'theme:set validates its payload');

  const preloadSource = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'index.ts'), 'utf8');
  check(/exposeInMainWorld\('stemTheme'/.test(preloadSource), 'the theme bridge is exposed through contextBridge');

  const applySource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'src', 'theme', 'apply-theme.ts'), 'utf8');
  check(/dataset\.theme = state\.resolved/.test(applySource), 'the renderer reflects the resolved theme onto the root element');
  check(/bridge\.onChanged\(applyTheme\)/.test(applySource), 'the renderer stays subscribed to main-side theme changes');
}

// the token contract: components read aliases, only tokens.css holds literals
{
  const tokens = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'src', 'tokens.css'), 'utf8');
  const light = tokens.slice(tokens.indexOf(':root[data-theme="light"]'), tokens.indexOf(':root[data-theme="dark"]'));
  const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  const aliasesIn = (block) => new Set([...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]).filter((name) => !name.startsWith('--ramp-')));
  const lightAliases = aliasesIn(light);
  const darkAliases = aliasesIn(dark);
  check(lightAliases.size > 40, 'the semantic alias layer is substantive');
  for (const alias of lightAliases) check(darkAliases.has(alias), `${alias} is defined in the dark theme too`);
  for (const alias of darkAliases) check(lightAliases.has(alias), `${alias} is defined in the light theme too`);
  check(!/^\s*--(?!ramp-)[a-z0-9-]+:\s*#/m.test(tokens), 'no semantic alias points at a raw hex literal');

  for (const relative of ['src/renderer/src/timeline.css', 'src/renderer/index.html', 'src/renderer/src/app-shell.css']) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    check(!/var\(--ramp-/.test(source), `${relative} references semantic aliases, never raw ramp steps`);
    check(!/#[0-9a-fA-F]{3,8}\b/.test(source), `${relative} holds no raw hex literal`);
  }
}

// R8: cursor affordance is a role convention, not a per-element sprinkle
{
  const affordance = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'src', 'affordance.css'), 'utf8');
  for (const selector of ['button', '[role="button"]', 'select', 'summary', 'a[href]']) {
    check(affordance.includes(selector), `${selector} earns a cursor by role`);
  }
  check(/cursor: not-allowed/.test(affordance), 'unavailable surfaces lose the affordance');
  check(/\[draggable="true"\]:active \{\n  cursor: grabbing;/.test(affordance), 'a drag in progress reads as grabbing');
  check(!/\.[a-z-]+ *\{[^}]*cursor: pointer/.test(affordance), 'no component class names a cursor');
}

console.log(JSON.stringify({ ok: true, cases }));
