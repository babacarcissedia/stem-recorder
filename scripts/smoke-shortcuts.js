#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SHORTCUT_REGISTRY,
  parseAccelerator,
  chordFromKeyEvent,
  chordsEqual,
  findBindingForChord,
  isTypingTarget,
} = require('../lib/domain/shortcuts.ts');
const { THEME_PREFERENCES, themeCommandId } = require('../lib/domain/theme.ts');
const { MENU_COMMANDS } = require('../src/preload/api.ts');
const { onCommand, dispatchCommand } = require('../src/renderer/src/shortcuts/command-bus.ts');

const KEYBOARD_COMMAND_IDS = [
  'file:new-take',
  'file:open-take-folder',
  'file:export-bundle',
  'timeline:split',
  'timeline:delete-ripple',
  'timeline:mark-in',
  'timeline:mark-out',
  'timeline:play-pause',
];

let cases = 0;
function check(condition, message) {
  cases += 1;
  assert.ok(condition, message);
}

{
  const bound = SHORTCUT_REGISTRY.filter((binding) => binding.accelerator !== undefined);
  const chords = bound.map((binding) => parseAccelerator(binding.accelerator));
  for (let i = 0; i < chords.length; i += 1) {
    for (let j = i + 1; j < chords.length; j += 1) {
      check(
        !chordsEqual(chords[i], chords[j]),
        `'${bound[i].id}' and '${bound[j].id}' share accelerator '${bound[i].accelerator}'`
      );
    }
  }
}

