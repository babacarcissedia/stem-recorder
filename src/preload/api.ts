export interface BatchRecorderBridge {
  isDesktop: true;
  outRoot(): Promise<string>;
  beginTake(stamp: string): Promise<string>;
  saveTrack(payload: { takeDir: string; kind: string; ext: string; data: ArrayBuffer | Uint8Array }): Promise<string>;
  openTake(takeDir: string): Promise<void>;
}

export interface StemStudioBridge {
  listTakes(): Promise<any>;
  getTake(takeId: string): Promise<any>;
  saveManifest(takeId: string, doc: unknown): Promise<any>;
  apply(takeId: string): Promise<any>;
  openTakeFolder(takeId: string): Promise<void>;
  revealStem(takeId: string, stemFile: string): Promise<void>;
  ffmpegOk(): Promise<boolean>;
  getFilmstrip(takeId: string, stemFile: string): Promise<any>;
  getWaveform(takeId: string): Promise<any>;
  transcribe(payload: { takeId: string; provider?: string }): Promise<any>;
  getTranscript(takeId: string): Promise<any>;
  setCueText(takeId: string, index: number, text: string): Promise<any>;
  chooseMusic(): Promise<string | null>;
  asrStatus(): Promise<any>;
  exportBundle(takeId: string): Promise<any>;
}
