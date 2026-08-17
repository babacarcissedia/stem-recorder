import { useEffect } from 'react';

import { chordFromKeyEvent, findBindingForChord, isTypingTarget } from '../../../../lib/domain/shortcuts.ts';
import { canDispatchCommand, dispatchCommand } from './command-bus.ts';

const isMac = navigator.platform.toUpperCase().includes('MAC');

export function subscribeKeyboardShortcuts(): () => void {
  const offMenuCommand = window.stemMenu?.onCommand((command) => {
    if (canDispatchCommand(command)) dispatchCommand(command);
  });

  function handleKeyDown(event: KeyboardEvent): void {
    const binding = findBindingForChord(chordFromKeyEvent(event, isMac));
    if (!binding || !binding.enabled) return;

    const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
    const typing = Boolean(target) && isTypingTarget({ tagName: target!.tagName ?? '', isContentEditable: Boolean(target!.isContentEditable) });
    if (binding.guardTyping && typing) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (canDispatchCommand(binding.id)) dispatchCommand(binding.id);
  }

  window.addEventListener('keydown', handleKeyDown, true);
  return () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    offMenuCommand?.();
  };
}

export function useKeyboardShortcuts(): void {
  useEffect(() => subscribeKeyboardShortcuts(), []);
}
