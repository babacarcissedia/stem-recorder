import { app, shell, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

import { canDispatchMenuCommand, type MenuCommand } from '../preload/api.ts';

function sendCommand(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

function commandItem(
  label: string,
  command: MenuCommand,
  editorCommandsEnabled: boolean,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    enabled: canDispatchMenuCommand(command, editorCommandsEnabled),
    click: () => sendCommand(command),
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
        commandItem('New Take', 'file:new-take', editorCommandsEnabled, 'CmdOrCtrl+N'),
        commandItem('Open Take Folder', 'file:open-take-folder', editorCommandsEnabled, 'CmdOrCtrl+O'),
        { type: 'separator' },
        commandItem('Export Bundle…', 'file:export-bundle', editorCommandsEnabled, 'CmdOrCtrl+E'),
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
        commandItem('Split', 'timeline:split', editorCommandsEnabled, 'CmdOrCtrl+B'),
        { type: 'separator' },
        commandItem('Mark In', 'timeline:mark-in', editorCommandsEnabled, 'I'),
        commandItem('Mark Out', 'timeline:mark-out', editorCommandsEnabled, 'O'),
        { type: 'separator' },
        commandItem('Play/Pause', 'timeline:play-pause', editorCommandsEnabled, 'Space'),
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
