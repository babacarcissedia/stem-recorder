'use strict';

const crypto = require('crypto');
const path = require('path');

const MEDIA_SCHEME = 'app';
const MEDIA_HOST = 'media';
const BUNDLE_HOST = 'bundle';
const SIGNING_KEY = crypto.randomBytes(32);

function signatureFor(encodedPath) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(encodedPath).digest('base64url');
}

function signaturesMatch(actual, expected) {
  const actualBytes = Buffer.from(actual, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function toMediaUrl(absolutePath) {
  const encoded = Buffer.from(path.resolve(absolutePath), 'utf8').toString('base64url');
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encoded}.${signatureFor(encoded)}`;
}

function fromMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== MEDIA_HOST) return null;

  let token;
  try {
    token = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  } catch {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;

  const [encoded, signature] = parts;
  if (!signaturesMatch(signature, signatureFor(encoded))) return null;

  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!decoded || Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) return null;
  return path.resolve(decoded);
}

module.exports = {
  MEDIA_SCHEME,
  MEDIA_HOST,
  BUNDLE_HOST,
  toMediaUrl,
  fromMediaUrl,
};
