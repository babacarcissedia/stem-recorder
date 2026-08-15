'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const recorder = {
  isDesktop: true,
  outRoot: () => ipcRenderer.invoke('recorder:outRoot'),
  beginTake: (stamp) => ipcRenderer.invoke('recorder:beginTake', stamp),
  saveTrack: (payload) => ipcRenderer.invoke('recorder:saveTrack', payload),
  openTake: (takeDir) => ipcRenderer.invoke('recorder:openTake', takeDir),
};

const studio = {
  listTakes: () => ipcRenderer.invoke('studio:listTakes'),
  getTake: (takeId) => ipcRenderer.invoke('studio:getTake', takeId),
  saveManifest: (takeId, doc) => ipcRenderer.invoke('studio:saveManifest', takeId, doc),
  apply: (takeId) => ipcRenderer.invoke('studio:apply', takeId),
  openTakeFolder: (takeId) => ipcRenderer.invoke('studio:openTakeFolder', takeId),
  ffmpegOk: () => ipcRenderer.invoke('studio:ffmpegOk'),
};

contextBridge.exposeInMainWorld('batchRecorder', recorder);
contextBridge.exposeInMainWorld('stemStudio', studio);
