import type { BatchRecorderBridge, StemStudioBridge } from '../../preload/api.ts';

declare global {
  interface Window {
    batchRecorder?: BatchRecorderBridge;
    stemStudio?: StemStudioBridge;
  }
}

export {};
