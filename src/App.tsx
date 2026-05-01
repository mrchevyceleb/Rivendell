import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Annals } from './rooms/Annals';
import { Council } from './rooms/Council';
import { Dashboard } from './rooms/Dashboard';
import { Forge } from './rooms/Forge';
import { Hall } from './rooms/Hall';
import { Hearth } from './rooms/Hearth';
import { Library } from './rooms/Library';
import { Pins } from './rooms/Pins';
import { Reckoning } from './rooms/Reckoning';
import { Scribe } from './rooms/Scribe';
import { Tidings } from './rooms/Tidings';
import { Weavings } from './rooms/Weavings';
import { Layout } from './shell/Layout';
import { rooms } from './data/mock';
import type { RoomKey } from './data/types';

const queryClient = new QueryClient();
const roomKeys = new Set(rooms.map((room) => room.key));

function readPath(): RoomKey {
  const path = window.location.pathname as RoomKey;
  return roomKeys.has(path) ? path : '/';
}

function RoomSwitch({ active }: { active: RoomKey }) {
  switch (active) {
    case '/council':
      return <Council />;
    case '/dashboard':
      return <Dashboard />;
    case '/tidings':
      return <Tidings />;
    case '/hearth':
      return <Hearth />;
    case '/library':
      return <Library />;
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
  const [active, setActive] = useState<RoomKey>(() => readPath());
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
    const onPop = () => setActive(readPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useMemo(
    () => (room: RoomKey) => {
      setActive(room);
      window.history.pushState({}, '', room);
    },
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Layout
        active={active}
        onNavigate={navigate}
        theme={theme}
        onThemeChange={setTheme}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      >
        <RoomSwitch active={active} />
      </Layout>
    </QueryClientProvider>
  );
}
