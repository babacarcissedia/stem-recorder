import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';

import { MEDIA_SCHEME, MEDIA_HOST, BUNDLE_HOST, fromMediaUrl } from '../../lib/node/media-url.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

function forbidden(): Response {
  return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
}

function bodyFrom(filePath: string, start: number, end: number): BodyInit {
  const stream = fs.createReadStream(filePath, { start, end });
  return Readable.toWeb(stream) as unknown as BodyInit;
}

async function serveFile(filePath: string, request: Request, extraHeaders: Record<string, string>): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const headers: Record<string, string> = {
    'content-type': contentTypeFor(filePath),
    'accept-ranges': 'bytes',
    ...extraHeaders,
  };

  const rangeHeader = request.headers.get('range');
  const match = rangeHeader ? RANGE_PATTERN.exec(rangeHeader.trim()) : null;
  if (!match) {
    return new Response(bodyFrom(filePath, 0, Math.max(stat.size - 1, 0)), {
      status: 200,
      headers: { ...headers, 'content-length': String(stat.size) },
    });
  }

  const hasStart = match[1] !== '';
  const start = hasStart ? Number(match[1]) : Math.max(stat.size - Number(match[2] || 0), 0);
  const end = hasStart && match[2] !== '' ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
  }

  return new Response(bodyFrom(filePath, start, end), {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export function handleAppScheme(options: {
  bundleDir: string;
  mediaRoots: () => string[];
  documentHeaders: Record<string, string>;
}): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);

    if (url.host === BUNDLE_HOST) {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const resolved = path.resolve(options.bundleDir, relative);
      if (resolved !== options.bundleDir && !resolved.startsWith(options.bundleDir + path.sep)) return forbidden();
      const isDocument = path.extname(resolved).toLowerCase() === '.html';
      return serveFile(resolved, request, isDocument ? options.documentHeaders : {});
    }

    if (url.host === MEDIA_HOST) {
      const resolved = fromMediaUrl(request.url);
      if (!resolved) return notFound();
      const allowed = options.mediaRoots().some(
        (root) => resolved === root || resolved.startsWith(path.resolve(root) + path.sep)
      );
      if (!allowed) return forbidden();
      return serveFile(resolved, request, {});
    }

    return notFound();
  });
}
