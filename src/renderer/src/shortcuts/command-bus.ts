import type { ShortcutCommandId } from '../../../../lib/domain/shortcuts.ts';

export type CommandHandler = (id: ShortcutCommandId) => void;
export type CommandAvailability = (id: ShortcutCommandId) => boolean;
export type CommandAvailabilityListener = () => void;

interface CommandSubscription {
  handler: CommandHandler;
  isAvailable: CommandAvailability;
}

const subscriptions = new Set<CommandSubscription>();
const availabilityListeners = new Set<CommandAvailabilityListener>();

export function onCommand(
  handler: CommandHandler,
  isAvailable: CommandAvailability = () => true,
): () => void {
  const subscription = { handler, isAvailable };
  subscriptions.add(subscription);
  notifyCommandAvailabilityChanged();
  return () => {
    subscriptions.delete(subscription);
    notifyCommandAvailabilityChanged();
  };
}

export function onCommandAvailabilityChange(listener: CommandAvailabilityListener): () => void {
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

export function notifyCommandAvailabilityChanged(): void {
  for (const listener of availabilityListeners) listener();
}

export function canDispatchCommand(id: ShortcutCommandId): boolean {
  return [...subscriptions].some((subscription) => subscription.isAvailable(id));
}

export function dispatchCommand(id: ShortcutCommandId): void {
  for (const subscription of subscriptions) {
    if (subscription.isAvailable(id)) subscription.handler(id);
  }
}
