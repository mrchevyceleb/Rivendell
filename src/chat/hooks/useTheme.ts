import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'rivendell:chat-theme';

function readStored(): Theme | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'dark' || v === 'light' ? v : null;
}

function systemPreference(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(() => readStored() ?? systemPreference());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState((t) => (t === 'light' ? 'dark' : 'light')),
  };
}
