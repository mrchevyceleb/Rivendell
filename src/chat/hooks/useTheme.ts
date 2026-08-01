import { useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

// Unified with the app-wide theme (shell/Studio.tsx): same storage key
// (`rivendell:theme`), same `data-theme` attribute on <html>, default `dark`.
// The prototype's `riv-theme` key was standalone-file-only and is dropped here.

const STORAGE_KEY = 'rivendell:theme';

function readStored(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function applyDom(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

// Module-level store so every useTheme() instance (multiple Studio chat tabs)
// shares one source of truth and stays in sync, instead of each holding its own
// stale state against the shared <html data-theme> + storage key.
let memoryTheme: Theme = readStored();
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getTheme() {
  return memoryTheme;
}

function commit(theme: Theme) {
  if (theme === memoryTheme) return;
  memoryTheme = theme;
  applyDom(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* quota / private mode */
  }
  emit();
}

// Keep in sync with other tabs/windows editing the same key.
if (typeof window !== 'undefined') {
  applyDom(memoryTheme);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      const next: Theme = e.newValue === 'light' ? 'light' : 'dark';
      if (next !== memoryTheme) {
        memoryTheme = next;
        applyDom(next);
        emit();
      }
    }
  });
}

export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'dark' as Theme);
  // Ensure the DOM reflects the current theme even on the first mount.
  useEffect(() => {
    applyDom(theme);
  }, [theme]);

  return {
    theme,
    toggle: () => commit(theme === 'light' ? 'dark' : 'light'),
    setTheme: commit,
  };
}
