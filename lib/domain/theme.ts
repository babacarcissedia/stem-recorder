import type { ShortcutCommandId } from './shortcuts.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Match System',
  light: 'Light',
  dark: 'Dark',
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as string[]).includes(value);
}

export function themeCommandId(preference: ThemePreference): ShortcutCommandId {
  return `view:theme-${preference}` as ShortcutCommandId;
}

export function preferenceFromCommand(command: string): ThemePreference | null {
  const preference = command.startsWith('view:theme-') ? command.slice('view:theme-'.length) : null;
  return isThemePreference(preference) ? preference : null;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}
