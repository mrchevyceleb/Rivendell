// Grok Bot left rail — THE TEAM, one list, no redundancy:
//
//   mark [+]   ·   Search
//   ────────────────────────────────────────────────
//   ○ Chief of Staff   Coordination, plans…  2:14 PM
//     Got it. Parking GHL for now.
//   ○ <your next agent> …
//   ────────────────────────────────────────────────
//   Plugins · You
//
// [+] creates an agent (name/role/engine/scope). Every row = a teammate and
// its ONE persistent forever-thread. Scratch threads surface via search only.

import { useMemo, useRef, useState, useEffect } from 'react';
import {
  Activity,
  PanelLeftClose,
  Pencil,
  AppWindow,
  BookOpen,
  CalendarDays,
  Coins,
  Gauge,
  Hammer,
  Heart,
  LayoutGrid,
  Mail,
  Moon,
  Pin,
  Plug,
  Plus,
  Scroll,
  Search,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import { BotMark } from './GrokLogo';
import { agentMark, agentColor, agentAvatarUrl, sameChatId, type Agent } from './agents';
import { useLive } from '../chat/hooks/useLive';
import type { HistoryItem } from './history';
import { NativeOpenHelper } from '../components/NativeOpenHelper';

export type RoomEntry = { key: string; label: string; icon: React.ReactNode };

export const ROOM_ENTRIES: RoomEntry[] = [
  { key: 'council', label: 'Council', icon: <LayoutGrid size={16} /> },
  { key: 'dashboard', label: 'Dashboard', icon: <Gauge size={16} /> },
  { key: 'tidings', label: 'Tidings', icon: <Mail size={16} /> },
  { key: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
  { key: 'hearth', label: 'Hearth', icon: <Heart size={16} /> },
  { key: 'library', label: 'Library', icon: <BookOpen size={16} /> },
  { key: 'pins', label: 'Pins', icon: <Pin size={16} /> },
  { key: 'reckoning', label: 'Reckoning', icon: <Coins size={16} /> },
  { key: 'forge', label: 'Forge', icon: <Hammer size={16} /> },
  { key: 'weavings', label: 'Weavings', icon: <Workflow size={16} /> },
  { key: 'annals', label: 'Annals', icon: <Scroll size={16} /> },
  { key: 'scribe', label: 'Scribe', icon: <Activity size={16} /> },
];

export type ActiveChat = { chatId: string; cli?: string; repo?: string };

export type BotRailProps = {
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  /** Desktop rail is collapsed to zero width (menu button stays outside). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  agents: Agent[];
  /** Drag-drop reorder commit: agent ids in their new visual sequence. */
  onReorder: (ids: string[]) => void;
  items: HistoryItem[];
  hubRepo?: string;
  activeChat?: ActiveChat;
  onOpenChat: (item: HistoryItem) => void;
  onOpenAgent: (a: Agent) => void;
  onEditAgent: (a: Agent) => void;
  onNewAgent: () => void;
  activeRoom?: string;
  onOpenRoom: (key: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenStudio: () => void;
  onHome: () => void;
};

function dayStamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function BotRail(props: BotRailProps) {
  const [query, setQuery] = useState('');
  const [pluginsOpen, setPluginsOpen] = useState(false);
  // Manual order drag-and-drop: the dragged agent id + where it would land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const pluginsRef = useRef<HTMLDivElement | null>(null);
  const live = useLive();

  useEffect(() => {
    if (!pluginsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (pluginsRef.current && !pluginsRef.current.contains(e.target as Node)) setPluginsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPluginsOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pluginsOpen]);

  // Agent home threads, looked up in the history index — identity is the
  // FACE (home chatId + repo), engine-agnostic.
  const homeById = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const a of props.agents) {
      const hit = props.items.find((i) => (!i.repo || !props.hubRepo || i.repo === props.hubRepo) && sameChatId(i.chatId, a.home));
      if (hit) map.set(a.id, hit);
    }
    return map;
  }, [props.items, props.hubRepo, props.agents]);

  const liveAgents = useMemo(() => {
    const set = new Set<string>();
    for (const s of live) {
      const a = props.agents.find((aa) => sameChatId(s.chatId, aa.home)
        && (!props.hubRepo || s.cwd === props.hubRepo));
      if (a) set.add(a.id);
    }
    return set;
  }, [live, props.agents, props.hubRepo]);

  // Pinned bubble strip (manual, user-pinned; order follows the drag order).
  const pins = useMemo(
    () => props.agents.filter((a) => a.pinned),
    [props.agents],
  );

  // Drag-to-reorder inside the bubble strip. Pins share the global `order`
  // sequence with the list, so a pin drop moves the agent to the target
  // bubble's position in the FULL order (list rows keep their relative order).
  const [pinDrag, setPinDrag] = useState<string | null>(null);
  const [pinDropBefore, setPinDropBefore] = useState<string | null>(null);
  const commitPinReorder = () => {
    if (!pinDrag || !pinDropBefore || pinDrag === pinDropBefore) {
      setPinDrag(null); setPinDropBefore(null); return;
    }
    const next = [...agentIds];
    const from = next.indexOf(pinDrag);
    const to = next.indexOf(pinDropBefore);
    if (from < 0 || to < 0) { setPinDrag(null); setPinDropBefore(null); return; }
    next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, pinDrag);
    setPinDrag(null);
    setPinDropBefore(null);
    props.onReorder(next);
  };

  // ONE list: agents in their FIXED manual order. Scratch threads join only in search.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    type Row =
      | { kind: 'agent'; a: Agent; item?: HistoryItem; ts: number }
      | { kind: 'adhoc'; item: HistoryItem; ts: number };
    // FIXED manual order (drag-and-drop persisted). Only search results are
    // recency-sorted; the agents themselves never move on their own. Pinned
    // agents live in the bubble strip, so the list holds the rest.
    const out: Row[] = props.agents.filter((a) => !a.pinned).map((a) => ({ kind: 'agent', a, item: homeById.get(a.id), ts: homeById.get(a.id)?.updatedAt ?? a.createdAt }));
    if (q) {
      const adhoc: Row[] = [];
      for (const it of props.items) {
        if (props.agents.some((a) => (!it.repo || !props.hubRepo || it.repo === props.hubRepo) && sameChatId(it.chatId, a.home))) continue;
        adhoc.push({ kind: 'adhoc', item: it, ts: it.updatedAt });
      }
      adhoc.sort((a, b) => b.ts - a.ts);
      const all = [...props.agents.map((a) => ({ kind: 'agent' as const, a, item: homeById.get(a.id), ts: homeById.get(a.id)?.updatedAt ?? a.createdAt })), ...adhoc];
      return all.filter((r) => {
        const hay = r.kind === 'agent'
          ? `${r.a.name} ${r.a.role} ${r.item?.title ?? ''} ${r.item?.preview ?? ''}`
          : `${r.item!.title} ${r.item!.preview ?? ''}`;
        return hay.toLowerCase().includes(q);
      });
    }
    return out;
  }, [props.agents, props.items, homeById, query, props.hubRepo]);

  const agentIds = props.agents.map((a) => a.id);
  const commitReorder = () => {
    if (!dragId || dropBefore === null) { setDragId(null); setDropBefore(null); return; }
    const from = agentIds.indexOf(dragId);
    let to = dropBefore === '__end__' ? agentIds.length : agentIds.indexOf(dropBefore);
    if (from < 0 || to < 0 || from === to) { setDragId(null); setDropBefore(null); return; }
    const next = [...agentIds];
    next.splice(from, 1);
    if (from < to) to -= 1; // removal shifted the target up one slot
    next.splice(to, 0, dragId);
    setDragId(null);
    setDropBefore(null);
    props.onReorder(next);
  };

  return (
    <aside className={`bt-rail${props.drawerOpen ? ' drawer-open' : ''}`}>
      <div className="bt-rail-head">
        <button className="bt-mark-btn" onClick={props.onHome} title="Rivendell home" aria-label="Rivendell home">
          <BotMark size={26} />
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          {props.onToggleCollapse ? (
            <button className="bt-iconbtn bt-rail-collapse" onClick={props.onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar">
              <PanelLeftClose size={17} />
            </button>
          ) : null}
          {props.drawerOpen ? (
            <button className="bt-iconbtn" onClick={props.onCloseDrawer} title="Close sidebar" aria-label="Close sidebar">
              <X size={17} />
            </button>
          ) : null}
          <button className="bt-iconbtn" onClick={props.onNewAgent} title="New agent" aria-label="New agent">
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="bt-search">
        <div className="bt-search-box">
          <Search size={14} />
          <input
            value={query}
            placeholder="Search"
            aria-label="Search agents and chats"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
          />
        </div>
      </div>

      <div className="bt-rail-scroll">
        {pins.length && !query.trim() ? (
          <div className="bt-pins" role="group" aria-label="Pinned agents">
            {pins.map((a) => {
              const isActive = props.activeChat && sameChatId(props.activeChat.chatId, a.home);
              const url = agentAvatarUrl(a);
              return (
                <button
                  key={`pin:${a.id}`}
                  className={`bt-pin${isActive ? ' on' : ''}${pinDrag === a.id ? ' dragging' : ''}${pinDropBefore === a.id && pinDrag && pinDrag !== a.id ? ' drop-left' : ''}`}
                  onClick={() => props.onOpenAgent(a)}
                  onContextMenu={(e) => { e.preventDefault(); props.onEditAgent(a); }}
                  title={`${a.name} — ${a.role} (drag to reorder)`}
                  draggable
                  onDragStart={(e) => { setPinDrag(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); }}
                  onDragOver={(e) => {
                    if (!pinDrag || pinDrag === a.id) return;
                    e.preventDefault();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setPinDropBefore(e.clientX < rect.left + rect.width / 2 ? a.id : null);
                  }}
                  onDrop={(e) => { e.preventDefault(); commitPinReorder(); }}
                  onDragEnd={() => { setPinDrag(null); setPinDropBefore(null); }}
                >
                  <span className={`bt-pin-disc${liveAgents.has(a.id) ? ' has-presence' : ''}`} style={url ? undefined : { background: agentColor(a.name) }}>
                    {url ? <img src={url} alt={a.name} /> : agentMark(a)}
                    {a.unread ? <span className="bt-pin-unread">{a.unread > 9 ? '9+' : a.unread}</span> : null}
                  </span>
                  <span className="bt-pin-name">{a.name}</span>
                  <span className="bt-pin-role">{a.role}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {rows.map((r) => {
          if (r.kind === 'agent') {
            const a = r.a;
            const isActive = props.activeChat && sameChatId(props.activeChat.chatId, a.home);
            return (
              <button
                key={`agent:${a.id}`}
                className={`bt-conv${isActive ? ' on' : ''}${dragId === a.id ? ' dragging' : ''}${dropBefore === a.id && dragId && dragId !== a.id ? ' drop-above' : ''}`}
                onClick={() => props.onOpenAgent(a)}
                onContextMenu={(e) => { e.preventDefault(); props.onEditAgent(a); }}
                title={`${a.name} — ${a.role} (right-click to edit)`}
                draggable
                onDragStart={(e) => { setDragId(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); }}
                onDragOver={(e) => {
                  if (!dragId || dragId === a.id) return;
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropBefore(e.clientY < rect.top + rect.height / 2 ? a.id : null);
                }}
                onDrop={(e) => { e.preventDefault(); commitReorder(); }}
                onDragEnd={() => { setDragId(null); setDropBefore(null); }}
              >
                <span className="bt-disc bt-has-presence" style={{ color: '#FCFCFC', background: agentColor(a.name) }}>
                  {agentAvatarUrl(a) ? <img className="bt-disc-img" src={agentAvatarUrl(a) ?? undefined} alt={a.name} /> : agentMark(a)}
                  {liveAgents.has(a.id) ? <span className="bt-presence" aria-label="online now" /> : null}
                </span>
                <span className="bt-conv-main">
                  <span className="bt-conv-top">
                    <span className="bt-conv-title">
                      {a.name} <span className="bt-role-chip">{a.role}</span>
                    </span>
                    {a.unread ? <span className="bt-unread" title={`${a.unread} waiting`}>{a.unread > 9 ? '9+' : a.unread}</span> : null}
                    {r.item ? <span className="bt-conv-day">{dayStamp(r.item.updatedAt)}</span> : null}
                    <span
                      className="bt-row-edit"
                      role="button"
                      tabIndex={-1}
                      aria-label={`Edit ${a.name}`}
                      title={`Edit ${a.name}`}
                      onClick={(e) => { e.stopPropagation(); props.onEditAgent(a); }}
                    >
                      <Pencil size={12} />
                    </span>
                  </span>
                  <span className="bt-conv-sub">{r.item?.preview ?? 'No work yet — give them something real.'}</span>
                </span>
              </button>
            );
          }
          const it = r.item!;
          const isActive = props.activeChat
            && sameChatId(it.chatId, props.activeChat.chatId)
            && (!props.activeChat.cli || it.cli === props.activeChat.cli)
            && (!props.activeChat.repo || it.repo === props.activeChat.repo);
          return (
            <button
              key={`${it.cli}:${it.repo}:${it.chatId}`}
              className={`bt-conv${isActive ? ' on' : ''}`}
              onClick={() => props.onOpenChat(it)}
              title={it.title}
            >
              <span className="bt-disc">{it.cli.slice(0, 1).toUpperCase()}</span>
              <span className="bt-conv-main">
                <span className="bt-conv-top">
                  <span className="bt-conv-title">{it.title}</span>
                  <span className="bt-conv-day">{dayStamp(it.updatedAt)}</span>
                </span>
                <span className="bt-conv-sub">{it.preview ?? it.cli}</span>
              </span>
            </button>
          );
        })}
        {!rows.length ? (
          <div className="bt-pane-empty">
            {query ? 'No matches.' : pins.length ? 'Everyone is pinned up top — drag them back anytime.' : 'No agents yet — create one with +.'}
          </div>
        ) : null}
        {dragId && props.agents.length ? (
          <div
            className={`bt-dropzone${dropBefore === '__end__' ? ' on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDropBefore('__end__'); }}
            onDrop={(e) => { e.preventDefault(); commitReorder(); }}
          />
        ) : null}
      </div>

      <div className="bt-rail-foot" style={{ position: 'relative' }} ref={pluginsRef}>
        {pluginsOpen ? (
          <div className="bt-plugins-pop" role="menu">
            <div className="bt-plug-h">Rooms</div>
            {ROOM_ENTRIES.map((r) => (
              <button key={r.key} className="bt-plug-row" onClick={() => { props.onOpenRoom(r.key); setPluginsOpen(false); }}>
                {r.icon} {r.label}
              </button>
            ))}
            <div className="bt-plug-h">System</div>
            <button className="bt-plug-row" onClick={() => { props.onOpenStudio(); setPluginsOpen(false); }}>
              <AppWindow size={16} /> Studio IDE
            </button>
            <button className="bt-plug-row" onClick={() => { props.onToggleTheme(); setPluginsOpen(false); }}>
              {props.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {props.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <NativeOpenHelper />
          </div>
        ) : null}
        <button className="bt-foot-row" onClick={() => setPluginsOpen((o) => !o)} aria-haspopup="menu" aria-expanded={pluginsOpen}>
          <Plug size={17} /> Plugins
        </button>
        <button className="bt-foot-row" title="Rivendell operator">
          <span className="bt-disc">Y</span> You
        </button>
      </div>
    </aside>
  );
}
