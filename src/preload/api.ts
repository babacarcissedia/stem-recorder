export interface BatchRecorderBridge {
  isDesktop: true;
  outRoot(): Promise<string>;
  beginTake(stamp: string): Promise<string>;
  saveTrack(payload: { takeDir: string; kind: string; ext: string; data: ArrayBuffer | Uint8Array }): Promise<string>;
  openTake(takeDir: string): Promise<void>;
}

import type { ThemePreference } from '../../lib/domain/theme.ts';
import type { ProjectJson } from '../../lib/domain/project.ts';
import type { ManifestSettings } from '../../lib/domain/manifest-v2.ts';

export interface LoadedTakeProject {
  takeId: string;
  takeDir: string;
  schemaVersion: number;
  hasManifest: boolean;
  migrated: boolean;
  backup: string | null;
  missingSources: string[];
  settings: ManifestSettings;
  project: ProjectJson;
}

export interface TakeSummary {
  id: string;
  dir: string;
  hasScreen: boolean;
  hasCam: boolean;
  hasAudio: boolean;
  hasManifest: boolean;
  hasFinal: boolean;
  mtimeMs: number;
}

export interface ThemeState {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
}

export interface ThemeBridge {
  get(): Promise<ThemeState>;
  set(preference: ThemePreference): Promise<ThemeState>;
  onChanged(listener: (state: ThemeState) => void): () => void;
}

export interface MenuBridge {
  onCommand(listener: (command: string) => void): () => void;
}

export interface StemStudioBridge {
  listTakes(): Promise<TakeSummary[]>;
  getTake(takeId: string): Promise<any>;
  loadProject(takeId: string): Promise<LoadedTakeProject>;
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
