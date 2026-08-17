import type { ShortcutCommandId } from '../../../../lib/domain/shortcuts.ts';

export type CommandHandler = (id: ShortcutCommandId) => void;
export type CommandAvailability = (id: ShortcutCommandId) => boolean;

interface CommandSubscription {
  handler: CommandHandler;
  isAvailable: CommandAvailability;
}

const subscriptions = new Set<CommandSubscription>();

export function onCommand(
  handler: CommandHandler,
  isAvailable: CommandAvailability = () => true,
): () => void {
  const subscription = { handler, isAvailable };
  subscriptions.add(subscription);
  return () => subscriptions.delete(subscription);
}

export function canDispatchCommand(id: ShortcutCommandId): boolean {
  return [...subscriptions].some((subscription) => subscription.isAvailable(id));
}

export function dispatchCommand(id: ShortcutCommandId): void {
  for (const subscription of subscriptions) {
    if (subscription.isAvailable(id)) subscription.handler(id);
  }
}
