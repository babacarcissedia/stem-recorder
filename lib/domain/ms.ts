import { invariant } from './invariant.ts';

export type Ms = number;

export const MS_PER_SECOND = 1000;

export function assertMs(value: unknown, field: string): Ms {
  invariant(typeof value === 'number', 'MS_NOT_A_NUMBER', field);
  const num = value as number;
  invariant(Number.isFinite(num), 'MS_NOT_FINITE', field);
  invariant(Number.isInteger(num), 'MS_NOT_INTEGER', `${field}=${num}`);
  return num;
}

export function assertNonNegativeMs(value: unknown, field: string): Ms {
  const ms = assertMs(value, field);
  invariant(ms >= 0, 'MS_NEGATIVE', `${field}=${ms}`);
  return ms;
}

export function assertPositiveMs(value: unknown, field: string): Ms {
  const ms = assertMs(value, field);
  invariant(ms > 0, 'MS_NOT_POSITIVE', `${field}=${ms}`);
  return ms;
}

export function secondsToMs(seconds: number): Ms {
  invariant(Number.isFinite(seconds), 'SECONDS_NOT_FINITE');
  return Math.round(seconds * MS_PER_SECOND);
}

export function msToSeconds(ms: Ms): number {
  return assertMs(ms, 'ms') / MS_PER_SECOND;
}

export function formatTimecode(ms: Ms): string {
  const total = assertMs(ms, 'ms');
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const minutes = Math.floor(abs / 60000);
  const seconds = Math.floor((abs % 60000) / 1000);
  const millis = abs % 1000;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${sign}${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}
