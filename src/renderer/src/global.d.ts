import type { BatchRecorderBridge, MenuBridge, StemStudioBridge, ThemeBridge } from '../../preload/api.ts';

declare global {
  interface Window {
    batchRecorder?: BatchRecorderBridge;
    stemStudio?: StemStudioBridge;
    stemMenu?: MenuBridge;
    stemTheme?: ThemeBridge;
  }
}

export {};
