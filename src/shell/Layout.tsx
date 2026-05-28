import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Grid3X3, Moon, Plus, Sun, X } from 'lucide-react';
import { rooms } from '../data/mock';
import type { Room, RoomKey } from '../data/types';
import { Evenstar, StarField } from '../theme/Ornaments';
import { RoomGlyph } from '../components/RoomGlyph';
import { NativeOpenHelper } from '../components/NativeOpenHelper';

type LayoutProps = {
  active: RoomKey;
  tabs: RoomKey[];
  onActivateTab: (room: RoomKey) => void;
  onCloseTab: (room: RoomKey) => void;
  onNavigate: (room: RoomKey) => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
};

const primaryMobile = ['/', '/dashboard', '/calendar', '/council'] as RoomKey[];
const roomByKey: Record<RoomKey, Room> = rooms.reduce((map, room) => {
  map[room.key] = room;
  return map;
}, {} as Record<RoomKey, Room>);

function shortRoomName(name: string): string {
  return name.replace(/^The\s+/, '');
}

export function Layout({ active, tabs, onActivateTab, onCloseTab, onNavigate, theme, onThemeChange, collapsed, onCollapsedChange, children }: LayoutProps) {
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  const tabPickerRef = useRef<HTMLDivElement | null>(null);
  const navigate = (room: RoomKey) => {
    setMobileRoomsOpen(false);
    onNavigate(room);
  };
  const roomsTabActive = mobileRoomsOpen || !primaryMobile.includes(active);
  const unopenedRooms = rooms.filter((room) => !tabs.includes(room.key));

  useEffect(() => {
    if (!tabPickerOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!tabPickerRef.current) return;
      if (tabPickerRef.current.contains(event.target as Node)) return;
      setTabPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTabPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [tabPickerOpen]);

  const pickRoom = (room: RoomKey) => {
    setTabPickerOpen(false);
    onActivateTab(room);
  };

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
          {!collapsed ? <NativeOpenHelper /> : null}
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
      <main className="main-pane">
        <nav className="room-tab-strip" role="tablist" aria-label="Open rooms">
          {tabs.map((roomKey) => {
            const room = roomByKey[roomKey];
            if (!room) return null;
            const isActive = roomKey === active;
            return (
              <div key={roomKey} className={`room-tab ${isActive ? 'active' : ''}`}>
                <button
                  className="room-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onActivateTab(roomKey)}
                  title={`${room.name} — ${room.role}`}
                >
                  <RoomGlyph icon={room.icon} size={14} />
                  <span>{shortRoomName(room.name)}</span>
                </button>
                {tabs.length > 1 ? (
                  <button
                    className="room-tab-close"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(roomKey);
                    }}
                    title={`Close ${shortRoomName(room.name)}`}
                    aria-label={`Close ${shortRoomName(room.name)}`}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <div className="room-tab-add-wrap" ref={tabPickerRef}>
            <button
              className="room-tab-add"
              type="button"
              onClick={() => setTabPickerOpen((value) => !value)}
              disabled={unopenedRooms.length === 0}
              aria-haspopup="menu"
              aria-expanded={tabPickerOpen}
              title={unopenedRooms.length === 0 ? 'Every room is already open' : 'Open another room in a tab'}
              aria-label="Open another room in a tab"
            >
              <Plus size={13} />
              <span>New tab</span>
            </button>
            {tabPickerOpen && unopenedRooms.length > 0 ? (
              <div className="room-tab-picker" role="menu" aria-label="Open a room in a new tab">
                <div className="room-tab-picker-head">Open in a new tab</div>
                {unopenedRooms.map((room) => (
                  <button
                    key={room.key}
                    className="room-tab-picker-item"
                    type="button"
                    role="menuitem"
                    onClick={() => pickRoom(room.key)}
                  >
                    <RoomGlyph icon={room.icon} size={16} />
                    <span>
                      <strong>{shortRoomName(room.name)}</strong>
                      <small>{room.role}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </nav>
        <div className="room-stack">{children}</div>
      </main>
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
