import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('stemStudio', {
  listTakes: () => ipcRenderer.invoke('studio:listTakes'),
});
