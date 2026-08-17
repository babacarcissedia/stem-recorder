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
const { MENU_COMMANDS } = require('../src/preload/api.ts');

let cases = 0;
function check(condition, message) {
  cases += 1;
  assert.ok(condition, message);
}

// no accelerator is registered twice
{
  const chords = SHORTCUT_REGISTRY.map((binding) => parseAccelerator(binding.accelerator));
  for (let i = 0; i < chords.length; i += 1) {
    for (let j = i + 1; j < chords.length; j += 1) {
      check(
        !chordsEqual(chords[i], chords[j]),
        `'${SHORTCUT_REGISTRY[i].id}' and '${SHORTCUT_REGISTRY[j].id}' share accelerator '${SHORTCUT_REGISTRY[i].accelerator}'`
      );
    }
  }
}

// every menu accelerator has a matching registry entry, and vice versa
// (require('electron') outside an Electron process returns a binary path,
// not the API, so menu.ts is checked by parsing its commandItem() calls)
{
  const menuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'menu.ts'), 'utf8');
  const referencedIds = new Set([...menuSource.matchAll(/commandItem\('([^']+)'/g)].map((match) => match[1]));

  for (const binding of SHORTCUT_REGISTRY) {
    check(referencedIds.has(binding.id), `registry entry '${binding.id}' is never referenced by a commandItem() call in menu.ts`);
    check(MENU_COMMANDS.includes(binding.id), `registry entry '${binding.id}' is not accepted by the preload bridge`);
  }
  for (const id of referencedIds) {
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `menu.ts calls commandItem('${id}') but no SHORTCUT_REGISTRY entry has that id`
    );
  }
  for (const id of MENU_COMMANDS) {
    check(
      SHORTCUT_REGISTRY.some((binding) => binding.id === id),
      `preload accepts '${id}' but no SHORTCUT_REGISTRY entry has that id`
    );
  }
}

// keyboard chords resolve to the intended command, on both platforms
{
  const macSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(macSplit)?.id === 'timeline:split', 'Cmd+B on mac resolves to timeline:split');

  const winSplit = chordFromKeyEvent({ key: 'b', shiftKey: false, metaKey: false, ctrlKey: true, altKey: false }, false);
  check(findBindingForChord(winSplit)?.id === 'timeline:split', 'Ctrl+B on windows resolves to timeline:split');

  const join = chordFromKeyEvent({ key: 'B', shiftKey: true, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(join)?.id === 'timeline:join', 'Cmd+Shift+B resolves to timeline:join');

  const markIn = chordFromKeyEvent({ key: 'i', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(markIn)?.id === 'timeline:mark-in', 'bare I resolves to timeline:mark-in');

  const importMedia = chordFromKeyEvent({ key: 'i', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(importMedia)?.id === 'file:import-media', 'Cmd+I resolves to file:import-media, distinct from bare I');

  const space = chordFromKeyEvent({ key: ' ', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(space)?.id === 'timeline:play-pause', 'Space resolves to timeline:play-pause');

  const liftDelete = chordFromKeyEvent({ key: 'Delete', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(liftDelete)?.id === 'timeline:delete-lift', 'Shift+Delete resolves to timeline:delete-lift');

  const rippleDelete = chordFromKeyEvent({ key: 'Delete', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(rippleDelete)?.id === 'timeline:delete-ripple', 'Delete resolves to timeline:delete-ripple');

  const unbound = chordFromKeyEvent({ key: 'z', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, true);
  check(findBindingForChord(unbound) === undefined, 'Cmd+Z has no registry entry');
}

// typing-target guard
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
