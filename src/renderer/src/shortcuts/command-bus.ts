import type { ShortcutCommandId } from '../../../../lib/domain/shortcuts.ts';

export type CommandHandler = (id: ShortcutCommandId) => void;

const handlers = new Set<CommandHandler>();

export function onCommand(handler: CommandHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function dispatchCommand(id: ShortcutCommandId): void {
  for (const handler of handlers) handler(id);
}
