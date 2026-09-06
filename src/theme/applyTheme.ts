// One place that flips the theme: the html attribute, the persisted key
// (kept under its original name so existing installs remember their choice),
// and the browser-chrome colour so the PWA status bar follows the console.

export const THEME_COLORS = { dark: '#08080a', light: '#f4f1ea' } as const;

export type ThemeName = keyof typeof THEME_COLORS;

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('rivendell:theme', theme);
  } catch {
    /* private mode */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
