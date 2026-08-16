import { app, shell, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

export type MenuCommand =
  | 'file:new-take'
  | 'file:open-take-folder'
  | 'file:import-media'
  | 'file:export-bundle'
  | 'timeline:split'
  | 'timeline:join'
  | 'timeline:delete-ripple'
  | 'timeline:delete-lift'
  | 'timeline:mark-in'
  | 'timeline:mark-out'
  | 'timeline:play-pause';

function sendCommand(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu:command', command);
}

function commandItem(label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(command) };
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
        commandItem('New Take', 'file:new-take', 'CmdOrCtrl+N'),
        commandItem('Open Take Folder', 'file:open-take-folder', 'CmdOrCtrl+O'),
        { type: 'separator' },
        commandItem('Import Media…', 'file:import-media', 'CmdOrCtrl+I'),
        commandItem('Export Bundle…', 'file:export-bundle', 'CmdOrCtrl+E'),
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
        commandItem('Split', 'timeline:split', 'CmdOrCtrl+B'),
        commandItem('Join', 'timeline:join', 'CmdOrCtrl+Shift+B'),
        { type: 'separator' },
        commandItem('Delete (Ripple)', 'timeline:delete-ripple', 'Delete'),
        commandItem('Delete (Lift)', 'timeline:delete-lift', 'Shift+Delete'),
        { type: 'separator' },
        commandItem('Mark In', 'timeline:mark-in', 'I'),
        commandItem('Mark Out', 'timeline:mark-out', 'O'),
        { type: 'separator' },
        commandItem('Play/Pause', 'timeline:play-pause', 'Space'),
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
