export const MENU_COMMANDS = [
  'file:new-take',
  'file:open-take-folder',
  'file:export-bundle',
  'timeline:split',
  'timeline:mark-in',
  'timeline:mark-out',
  'timeline:play-pause',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(command: string): command is MenuCommand {
  return (MENU_COMMANDS as readonly string[]).includes(command);
}

export interface BatchRecorderBridge {
  isDesktop: true;
  outRoot(): Promise<string>;
  beginTake(stamp: string): Promise<string>;
  saveTrack(payload: { takeDir: string; kind: string; ext: string; data: ArrayBuffer | Uint8Array }): Promise<string>;
  openTake(takeDir: string): Promise<void>;
}

export interface MenuBridge {
  onCommand(listener: (command: MenuCommand) => void): () => void;
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
