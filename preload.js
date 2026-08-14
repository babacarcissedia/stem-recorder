'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('batchRecorder', {
  isDesktop: true,
  outRoot: () => ipcRenderer.invoke('recorder:outRoot'),
  beginTake: (stamp) => ipcRenderer.invoke('recorder:beginTake', stamp),
  saveTrack: (payload) => ipcRenderer.invoke('recorder:saveTrack', payload),
  openTake: (takeDir) => ipcRenderer.invoke('recorder:openTake', takeDir),
});