{
  const menuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'menu.ts'), 'utf8');
  const studioSourcePath = process.env.STUDIO_SHORTCUTS_SOURCE_PATH
    || path.join(__dirname, '..', 'src', 'renderer', 'src', 'studio.ts');
  const studioSource = fs.readFileSync(studioSourcePath, 'utf8');
  const studioUiStart = studioSource.indexOf('(function studioUi() {');
  check(studioUiStart >= 0, 'studio defines the live studioUi lifecycle');

  const studioUiEnd = studioSource.indexOf('\n}());', studioUiStart);
  check(studioUiEnd >= 0, 'studioUi lifecycle has a closing boundary');

  const studioUiSource = studioSource.slice(studioUiStart, studioUiEnd + '\n}());'.length);
  const referencedIds = new Set([...menuSource.matchAll(/commandItem\('([^']+)'/g)].map((match) => match[1]));
  if (/commandItem\(themeCommandId\(preference\)/.test(menuSource)) {
    for (const preference of THEME_PREFERENCES) referencedIds.add(themeCommandId(preference));
  }
  const liveHandlerStart = studioUiSource.indexOf('const liveCommandHandlers');
  const liveHandlerSource = studioUiSource.slice(liveHandlerStart);
  const liveHandlerIds = new Set([...liveHandlerSource.matchAll(/'([^']+)':\s*\(\)\s*=>/g)].map((match) => match[1]));
  const commandSubscriptionCalls = studioUiSource.match(/\bonCommand\s*\(/g) ?? [];
  const keyboardSubscriptionCalls = studioUiSource.match(/\bsubscribeKeyboardShortcuts\s*\(/g) ?? [];
  const unloadCleanup = studioUiSource.match(
    /window\.addEventListener\(\s*['"]beforeunload['"]\s*,\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\{\s*once\s*:\s*true\s*\}\s*\);/
  );

  check(liveHandlerStart >= 0, 'studioUi mounts live command handlers');
  check(
    commandSubscriptionCalls.length === 1
      && /\bconst\s+unsubscribeCommands\s*=\s*onCommand\s*\(\s*\(command\)\s*=>\s*liveCommandHandlers\[command\]\(\)\s*,/.test(studioUiSource),
    'studioUi registers its live command-bus consumer'
  );
  check(
    keyboardSubscriptionCalls.length === 1
      && /\bconst\s+unsubscribeKeyboardShortcuts\s*=\s*subscribeKeyboardShortcuts\s*\(\s*\)\s*;/.test(studioUiSource),
    'studioUi registers exactly one keyboard-shortcut subscription'
  );
  check(unloadCleanup !== null, 'studioUi registers beforeunload cleanup');
  check(
    /\bunsubscribeCommands\s*\(\s*\)\s*;/.test(unloadCleanup?.[1] ?? '')
      && /\bunsubscribeKeyboardShortcuts\s*\(\s*\)\s*;/.test(unloadCleanup?.[1] ?? ''),
    'studioUi unload cleanup removes command and keyboard subscriptions'
  );
  check(
    studioUiSource.includes("command === 'file:new-take' || hasActiveEditableManifest()"),
    'studio keeps editor commands unavailable without an editable manifest'
  );

  for (const binding of SHORTCUT_REGISTRY) {
    check(referencedIds.has(binding.id), `registry entry '${binding.id}' is never referenced by a commandItem() call in menu.ts`);
  }
  for (const id of MENU_COMMANDS) {
    check(liveHandlerIds.has(id), `preload command '${id}' has no live Studio handler`);
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `preload accepts '${id}' but no SHORTCUT_REGISTRY entry has that id`
    );
  }
  for (const id of referencedIds) {
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `menu.ts calls commandItem('${id}') but no SHORTCUT_REGISTRY entry has that id`
    );
  }
  check(
    JSON.stringify(SHORTCUT_REGISTRY.filter((binding) => binding.accelerator !== undefined).map((binding) => binding.id))
      === JSON.stringify(KEYBOARD_COMMAND_IDS),
    'registry contains only live Studio commands on the keyboard path'
  );
}

{
  let editorAvailable = false;
  const invocations = [];
  const off = onCommand(
    (command) => invocations.push(command),
    (command) => command === 'file:new-take' || editorAvailable,
  );

  for (const command of KEYBOARD_COMMAND_IDS) dispatchCommand(command);
  check(
    JSON.stringify(invocations) === JSON.stringify(['file:new-take']),
    'unavailable editor commands do not dispatch'
  );

  editorAvailable = true;
  for (const command of KEYBOARD_COMMAND_IDS) dispatchCommand(command);
  check(
    JSON.stringify(invocations.slice(1)) === JSON.stringify(KEYBOARD_COMMAND_IDS),
    'every keyboard command reaches an available handler'
  );
  off();
}

{
  const macSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(macSplit)?.id === 'timeline:split', 'Cmd+B on mac resolves to timeline:split');

  const winSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: false, ctrlKey: true, altKey: false }, false);
  check(findBindingForChord(winSplit)?.id === 'timeline:split', 'Ctrl+B on windows resolves to timeline:split');

  const markIn = chordFromKeyEvent({ key: 'i', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(markIn)?.id === 'timeline:mark-in', 'bare I resolves to timeline:mark-in');

  const space = chordFromKeyEvent({ key: ' ', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(space)?.id === 'timeline:play-pause', 'Space resolves to timeline:play-pause');

  const rippleDelete = chordFromKeyEvent({ key: 'Delete', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(rippleDelete)?.id === 'timeline:delete-ripple', 'Delete resolves to timeline:delete-ripple');

  const unbound = chordFromKeyEvent({ key: 'z', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(unbound) === undefined, 'Cmd+Z has no registry entry');
}

{
  check(isTypingTarget({ tagName: 'INPUT', isContentEditable: false }), 'INPUT is a typing target');
  check(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false }), 'TEXTAREA is a typing target');
  check(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), 'contentEditable DIV is a typing target');
  check(!isTypingTarget({ tagName: 'DIV', isContentEditable: false }), 'plain DIV is not a typing target');
  check(!isTypingTarget({ tagName: 'BODY', isContentEditable: false }), 'BODY is not a typing target');

  for (const binding of SHORTCUT_REGISTRY) {
    check(binding.guardTyping === true, `'${binding.id}' is guarded while typing`);
  }
}

console.log(JSON.stringify({ ok: true, cases }));
