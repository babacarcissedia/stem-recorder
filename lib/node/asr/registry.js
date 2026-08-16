'use strict';

/**
 * ASR provider registry. Each provider is one file under lib/asr/providers/
 * exporting a capability descriptor + an invoke(ctx) function; adding a
 * provider is one file plus one register() line below. lib/transcribe.js
 * resolves providers through here instead of branching inline.
 */

const providers = new Map();

function register(descriptor) {
  if (!descriptor || !descriptor.id) throw new Error('ASR provider descriptor needs an id');
  providers.set(descriptor.id, descriptor);
}

function get(id) {
  const provider = providers.get(id);
  if (!provider) throw new Error(`unknown ASR provider: ${id}`);
  return provider;
}

function list() {
  return [...providers.values()];
}

/**
 * Test-only: mock a provider's behavior, restore with the returned function.
 * Mutates the registered descriptor object in place (rather than swapping
 * the map entry) so a reference captured before stub() — e.g.
 * lib/transcribe.js holding `localProvider` at module load — sees the mock
 * too, instead of silently keeping the real one.
 */
function stub(id, descriptor) {
  const existing = providers.get(id);
  if (!existing) {
    register({ id, ...descriptor });
    return () => providers.delete(id);
  }
  const before = { ...existing };
  Object.keys(existing).forEach((k) => delete existing[k]);
  Object.assign(existing, before, descriptor, { id });
  return () => {
    Object.keys(existing).forEach((k) => delete existing[k]);
    Object.assign(existing, before);
  };
}

register(require('./providers/local'));
register(require('./providers/cloud'));

module.exports = {
  register, get, list, stub,
};
