export class InvariantError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'InvariantError';
    this.code = code;
  }
}

export function invariant(condition: unknown, code: string, detail?: string): void {
  if (!condition) throw new InvariantError(code, detail);
}
