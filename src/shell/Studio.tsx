import {
  FileText,
  Hammer,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Forge } from '../rooms/Forge';
import { useRepos } from '../chat/hooks/useRepos';
import { useWorkspaceTree } from '../hooks/useRoomData';
import { Evenstar, StarField } from '../theme/Ornaments';
import { FileTree } from './studio/FileTree';
import { FileTab } from './studio/FileTab';
import { ChatTab, type ChatTabApi } from './studio/ChatTab';
import { STUDIO_ACTIVE_KEY, STUDIO_TABS_KEY, STUDIO_TREE_KEY, type StudioTab } from './studio/types';
import './studio/studio.css';

// ─── Boot / persistence ──────────────────────────────────────────────────────

function readTabs(): { tabs: StudioTab[]; active: string } {
  const fallback = (): { tabs: StudioTab[]; active: string } => {
    const tab: StudioTab = { id: 'chat:studio-main', kind: 'chat', chatId: 'studio-main', title: 'Elrond' };
    return { tabs: [tab], active: tab.id };
  };
  try {
    const raw = localStorage.getItem(STUDIO_TABS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) {
      const tabs = parsed.filter((t): t is StudioTab => t && typeof t.id === 'string' && typeof t.kind === 'string');
      if (tabs.length) {
        const storedActive = localStorage.getItem(STUDIO_ACTIVE_KEY);
        const active = tabs.some((t) => t.id === storedActive) ? storedActive! : tabs[0].id;
        return { tabs, active };
      }
    }
  } catch { /* fall through */ }
  return fallback();
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

let chatSeq = 0;

export function Studio() {
  const boot = useMemo(readTabs, []);
  const [tabs, setTabs] = useState<StudioTab[]>(boot.tabs);
  const [active, setActive] = useState<string>(boot.active);
  const [treeCollapsed, setTreeCollapsed] = useState(() => {
    const stored = localStorage.getItem(STUDIO_TREE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    // No saved preference: collapse by default on phones so the tree doesn't
    // cover the content on first load.
    return typeof window !== 'undefined' && window.innerWidth <= 760;
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('rivendell:theme') === 'light' ? 'light' : 'dark'));
  const [zoom, setZoom] = useState<number>(() => {
    const v = Number(localStorage.getItem('rivendell:zoom'));
    return v >= 0.7 && v <= 2 ? v : 1;
  });
  const [dirtyById, setDirtyById] = useState<Record<string, boolean>>({});
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('rivendell:studio-tree-w'));
    return v >= 180 && v <= 640 ? v : 300;
  });
  const stepZoom = (d: number) => setZoom((z) => Math.min(2, Math.max(0.7, Math.round((z + d) * 100) / 100)));

  // Drag the divider between the file tree and the content to resize.
  const startTreeResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const z = zoom || 1;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(640, Math.max(180, startW + (ev.clientX - startX) / z));
      setTreeWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const { repos } = useRepos();
  const assistantHubRepo = repos.find((r) => r.isAssistantHub) ?? repos[0];
  const { data: treeData } = useWorkspaceTree();

  // Registry of live chat send() fns, keyed by chatId, plus pending "Ask Elrond" sends.
  const chatApis = useRef<Map<string, ChatTabApi>>(new Map());
  const pendingAsk = useRef<Map<string, string>>(new Map());

  // ── persistence ──
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('rivendell:theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('rivendell:zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('rivendell:studio-tree-w', String(Math.round(treeWidth))); }, [treeWidth]);
  useEffect(() => { localStorage.setItem(STUDIO_TABS_KEY, JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => { localStorage.setItem(STUDIO_ACTIVE_KEY, active); }, [active]);
  useEffect(() => { localStorage.setItem(STUDIO_TREE_KEY, String(treeCollapsed)); }, [treeCollapsed]);

  // ── deep link: ?path=foo opens that file ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get('path')?.replace(/^\//, '');
    if (path) {
      openFileTab(path, fileName(path));
      params.delete('path');
      const search = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── tab ops ──
  const activate = useCallback((id: string) => setActive(id), []);

  const openFileTab = useCallback((path: string, name: string) => {
    const id = `file:${path}`;
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'file', path, title: name }]));
    setActive(id);
    // On phones the tree overlays the content — close it so the file is visible.
    if (typeof window !== 'undefined' && window.innerWidth <= 760) setTreeCollapsed(true);
  }, []);

  const openChatTab = useCallback(() => {
    const chatId = `studio-${Date.now()}-${chatSeq++}`;
    const id = `chat:${chatId}`;
    setTabs((prev) => [...prev, { id, kind: 'chat', chatId, title: 'Elrond' }]);
    setActive(id);
    return chatId;
  }, []);

  const openForgeTab = useCallback(() => {
    const id = 'forge';
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'forge', title: 'Forge' }]));
    setActive(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const tab: StudioTab = { id: 'chat:studio-main', kind: 'chat', chatId: 'studio-main', title: 'Elrond' };
        setActive(tab.id);
        return [tab];
      }
      setActive((cur) => (cur !== id ? cur : (next[Math.max(0, idx - 1)] ?? next[0]).id));
      return next;
    });
  }, []);

  const registerChatApi = useCallback((chatId: string, api: ChatTabApi | null) => {
    if (api) {
      chatApis.current.set(chatId, api);
      const pending = pendingAsk.current.get(chatId);
      if (pending) { pendingAsk.current.delete(chatId); api.send(pending); }
    } else {
      chatApis.current.delete(chatId);
    }
  }, []);

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyById((prev) => (prev[id] === dirty ? prev : { ...prev, [id]: dirty }));
  }, []);

  // ── Ask Elrond about a file: route to an existing chat tab, or open one ──
  const askElrond = useCallback((path: string) => {
    const message = `Please open and review \`ASSISTANT-HUB/${path}\`.`;
    setTabs((prev) => {
      const activeTab = prev.find((t) => t.id === active);
      const target = (activeTab?.kind === 'chat' ? activeTab : prev.find((t) => t.kind === 'chat')) ?? null;
      if (target?.chatId) {
        setActive(target.id);
        const api = chatApis.current.get(target.chatId);
        if (api) api.send(message);
        else pendingAsk.current.set(target.chatId, message);
        return prev;
      }
      // no chat tab open — create one and queue the message
      const chatId = `studio-${Date.now()}-${chatSeq++}`;
      const id = `chat:${chatId}`;
      pendingAsk.current.set(chatId, message);
      setActive(id);
      return [...prev, { id, kind: 'chat', chatId, title: 'Elrond' }];
    });
  }, [active]);

  const dirtyPaths = useMemo(() => {
    const set = new Set<string>();
    for (const t of tabs) if (t.kind === 'file' && t.path && dirtyById[t.id]) set.add(t.path);
    return set;
  }, [tabs, dirtyById]);

  const activeTab = tabs.find((t) => t.id === active);
  const activeFileDirty = activeTab?.kind === 'file' ? Boolean(dirtyById[activeTab.id]) : false;

  const tabIcon = (kind: StudioTab['kind']) =>
    kind === 'file' ? <FileText size={13} /> : kind === 'forge' ? <Hammer size={13} /> : <MessageSquare size={13} />;

  const rootStyle: React.CSSProperties | undefined =
    zoom !== 1 ? { zoom, width: `calc(100vw / ${zoom})`, height: `calc(100dvh / ${zoom})` } : undefined;

  return (
    <div className="studio" data-theme={theme} style={rootStyle}>
      <StarField />

      {/* ── Top bar ── */}
      <header className="studio-topbar">
        <div className="studio-brand">
          <Evenstar size={22} color="var(--r-gold)" glow />
          <strong>Rivendell</strong>
        </div>

        <button
          className="studio-tree-toggle"
          onClick={() => setTreeCollapsed((c) => !c)}
          title={treeCollapsed ? 'Show files' : 'Hide files'}
        >
          {treeCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <nav className="studio-tabs r-scroll" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            const dirty = tab.kind === 'file' && dirtyById[tab.id];
            return (
              <div key={tab.id} className={`studio-tab ${isActive ? 'active' : ''}`} role="tab" aria-selected={isActive}>
                <button className="studio-tab-main" onClick={() => activate(tab.id)} title={tab.path ?? tab.title}>
                  {tabIcon(tab.kind)}
                  <span className="tab-title">{tab.title}</span>
                  {dirty ? <span className="tab-dirty">●</span> : null}
                </button>
                <button className="studio-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} title="Close" aria-label={`Close ${tab.title}`}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </nav>

        <div className="studio-topbar-actions">
          <button onClick={openChatTab} title="New chat with Elrond"><MessageSquarePlus size={16} /></button>
          <button onClick={openForgeTab} title="Open Forge (cron & deploy)"><Hammer size={16} /></button>
          <span className="studio-zoom">
            <button onClick={() => stepZoom(-0.1)} title="Smaller"><ZoomOut size={16} /></button>
            <button className="studio-zoom-pct" onClick={() => setZoom(1)} title="Reset size">{Math.round(zoom * 100)}%</button>
            <button onClick={() => stepZoom(0.1)} title="Bigger"><ZoomIn size={16} /></button>
          </span>
          <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Toggle theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* ── Body: tree | divider | content ── */}
      <div
        className={`studio-body ${treeCollapsed ? 'tree-collapsed' : ''}`}
        style={{ ['--studio-tree-w' as string]: `${Math.round(treeWidth)}px` } as React.CSSProperties}
      >
        <aside className="studio-tree">
          {!treeCollapsed && (
            <FileTree
              selectedPath={activeTab?.kind === 'file' ? activeTab.path : undefined}
              dirtyPaths={dirtyPaths}
              onOpenFile={openFileTab}
              onAskElrond={askElrond}
            />
          )}
        </aside>

        {!treeCollapsed && (
          <div className="studio-divider" onMouseDown={startTreeResize} title="Drag to resize" />
        )}

        <main className="studio-content">
          {tabs.map((tab) => (
            <div key={tab.id} className="studio-pane" hidden={tab.id !== active}>
              {tab.kind === 'file' && tab.path ? (
                <FileTab id={tab.id} path={tab.path} onDirtyChange={onDirtyChange} onAskElrond={askElrond} />
              ) : tab.kind === 'chat' && tab.chatId ? (
                <ChatTab chatId={tab.chatId} repo={assistantHubRepo} registerApi={registerChatApi} />
              ) : tab.kind === 'forge' ? (
                <Forge />
              ) : null}
            </div>
          ))}
        </main>
      </div>

      {/* ── Status bar ── */}
      <footer className="studio-statusbar">
        <span className="studio-status-left">
          <span className="r-pulse-dot green" />
          Elrond awake
          <span className="studio-status-sep">·</span>
          {treeData?.displayPath ?? '~/ASSISTANT-HUB'}
        </span>
        <span className="studio-status-right">
          {treeData ? <>{treeData.fileCount ?? 0} files · {treeData.dirCount ?? 0} folders</> : null}
          {activeTab?.kind === 'file' ? (
            <>
              <span className="studio-status-sep">·</span>
              {activeFileDirty ? <span className="studio-status-dirty">unsaved</span> : 'saved'}
            </>
          ) : null}
        </span>
      </footer>
    </div>
  );
}
