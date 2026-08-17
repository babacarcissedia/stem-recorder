import { app, shell, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

import { SHORTCUT_REGISTRY, type ShortcutCommandId } from '../../lib/domain/shortcuts.ts';
import { canDispatchMenuCommand } from '../preload/api.ts';

export type MenuCommand = ShortcutCommandId;

function sendCommand(command: ShortcutCommandId): void {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

function commandItem(id: ShortcutCommandId, editorCommandsEnabled: boolean): MenuItemConstructorOptions {
  const binding = SHORTCUT_REGISTRY.find((entry) => entry.id === id);
  if (!binding) throw new Error(`menu.ts: no SHORTCUT_REGISTRY entry for command '${id}'`);

  return {
    label: binding.label,
    accelerator: binding.accelerator,
    enabled: canDispatchMenuCommand(binding.id, editorCommandsEnabled),
    click: () => sendCommand(binding.id),
  };
}

export function buildAppMenu(appName: string, editorCommandsEnabled: boolean = false): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
        label: appName,
        role: 'appMenu' as const,
      }]
      : []),
    {
      label: 'File',
      submenu: [
        commandItem('file:new-take', editorCommandsEnabled),
        commandItem('file:open-take-folder', editorCommandsEnabled),
        { type: 'separator' },
        commandItem('file:export-bundle', editorCommandsEnabled),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Timeline',
      submenu: [
        commandItem('timeline:split', editorCommandsEnabled),
        { type: 'separator' },
        commandItem('timeline:delete-ripple', editorCommandsEnabled),
        { type: 'separator' },
        commandItem('timeline:mark-in', editorCommandsEnabled),
        commandItem('timeline:mark-out', editorCommandsEnabled),
        { type: 'separator' },
        commandItem('timeline:play-pause', editorCommandsEnabled),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `${appName} on GitHub`,
          click: () => shell.openExternal('https://github.com/babacarcissedia/stem-recorder'),
        },
        ...(isMac ? [] : [{ label: `About ${appName}`, role: 'about' as const }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

export function installAppMenu(appName: string = app.getName(), editorCommandsEnabled: boolean = false): void {
  Menu.setApplicationMenu(buildAppMenu(appName, editorCommandsEnabled));
}
