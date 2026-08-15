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
  revealStem: (takeId, stemFile) => ipcRenderer.invoke('studio:revealStem', takeId, stemFile),
  ffmpegOk: () => ipcRenderer.invoke('studio:ffmpegOk'),
  getFilmstrip: (takeId, stemFile) => ipcRenderer.invoke('studio:getFilmstrip', takeId, stemFile),
  getWaveform: (takeId) => ipcRenderer.invoke('studio:getWaveform', takeId),
  transcribe: (payload) => ipcRenderer.invoke('studio:transcribe', payload),
  getTranscript: (takeId) => ipcRenderer.invoke('studio:getTranscript', takeId),
  setCueText: (takeId, index, text) => ipcRenderer.invoke('studio:setCueText', takeId, index, text),
  chooseMusic: () => ipcRenderer.invoke('studio:chooseMusic'),
  asrStatus: () => ipcRenderer.invoke('studio:asrStatus'),
};

contextBridge.exposeInMainWorld('batchRecorder', recorder);
contextBridge.exposeInMainWorld('stemStudio', studio);
