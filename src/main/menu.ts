import { app, shell, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

import { SHORTCUT_REGISTRY, type ShortcutCommandId } from '../../lib/domain/shortcuts.ts';
import { THEME_PREFERENCES, themeCommandId, type ThemePreference } from '../../lib/domain/theme.ts';
import { setThemePreference, themeState } from './theme.ts';

export type MenuCommand = ShortcutCommandId;

function sendCommand(command: ShortcutCommandId): void {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

function commandItem(id: ShortcutCommandId): MenuItemConstructorOptions {
  const binding = SHORTCUT_REGISTRY.find((entry) => entry.id === id);
  if (!binding) throw new Error(`menu.ts: no SHORTCUT_REGISTRY entry for command '${id}'`);
  return { label: binding.label, accelerator: binding.accelerator, click: () => sendCommand(binding.id) };
}

function themeItem(preference: ThemePreference): MenuItemConstructorOptions {
  const item = commandItem(themeCommandId(preference));
  return { ...item, type: 'radio', checked: themeState().preference === preference, click: () => { setThemePreference(preference); installAppMenu(); } };
}

export function buildAppMenu(appName: string): Menu {
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
        commandItem('file:new-take'),
        commandItem('file:open-take-folder'),
        { type: 'separator' },
        commandItem('file:import-media'),
        commandItem('file:export-bundle'),
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
        { type: 'separator' },
        { label: 'Theme', submenu: THEME_PREFERENCES.map(themeItem) },
      ],
    },
    {
      label: 'Timeline',
      submenu: [
        commandItem('timeline:split'),
        commandItem('timeline:join'),
        { type: 'separator' },
        commandItem('timeline:delete-ripple'),
        commandItem('timeline:delete-lift'),
        { type: 'separator' },
        commandItem('timeline:mark-in'),
        commandItem('timeline:mark-out'),
        { type: 'separator' },
        commandItem('timeline:play-pause'),
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

export function installAppMenu(appName: string = app.getName()): void {
  Menu.setApplicationMenu(buildAppMenu(appName));
}
