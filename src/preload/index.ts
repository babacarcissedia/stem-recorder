import { contextBridge, ipcRenderer } from 'electron';

import {
  isMenuCommand,
  type BatchRecorderBridge,
  type MenuBridge,
  type StemStudioBridge,
  type ThemeBridge,
  type ThemeState,
} from './api.ts';

const recorder: BatchRecorderBridge = {
  isDesktop: true,
  outRoot: () => ipcRenderer.invoke('recorder:outRoot'),
  beginTake: (stamp) => ipcRenderer.invoke('recorder:beginTake', stamp),
  saveTrack: (payload) => ipcRenderer.invoke('recorder:saveTrack', payload),
  openTake: (takeDir) => ipcRenderer.invoke('recorder:openTake', takeDir),
};

const studio: StemStudioBridge = {
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
  exportBundle: (takeId) => ipcRenderer.invoke('studio:exportBundle', takeId),
};

const menu: MenuBridge = {
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => {
      if (isMenuCommand(command)) listener(command);
    };
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  },
  setEditorCommandsEnabled: (enabled) => ipcRenderer.send('menu:set-editor-commands-enabled', enabled),
};

const theme: ThemeBridge = {
  get: () => ipcRenderer.invoke('theme:get'),
  set: (preference) => ipcRenderer.invoke('theme:set', preference),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ThemeState) => listener(state);
    ipcRenderer.on('theme:changed', handler);
    return () => ipcRenderer.removeListener('theme:changed', handler);
  },
};

contextBridge.exposeInMainWorld('batchRecorder', recorder);
contextBridge.exposeInMainWorld('stemStudio', studio);
contextBridge.exposeInMainWorld('stemMenu', menu);
contextBridge.exposeInMainWorld('stemTheme', theme);
