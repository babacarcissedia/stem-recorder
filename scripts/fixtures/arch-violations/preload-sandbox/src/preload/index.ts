import fs from 'node:fs';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('stemStudio', {
  listTakes: () => ipcRenderer.invoke('studio:listTakes'),
  readAnything: (file: string) => fs.readFileSync(file, 'utf8'),
});
