const PRODUCTION_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' app: data: blob:",
  "media-src 'self' app: blob:",
].join('; ');

const DEVELOPMENT_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' app: data: blob:",
  "media-src 'self' app: blob:",
].join('; ');

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return isDevelopment ? DEVELOPMENT_POLICY : PRODUCTION_POLICY;
}
