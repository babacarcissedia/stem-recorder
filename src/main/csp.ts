const PRODUCTION_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' app: data: blob:",
  "media-src 'self' app: blob: data:",
  "connect-src 'self' app: https://fonts.googleapis.com https://fonts.gstatic.com https://asr.traxelio.com",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const DEVELOPMENT_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' app: data: blob:",
  "media-src 'self' app: blob: data:",
  "connect-src 'self' app: ws: http://localhost:* https://fonts.googleapis.com https://fonts.gstatic.com https://asr.traxelio.com",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return isDevelopment ? DEVELOPMENT_POLICY : PRODUCTION_POLICY;
}
