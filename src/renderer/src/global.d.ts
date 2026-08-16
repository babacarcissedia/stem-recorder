import type { BatchRecorderBridge, MenuBridge, StemStudioBridge } from '../../preload/api.ts';

declare global {
  interface Window {
    batchRecorder?: BatchRecorderBridge;
    stemStudio?: StemStudioBridge;
    stemMenu?: MenuBridge;
  }
}

export {};
