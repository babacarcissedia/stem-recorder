#!/usr/bin/env node
import assert from 'node:assert';

import {
  EDITOR_MENU_COMMANDS,
  MENU_COMMANDS,
  canDispatchMenuCommand,
} from '../src/preload/api.ts';

function handlers(invocations: Map<string, number>): Record<(typeof MENU_COMMANDS)[number], () => void> {
  const menuActions = {} as Record<(typeof MENU_COMMANDS)[number], () => void>;
  for (const command of MENU_COMMANDS) {
    menuActions[command] = () => {
      invocations.set(command, (invocations.get(command) || 0) + 1);
    };
  }
  return menuActions;
}

function dispatchMenuCommand(
  command: (typeof MENU_COMMANDS)[number],
  editorCommandsEnabled: boolean,
  menuActions: Record<(typeof MENU_COMMANDS)[number], () => void>,
): void {
  if (!canDispatchMenuCommand(command, editorCommandsEnabled)) return;
  menuActions[command]();
}

{
  const invocations = new Map<string, number>();
  const menuActions = handlers(invocations);

  for (const command of MENU_COMMANDS) {
    dispatchMenuCommand(command, false, menuActions);
  }

  for (const command of EDITOR_MENU_COMMANDS) {
    assert.strictEqual(invocations.get(command) || 0, 0, `${command} ran before an editable take loaded`);
  }
  assert.strictEqual(invocations.get('file:new-take'), 1);
}

{
  const invocations = new Map<string, number>();
  const menuActions = handlers(invocations);

  for (const command of MENU_COMMANDS) {
    dispatchMenuCommand(command, true, menuActions);
  }

  for (const command of MENU_COMMANDS) {
    assert.strictEqual(invocations.get(command), 1, `${command} did not dispatch exactly once in Edit`);
  }
}

console.log(JSON.stringify({ ok: true, commands: MENU_COMMANDS.length }));
