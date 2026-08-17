import fs from 'fs';
import path from 'path';

import { app, nativeTheme, BrowserWindow } from 'electron';

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '../../lib/domain/theme.ts';

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'theme.json');
}

function readPersisted(): ThemePreference {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return isThemePreference(parsed?.preference) ? parsed.preference : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function persist(next: ThemePreference): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ preference: next }, null, 2));
  } catch {
    /* an unwritable preference must not stop this session from theming */
  }
}

export function themeState(): ThemeState {
  return { preference, resolved: resolveTheme(preference, nativeTheme.shouldUseDarkColors) };
}

function broadcast(): void {
  const state = themeState();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('theme:changed', state);
}

export function setThemePreference(next: ThemePreference): ThemeState {
  preference = next;
  nativeTheme.themeSource = next;
  persist(next);
  broadcast();
  return themeState();
}

export function initTheme(): ThemeState {
  preference = readPersisted();
  nativeTheme.themeSource = preference;
  nativeTheme.on('updated', broadcast);
  return themeState();
}
