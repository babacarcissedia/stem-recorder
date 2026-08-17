export type ShortcutCommandId =
  | 'file:new-take'
  | 'file:open-take-folder'
  | 'file:export-bundle'
  | 'timeline:split'
  | 'timeline:delete-ripple'
  | 'timeline:mark-in'
  | 'timeline:mark-out'
  | 'timeline:play-pause';

export type ShortcutMenuGroup = 'File' | 'Timeline';

export interface ShortcutBinding {
  id: ShortcutCommandId;
  label: string;
  accelerator: string;
  menuGroup: ShortcutMenuGroup;
  guardTyping: boolean;
  enabled: boolean;
}

export const SHORTCUT_REGISTRY: ShortcutBinding[] = [
  { id: 'file:new-take', label: 'New Take', accelerator: 'CmdOrCtrl+N', menuGroup: 'File', guardTyping: true, enabled: true },
  { id: 'file:open-take-folder', label: 'Open Take Folder', accelerator: 'CmdOrCtrl+O', menuGroup: 'File', guardTyping: true, enabled: true },
  { id: 'file:export-bundle', label: 'Export Bundle…', accelerator: 'CmdOrCtrl+E', menuGroup: 'File', guardTyping: true, enabled: true },
  { id: 'timeline:split', label: 'Split', accelerator: 'CmdOrCtrl+B', menuGroup: 'Timeline', guardTyping: true, enabled: true },
  { id: 'timeline:delete-ripple', label: 'Delete (Ripple)', accelerator: 'Delete', menuGroup: 'Timeline', guardTyping: true, enabled: true },
  { id: 'timeline:mark-in', label: 'Mark In', accelerator: 'I', menuGroup: 'Timeline', guardTyping: true, enabled: true },
  { id: 'timeline:mark-out', label: 'Mark Out', accelerator: 'O', menuGroup: 'Timeline', guardTyping: true, enabled: true },
  { id: 'timeline:play-pause', label: 'Play/Pause', accelerator: 'Space', menuGroup: 'Timeline', guardTyping: true, enabled: true },
];

export interface KeyChord {
  key: string;
  shift: boolean;
  primary: boolean;
  alt: boolean;
}

function normalizeKeyToken(token: string): string {
  if (token === 'Space') return ' ';
  return token.length === 1 ? token.toLowerCase() : token;
}

export function parseAccelerator(accelerator: string): KeyChord {
  const chord: KeyChord = { key: '', shift: false, primary: false, alt: false };
  for (const token of accelerator.split('+')) {
    if (token === 'CmdOrCtrl' || token === 'Cmd' || token === 'Ctrl') chord.primary = true;
    else if (token === 'Shift') chord.shift = true;
    else if (token === 'Alt' || token === 'Option') chord.alt = true;
    else chord.key = normalizeKeyToken(token);
  }
  return chord;
}

export interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function chordFromKeyEvent(event: KeyEventLike, isMac: boolean): KeyChord {
  const key = event.key === ' ' ? ' ' : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return {
    key,
    shift: event.shiftKey,
    primary: isMac ? event.metaKey : event.ctrlKey,
    alt: event.altKey,
  };
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && a.shift === b.shift && a.primary === b.primary && a.alt === b.alt;
}

export function findBindingForChord(chord: KeyChord): ShortcutBinding | undefined {
  return SHORTCUT_REGISTRY.find((binding) => chordsEqual(parseAccelerator(binding.accelerator), chord));
}

export interface TypingTargetDescriptor {
  tagName: string;
  isContentEditable: boolean;
}

const TYPING_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isTypingTarget(descriptor: TypingTargetDescriptor): boolean {
  return descriptor.isContentEditable || TYPING_TAG_NAMES.has(descriptor.tagName.toUpperCase());
}
