import { useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Annals } from './rooms/Annals';
import { Calendar } from './rooms/Calendar';
import { Council } from './rooms/Council';
import { Dashboard } from './rooms/Dashboard';
import { Forge } from './rooms/Forge';
import { Hall } from './rooms/Hall';
import { Library } from './rooms/Library';
import { Workspace } from './rooms/Workspace';
import { Pins } from './rooms/Pins';
import { Reckoning } from './rooms/Reckoning';
import { Scribe } from './rooms/Scribe';
import { Tidings } from './rooms/Tidings';
import { Weavings } from './rooms/Weavings';
import { Layout } from './shell/Layout';
import { ProxyViewerProvider } from './components/ProxyViewer';
import { rooms } from './data/mock';
import type { RoomKey } from './data/types';

const queryClient = new QueryClient();
const roomKeys = new Set(rooms.map((room) => room.key));
const removedRoomRedirects: Partial<Record<string, RoomKey>> = {
  '/hearth': '/calendar',
};
const TABS_KEY = 'rivendell:room-tabs';
const ACTIVE_TAB_KEY = 'rivendell:room-active-tab';

function resolvePath(path: string): { room: RoomKey; canonical: boolean } {
  if (roomKeys.has(path as RoomKey)) return { room: path as RoomKey, canonical: true };
  return { room: removedRoomRedirects[path] ?? '/', canonical: false };
}

function readTabs(initial: RoomKey): RoomKey[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((value): value is RoomKey => (
          typeof value === 'string' && roomKeys.has(value as RoomKey)
        ));
        const tabs = filtered.includes(initial) ? filtered : [...filtered, initial];
        if (tabs.length > 0) return tabs;
      }
    }
  } catch {
    // fall through
  }
  return [initial];
}

function readStoredActiveTab(tabs: RoomKey[]): RoomKey | null {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY) as RoomKey | null;
    if (stored && tabs.includes(stored)) return stored;
  } catch {
    // fall through
  }
  return null;
}

// URL is the source of truth on initial load. If the user opened or
// refreshed `/library`, they get Library — even if the last persisted
// active tab was something else. Falling back to the persisted active
// tab only happens when the pathname isn't a real room key (e.g. they
// landed on a typo'd URL or `/` after a deep-link reset).
function readInitial(): { tabs: RoomKey[]; active: RoomKey; urlValid: boolean } {
  const rawPath = window.location.pathname;
  const resolved = resolvePath(rawPath);
  if (resolved.canonical) {
    return { tabs: readTabs(resolved.room), active: resolved.room, urlValid: true };
  }
  const tabs = readTabs(resolved.room);
  const stored = readStoredActiveTab(tabs);
  const active = removedRoomRedirects[rawPath] ?? stored ?? tabs[0] ?? '/';
  return { tabs, active, urlValid: false };
}

function RoomSwitch({ active }: { active: RoomKey }) {
  switch (active) {
    case '/council':
      return <Council />;
    case '/dashboard':
      return <Dashboard />;
    case '/tidings':
      return <Tidings />;
    case '/calendar':
      return <Calendar />;
    case '/library':
      return <Library />;
    case '/workspace':
      return <Workspace />;
    case '/pins':
      return <Pins />;
    case '/reckoning':
      return <Reckoning />;
    case '/forge':
      return <Forge />;
    case '/weavings':
      return <Weavings />;
    case '/annals':
      return <Annals />;
    case '/scribe':
      return <Scribe />;
    default:
      return <Hall />;
  }
}

export default function App() {
  const [{ tabs: bootTabs, active: bootActive, urlValid: bootUrlValid }] = useState(() => readInitial());
  const [tabs, setTabs] = useState<RoomKey[]>(bootTabs);
  const [active, setActive] = useState<RoomKey>(bootActive);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rivendell:left-sidebar-collapsed') === 'true');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('rivendell:theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rivendell:theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('rivendell:left-sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, active);
  }, [active]);

  // One-shot URL alignment for the case where the page was opened on an
  // invalid path (e.g. a typo, a stale deep link). For valid paths we
  // already initialized `active` to match, and we leave the URL alone so
  // search/hash like `/library?path=...` survive the boot.
  useEffect(() => {
    if (bootUrlValid) return;
    if (window.location.pathname !== bootActive) {
      window.history.replaceState({}, '', bootActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const resolved = resolvePath(window.location.pathname);
      const next = resolved.room;
      setTabs((prev) => (prev.includes(next) ? prev : [...prev, next]));
      setActive(next);
      if (!resolved.canonical && window.location.pathname !== next) {
        window.history.replaceState({}, '', next);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((room: RoomKey) => {
    setTabs((prev) => (prev.includes(room) ? prev : [...prev, room]));
    setActive(room);
    if (window.location.pathname !== room) {
      window.history.pushState({}, '', room);
    }
  }, []);

  const closeTab = useCallback((room: RoomKey) => {
    setTabs((prev) => {
      const idx = prev.indexOf(room);
      if (idx < 0) return prev;
      const next = prev.filter((value) => value !== room);
      if (next.length === 0) {
        // Always keep at least one tab open. Fall back to The Hall.
        setActive('/');
        if (window.location.pathname !== '/') {
          window.history.pushState({}, '', '/');
        }
        return ['/'];
      }
      setActive((current) => {
        if (current !== room) return current;
        const fallback = next[Math.max(0, idx - 1)] ?? next[0];
        if (window.location.pathname !== fallback) {
          window.history.pushState({}, '', fallback);
        }
        return fallback;
      });
      return next;
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ProxyViewerProvider>
        <Layout
          active={active}
          tabs={tabs}
          onActivateTab={navigate}
          onCloseTab={closeTab}
          onNavigate={navigate}
          theme={theme}
          onThemeChange={setTheme}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        >
          {tabs.map((roomKey) => (
            <div
              key={roomKey}
              className="room-pane"
              data-active={roomKey === active ? 'true' : 'false'}
              aria-hidden={roomKey === active ? undefined : true}
            >
              <RoomSwitch active={roomKey} />
            </div>
          ))}
        </Layout>
      </ProxyViewerProvider>
    </QueryClientProvider>
  );
}
