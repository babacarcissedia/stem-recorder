'use strict';

export type UndoStack<T> = {
  push(state: T): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
};

/** Pure in-session undo/redo stack for Edit-T1 clip ops. Dual CJS + browser. */
const api = (() => {
  const DEFAULT_LIMIT = 100;

  function createUndoStack<T>(limit?: number | null): UndoStack<T> {
    const max = Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
    let past: T[] = [];
    let future: T[] = [];

    return {
      /** Record the state as it was BEFORE a mutation. Clears the redo stack. */
      push(state: T) {
        past.push(state);
        if (past.length > max) past.shift();
        future = [];
      },
      /** Returns the previous state, moving `current` onto the redo stack. Null if empty. */
      undo(current: T): T | null {
        if (!past.length) return null;
        future.push(current);
        return past.pop()!;
      },
      /** Returns the next state, moving `current` back onto the undo stack. Null if empty. */
      redo(current: T): T | null {
        if (!future.length) return null;
        past.push(current);
        if (past.length > max) past.shift();
        return future.pop()!;
      },
      canUndo() {
        return past.length > 0;
      },
      canRedo() {
        return future.length > 0;
      },
      clear() {
        past = [];
        future = [];
      },
    };
  }

  return { createUndoStack, DEFAULT_LIMIT };
})();

export const {
  createUndoStack,
  DEFAULT_LIMIT,
} = api;
