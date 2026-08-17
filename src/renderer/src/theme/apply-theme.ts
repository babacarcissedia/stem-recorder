import type { ThemeState } from '../../../preload/api.ts';

export function applyTheme(state: ThemeState): void {
  document.documentElement.dataset.theme = state.resolved;
  document.documentElement.dataset.themePreference = state.preference;
  document.documentElement.style.colorScheme = state.resolved;
}

export function startThemeSync(): () => void {
  const bridge = window.stemTheme;
  if (!bridge) {
    applyTheme({
      preference: 'system',
      resolved: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    });
    return () => {};
  }
  void bridge.get().then(applyTheme);
  return bridge.onChanged(applyTheme);
}
