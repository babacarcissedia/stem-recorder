import { useEffect } from 'react';

import { chordFromKeyEvent, findBindingForChord, isTypingTarget } from '../../../../lib/domain/shortcuts.ts';
import { dispatchCommand } from './command-bus.ts';

const isMac = navigator.platform.toUpperCase().includes('MAC');

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const offMenuCommand = window.stemMenu?.onCommand((command) => dispatchCommand(command as Parameters<typeof dispatchCommand>[0]));

    function handleKeyDown(event: KeyboardEvent): void {
      const binding = findBindingForChord(chordFromKeyEvent(event, isMac));
      if (!binding || !binding.enabled) return;

      const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
      const typing = Boolean(target) && isTypingTarget({ tagName: target!.tagName ?? '', isContentEditable: Boolean(target!.isContentEditable) });
      if (binding.guardTyping && typing) return;

      event.preventDefault();
      dispatchCommand(binding.id);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      offMenuCommand?.();
    };
  }, []);
}
