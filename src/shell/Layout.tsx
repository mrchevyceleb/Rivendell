import { useState } from 'react';
import { ChevronLeft, ChevronRight, Grid3X3, Moon, Sun, X } from 'lucide-react';
import { rooms } from '../data/mock';
import type { RoomKey } from '../data/types';
import { Evenstar, StarField } from '../theme/Ornaments';
import { RoomGlyph } from '../components/RoomGlyph';

type LayoutProps = {
  active: RoomKey;
  onNavigate: (room: RoomKey) => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
};

const primaryMobile = ['/', '/dashboard', '/council', '/pins'] as RoomKey[];

export function Layout({ active, onNavigate, theme, onThemeChange, collapsed, onCollapsedChange, children }: LayoutProps) {
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const navigate = (room: RoomKey) => {
    setMobileRoomsOpen(false);
    onNavigate(room);
  };
  const roomsTabActive = mobileRoomsOpen || !primaryMobile.includes(active);

  return (
    <div className="app-shell">
      <StarField />
      <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="brand">
          <Evenstar size={30} color="var(--r-gold)" glow />
          {!collapsed ? (
            <div>
              <strong>Rivendell</strong>
              <span>Bag End office</span>
            </div>
          ) : null}
        </div>
        <div className="wake-row">
          <span className="r-pulse-dot green" />
          {!collapsed ? (
            <>
              <span>Elrond is awake</span>
              <code>:8091</code>
            </>
          ) : null}
        </div>
        <nav className="nav-list r-scroll" aria-label="Rooms">
          {rooms.map((room) => {
            const isActive = active === room.key;
            return (
              <button
                key={room.key}
                className={isActive ? 'active' : ''}
                onClick={() => navigate(room.key)}
                title={collapsed ? room.name : undefined}
              >
                <RoomGlyph icon={room.icon} />
                {!collapsed ? (
                  <span>
                    <strong>{room.name}</strong>
                    <small>{room.role}</small>
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          {!collapsed ? (
            <button
              className="theme-toggle"
              onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{theme === 'dark' ? 'Dawn' : 'Night'}</span>
            </button>
          ) : null}
          <button className="fold-button" onClick={() => onCollapsedChange(!collapsed)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
      <main className="main-pane">{children}</main>
      <button
        type="button"
        className="mobile-theme-toggle"
        onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to dawn (light theme)' : 'Switch to night (dark theme)'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      {mobileRoomsOpen ? (
        <div className="mobile-room-sheet" role="dialog" aria-label="All rooms">
          <div className="mobile-room-sheet-head">
            <strong>Rooms</strong>
            <button type="button" onClick={() => setMobileRoomsOpen(false)} title="Close rooms" aria-label="Close rooms">
              <X size={16} />
            </button>
          </div>
          <div className="mobile-room-grid">
            {rooms.map((room) => (
              <button key={room.key} className={active === room.key ? 'active' : ''} onClick={() => navigate(room.key)}>
                <RoomGlyph icon={room.icon} size={20} />
                <span>
                  <strong>{room.name.replace('The ', '')}</strong>
                  <small>{room.role}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <nav className="mobile-tabs" aria-label="Primary rooms">
        {primaryMobile.map((key) => {
          const room = rooms.find((entry) => entry.key === key);
          if (!room) return null;
          return (
            <button key={key} className={active === key ? 'active' : ''} onClick={() => navigate(key)}>
              <RoomGlyph icon={room.icon} size={20} />
              <span>{room.name.replace('The ', '')}</span>
            </button>
          );
        })}
        <button className={roomsTabActive ? 'active' : ''} onClick={() => setMobileRoomsOpen((value) => !value)}>
          <Grid3X3 size={20} />
          <span>Rooms</span>
        </button>
      </nav>
    </div>
  );
}
