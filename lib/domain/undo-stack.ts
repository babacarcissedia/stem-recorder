'use strict';

/** Pure in-session undo/redo stack for Edit-T1 clip ops. Dual CJS + browser. */
const api = (() => {
  const DEFAULT_LIMIT = 100;

  function createUndoStack(limit) {
    const max = Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
    let past = [];
    let future = [];

    return {
      /** Record the state as it was BEFORE a mutation. Clears the redo stack. */
      push(state) {
        past.push(state);
        if (past.length > max) past.shift();
        future = [];
      },
      /** Returns the previous state, moving `current` onto the redo stack. Null if empty. */
      undo(current) {
        if (!past.length) return null;
        future.push(current);
        return past.pop();
      },
      /** Returns the next state, moving `current` back onto the undo stack. Null if empty. */
      redo(current) {
        if (!future.length) return null;
        past.push(current);
        if (past.length > max) past.shift();
        return future.pop();
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
