'use strict';

const path = require('path');

const MEDIA_SCHEME = 'app';
const MEDIA_HOST = 'media';
const BUNDLE_HOST = 'bundle';

function toMediaUrl(absolutePath) {
  const encoded = Buffer.from(absolutePath, 'utf8').toString('base64url');
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encoded}`;
}

function fromMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== MEDIA_HOST) return null;
  const encoded = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (!encoded) return null;
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  return decoded ? path.resolve(decoded) : null;
}

module.exports = {
  MEDIA_SCHEME,
  MEDIA_HOST,
  BUNDLE_HOST,
  toMediaUrl,
  fromMediaUrl,
};
