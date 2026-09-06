import {
  ChevronRight,
  ClipboardCopy,
  Eye,
  EyeOff,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Link2,
  MessageSquare,
  RefreshCcw,
  Search,
  Trash2,
  Type,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  apiJson,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
  saveWorkspaceFile,
} from '../../data/api';
import type { FileTreeNode, WorkspaceChildrenResponse } from '../../data/types';
import { useWorkspaceTree } from '../../hooks/useRoomData';
import { useScribeSocket } from '../../hooks/useScribeSocket';
import {
  HUB_HOME,
  HUB_LEGACY,
  HUB_SPACES,
  STUDIO_SHOW_LEGACY_KEY,
  inboxNotePath,
  todayStamp,
} from './hubSpaces';

// ─── Tree utils ──────────────────────────────────────────────────────────────

function filterTree(node: FileTreeNode, query: string): FileTreeNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  const matches = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
  const children = node.children?.map((child) => filterTree(child, q)).filter(Boolean) as FileTreeNode[] | undefined;
  if (matches || children?.length) return { ...node, children };
  return null;
}

function attachChildren(root: FileTreeNode, path: string, children: FileTreeNode[]): FileTreeNode {
  if (root.path === path) return { ...root, children, deferred: false };
  if (!root.children?.length) return root;
  return { ...root, children: root.children.map((child) => attachChildren(child, path, children)) };
}

function fileIcon(name: string) {
  return /\.(md|mdx|txt|json|yaml|yml|toml|env|sql)$/i.test(name) ? FileText : File;
}

const SPACE_ORDER = ['home.md', ...HUB_SPACES.map((s) => s.path), 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'README.md'];

function sortHubChildren(children: FileTreeNode[] | undefined): FileTreeNode[] | undefined {
  if (!children?.length) return children;
  const rank = (n: FileTreeNode) => {
    const idx = SPACE_ORDER.findIndex((p) => p.toLowerCase() === n.name.toLowerCase() || p === n.path);
    if (idx >= 0) return idx;
    if (n.name === 'legacy' || n.path === 'legacy') return 900;
    if (n.name.startsWith('.')) return 800;
    return 500 + n.name.toLowerCase().charCodeAt(0);
  };
  return [...children].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Context menu ──────────────────────────────────────────────────────────────

type ContextMenuState = { x: number; y: number; node: FileTreeNode };

function ContextMenu({
  menu,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onAskElrond,
  onClose,
}: {
  menu: ContextMenuState;
  onRename: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onAskElrond: (path: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const parentPath = menu.node.type === 'directory' ? menu.node.path : menu.node.path.split('/').slice(0, -1).join('/');

  return (
    <div ref={ref} className="studio-ctx" style={{ left: menu.x, top: menu.y }}>
      {menu.node.type === 'file' && (
        <button className="ctx-item" onClick={() => { onAskElrond(menu.node.path); onClose(); }}>
          <MessageSquare size={13} /> Ask TARDIS
        </button>
      )}
      {menu.node.type === 'directory' && (
        <>
          <button className="ctx-item" onClick={() => { onNewFile(parentPath); onClose(); }}>
            <FilePlus size={13} /> New file here
          </button>
          <button className="ctx-item" onClick={() => { onNewFolder(parentPath); onClose(); }}>
            <FolderPlus size={13} /> New folder here
          </button>
        </>
      )}
      <button
        className="ctx-item"
        onClick={() => { void navigator.clipboard?.writeText(menu.node.path); onClose(); }}
      >
        <ClipboardCopy size={13} /> Copy path
      </button>
      <button
        className="ctx-item"
        onClick={() => { void navigator.clipboard?.writeText(`ASSISTANT-HUB/${menu.node.path}`); onClose(); }}
      >
        <Link2 size={13} /> Copy as workspace link
      </button>
      <button className="ctx-item" onClick={() => { onRename(menu.node); onClose(); }}>
        <Type size={13} /> Rename
      </button>
      <button className="ctx-item ctx-item-danger" onClick={() => { onDelete(menu.node); onClose(); }}>
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

// ─── Tree node ──────────────────────────────────────────────────────────────

const MOVE_MIME = 'application/x-rivendell-move';

function parentDir(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function isSelfOrDescendant(sourcePath: string, targetDir: string): boolean {
  if (!sourcePath) return true;
  if (targetDir === sourcePath) return true;
  if (!targetDir) return false;
  return targetDir === sourcePath || targetDir.startsWith(`${sourcePath}/`);
}

function TreeNode({
  node,
  depth,
  expanded,
  query,
  selectedPath,
  loadingPath,
  renamingPath,
  dirtyPaths,
  dropTargetPath,
  draggingPath,
  onToggle,
  onOpenFile,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDragPath,
  onHoverDir,
  onDropOn,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  query: string;
  selectedPath?: string;
  loadingPath: string | null;
  renamingPath: string | null;
  dirtyPaths?: Set<string>;
  dropTargetPath: string | null;
  draggingPath: string | null;
  onToggle: (node: FileTreeNode) => Promise<void>;
  onOpenFile: (node: FileTreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void;
  onRenameSubmit: (node: FileTreeNode, newName: string) => void;
  onRenameCancel: () => void;
  onDragPath: (path: string | null) => void;
  onHoverDir: (dir: string | null) => void;
  onDropOn: (targetDir: string, sourcePath: string) => void;
}) {
  const isDirectory = node.type === 'directory';
  const isOpen = query.trim() ? true : expanded.has(node.path);
  const isLoading = loadingPath === node.path;
  const isRenaming = renamingPath === node.path;
  const isDirty = !isDirectory && dirtyPaths?.has(node.path);
  const isDropTarget = dropTargetPath === node.path && isDirectory;
  const isDragging = draggingPath === node.path;
  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : fileIcon(node.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) renameRef.current?.select();
  }, [isRenaming]);

  const resolveDropDir = (): string => {
    // Dropping on a folder moves into it; dropping on a file moves beside it (same parent).
    if (node.type === 'directory') return node.path;
    return parentDir(node.path);
  };

  return (
    <div className={`tree-node ${isDropTarget ? 'is-drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}>
      {isRenaming ? (
        <input
          ref={renameRef}
          className="tree-rename-input"
          style={{ paddingLeft: 10 + depth * 16 }}
          defaultValue={node.name}
          autoFocus
          onBlur={() => onRenameCancel()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) onRenameSubmit(node, v); else onRenameCancel(); }
            if (e.key === 'Escape') onRenameCancel();
          }}
        />
      ) : (
        <button
          data-tree-path={node.path}
          draggable={node.path !== ''}
          onDragStart={(e) => {
            if (!node.path) {
              e.preventDefault();
              return;
            }
            // Chat composer uses path mime; tree moves use MOVE_MIME.
            e.dataTransfer.setData('text/plain', node.path);
            e.dataTransfer.setData('application/x-rivendell-path', node.path);
            e.dataTransfer.setData(MOVE_MIME, JSON.stringify({ path: node.path, type: node.type, name: node.name }));
            e.dataTransfer.effectAllowed = 'copyMove';
            onDragPath(node.path);
          }}
          onDragEnd={() => onDragPath(null)}
          onDragOver={(e) => {
            // Prefer live draggingPath state; MIME types are flaky mid-drag in some browsers.
            const types = Array.from(e.dataTransfer.types || []);
            const looksLikeTreeDrag = Boolean(draggingPath) || types.includes(MOVE_MIME) || types.includes('text/plain');
            if (!looksLikeTreeDrag) return;
            const dir = resolveDropDir();
            const source = draggingPath || '';
            if (source && isSelfOrDescendant(source, dir)) {
              e.dataTransfer.dropEffect = 'none';
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            onHoverDir(dir);
          }}
          onDragLeave={(e) => {
            // only clear if leaving this node entirely
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as HTMLElement).contains(related)) return;
            onHoverDir(null);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            let sourcePath = '';
            const packed = e.dataTransfer.getData(MOVE_MIME);
            if (packed) {
              try {
                sourcePath = JSON.parse(packed).path || '';
              } catch {
                sourcePath = '';
              }
            }
            if (!sourcePath) sourcePath = e.dataTransfer.getData('application/x-rivendell-path') || e.dataTransfer.getData('text/plain');
            if (!sourcePath) return;
            const dir = resolveDropDir();
            onDropOn(dir, sourcePath);
            onDragPath(null);
          }}
          className={`${selectedPath === node.path ? 'selected' : ''} ${isDirectory ? 'directory' : 'file'} ${isLoading ? 'loading' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => void (isDirectory ? onToggle(node) : onOpenFile(node))}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node); }}
        >
          {isDirectory ? <ChevronRight className={isOpen ? 'open' : ''} size={14} /> : <span className="tree-spacer" />}
          <Icon size={15} />
          <span>{node.name}</span>
          {isDirty && <span className="tree-dirty-dot">●</span>}
          {isDirectory ? <code>{isLoading ? '...' : node.error ? '!' : node.children ? node.children.length : node.deferred ? 'load' : ''}</code> : null}
        </button>
      )}
      {isDirectory && isOpen && node.children?.length ? (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              query={query}
              selectedPath={selectedPath}
              loadingPath={loadingPath}
              renamingPath={renamingPath}
              dirtyPaths={dirtyPaths}
              dropTargetPath={dropTargetPath}
              draggingPath={draggingPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragPath={onDragPath}
              onHoverDir={onHoverDir}
              onDropOn={onDropOn}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── FileTree ──────────────────────────────────────────────────────────────

export function FileTree({
  selectedPath,
  dirtyPaths,
  onOpenFile,
  onAskElrond,
  onPathsMoved,
  revealPath,
  revealNonce,
}: {
  selectedPath?: string;
  dirtyPaths?: Set<string>;
  onOpenFile: (path: string, name: string) => void;
  onAskElrond: (path: string) => void;
  /** Called after a successful tree move so open tabs can retarget paths. */
  onPathsMoved?: (from: string, to: string) => void;
  revealPath?: string;
  revealNonce?: number;
}) {
  const [showLegacy, setShowLegacy] = useState(() => localStorage.getItem(STUDIO_SHOW_LEGACY_KEY) === 'true');
  const { data, refetch, isFetching } = useWorkspaceTree({ hideLegacy: !showLegacy });
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newEntryParent, setNewEntryParent] = useState<{ parent: string; kind: 'file' | 'directory' } | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const movingRef = useRef(false);
  const newEntryRef = useRef<HTMLInputElement>(null);
  const [ticker] = useState(() => {
    const lines = [
      'Inbox zero is a myth. Inbox tidy is the goal.',
      'Root is locked. Agents write in spaces.',
      'Promote on touch. Legacy sleeps until needed.',
      'Council holds the kanban. Files hold the pages.',
    ];
    return lines[Math.floor(Math.random() * lines.length)]!;
  });

  const treeRef = useRef<FileTreeNode | null>(null);
  treeRef.current = tree;

  useEffect(() => {
    localStorage.setItem(STUDIO_SHOW_LEGACY_KEY, String(showLegacy));
  }, [showLegacy]);

  useEffect(() => {
    if (data?.tree) {
      const root = data.tree;
      const sorted = root.children ? { ...root, children: sortHubChildren(root.children) } : root;
      setTree(sorted);
    }
  }, [data?.tree]);

  const filteredTree = useMemo(() => (tree ? filterTree(tree, query) : null), [tree, query]);

  const loadChildren = useCallback(async (node: FileTreeNode): Promise<FileTreeNode[]> => {
    if (node.type !== 'directory') return [];
    if (node.children) return node.children;
    setLoadingPath(node.path);
    try {
      const legacyQs = showLegacy ? '&hideLegacy=false' : '';
      const result = await apiJson<WorkspaceChildrenResponse>(
        `/api/docs/children?path=${encodeURIComponent(node.path)}${legacyQs}`,
      );
      const kids = node.path === '' ? sortHubChildren(result.children) ?? result.children : result.children;
      setTree((prev) => (prev ? attachChildren(prev, node.path, kids) : prev));
      return kids;
    } finally {
      setLoadingPath(null);
    }
  }, [showLegacy]);

  const toggle = useCallback(async (node: FileTreeNode) => {
    const willOpen = !expanded.has(node.path);
    if (willOpen) await loadChildren(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }, [expanded, loadChildren]);

  // Reveal a path on request (a folder link clicked in chat): walk the ancestor
  // chain, loading deferred children level by level and expanding each, then
  // scroll the target node into view. Keyed on revealNonce so re-clicking the
  // same path re-triggers.
  useEffect(() => {
    if (revealPath === undefined) return;
    let cancelled = false;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    setQuery('');
    void (async () => {
      const root = treeRef.current;
      if (!root) return;
      const segments = revealPath.split('/').filter(Boolean);
      let node: FileTreeNode = root;
      setExpanded((prev) => new Set(prev).add(''));
      let acc = '';
      for (const seg of segments) {
        if (cancelled) return;
        acc = acc ? `${acc}/${seg}` : seg;
        let children = node.children;
        if (!children) children = await loadChildren(node);
        const child = children?.find((c) => c.path === acc || c.name === seg);
        if (!child) break;
        if (child.type === 'directory') {
          setExpanded((prev) => new Set(prev).add(child.path));
        }
        node = child;
      }
      if (cancelled) return;
      // Let the newly expanded rows render before scrolling to the target.
      scrollTimer = setTimeout(() => {
        if (cancelled) return;
        const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(revealPath) : revealPath;
        document.querySelector(`[data-tree-path="${safe}"]`)?.scrollIntoView({ block: 'center' });
      }, 80);
    })();
    return () => {
      cancelled = true;
      if (scrollTimer) clearTimeout(scrollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPath, revealNonce]);

  // Live-refetch when TARDIS changes the tree (not our own human writes).
  const { events } = useScribeSocket();
  const lastEventRef = useRef<typeof events[number] | null>(null);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || last === lastEventRef.current) return;
    lastEventRef.current = last;
    const p = last.payload as any;
    if (p?.kind === 'workspace-change' && p?.by !== 'human') void refetch();
  }, [events, refetch]);

  const handleRenameSubmit = useCallback(async (node: FileTreeNode, newName: string) => {
    setRenamingPath(null);
    const parentDir = node.path.split('/').slice(0, -1).join('/');
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      await renameWorkspaceEntry(node.path, newPath);
      await refetch();
    } catch (err: any) {
      alert(`Rename failed: ${err?.message ?? err}`);
    }
  }, [refetch]);

  const handleDelete = useCallback(async (node: FileTreeNode) => {
    if (!confirm(`Delete ${node.name}? This cannot be undone.`)) return;
    try {
      await deleteWorkspaceEntry(node.path);
      await refetch();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? err}`);
    }
  }, [refetch]);

  const handleNewEntry = useCallback((parentPath: string, kind: 'file' | 'directory') => {
    // Hub root is locked. File creates at root go to inbox instead.
    if (!parentPath && kind === 'file') {
      setNewEntryParent({ parent: 'inbox', kind: 'file' });
      setExpanded((prev) => { const n = new Set(prev); n.add(''); n.add('inbox'); return n; });
      return;
    }
    if (!parentPath && kind === 'directory') {
      alert('Hub root is locked. Create folders under inbox, projects, areas, resources, scratch, Shares, or archive.');
      return;
    }
    setNewEntryParent({ parent: parentPath, kind });
    setExpanded((prev) => { const n = new Set(prev); n.add(parentPath); return n; });
  }, []);

  const createInboxNote = useCallback(async () => {
    const path = inboxNotePath('note');
    try {
      await createWorkspaceEntry(path, 'file');
      try {
        const day = todayStamp();
        await saveWorkspaceFile(
          path,
          ['---', 'title: Note', 'type: page', `updated: ${day}`, '---', '', '# Note', '', ''].join('\n'),
        );
      } catch {
        /* empty file is fine */
      }
      await refetch();
      onOpenFile(path, path.split('/').pop() || path);
      setExpanded((prev) => {
        const n = new Set(prev);
        n.add('');
        n.add('inbox');
        return n;
      });
    } catch (err: any) {
      alert(`Inbox note failed: ${err?.message ?? err}`);
    }
  }, [onOpenFile, refetch]);

  const submitNewEntry = async (name: string) => {
    if (!newEntryParent || !name.trim()) { setNewEntryParent(null); return; }
    const { parent, kind } = newEntryParent;
    let fileName = name.trim();
    if (parent === 'inbox' && kind === 'file' && !fileName.includes('/')) {
      // auto-date prefix if user typed a bare name
      if (!/^\d{4}-\d{2}-\d{2}-/.test(fileName)) {
        fileName = inboxNotePath(fileName.replace(/\.md$/i, '')).split('/').pop()!;
      }
      if (!fileName.endsWith('.md')) fileName = `${fileName}.md`;
    }
    const path = parent ? `${parent}/${fileName}` : fileName;
    setNewEntryParent(null);
    try {
      await createWorkspaceEntry(path, kind);
      await refetch();
      if (kind === 'file') onOpenFile(path, fileName);
    } catch (err: any) {
      alert(`Create failed: ${err?.message ?? err}`);
    }
  };


  const handleTreeMove = useCallback(async (targetDir: string, sourcePath: string) => {
    setDropTargetPath(null);
    setDraggingPath(null);
    if (!sourcePath || movingRef.current) return;

    const name = sourcePath.split('/').filter(Boolean).pop() || sourcePath;
    const destPath = targetDir ? `${targetDir}/${name}` : name;
    if (destPath === sourcePath) return;
    if (parentDir(sourcePath) === targetDir) return; // already there
    if (isSelfOrDescendant(sourcePath, targetDir)) {
      alert('Cannot move a folder into itself.');
      return;
    }

    movingRef.current = true;
    try {
      await renameWorkspaceEntry(sourcePath, destPath);
      onPathsMoved?.(sourcePath, destPath);
      await refetch();
      // Keep destination expanded so the move is visible.
      setExpanded((prev) => {
        const n = new Set(prev);
        n.add('');
        if (targetDir) n.add(targetDir);
        return n;
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // Surface hub policy errors cleanly (JSON body often wraps {error:...})
      try {
        const parsed = JSON.parse(msg);
        alert(`Move failed: ${parsed.error || msg}`);
      } catch {
        alert(`Move failed: ${msg}`);
      }
    } finally {
      movingRef.current = false;
    }
  }, [onPathsMoved, refetch]);

  return (
    <>
      <div className="studio-tree-head">
        <span className="studio-tree-title">{data?.displayPath ?? '~/ASSISTANT-HUB'}</span>
        <div className="studio-tree-actions">
          <button title="New inbox note" onClick={() => void createInboxNote()}><Inbox size={14} /></button>
          <button title="New file in inbox" onClick={() => handleNewEntry('inbox', 'file')}><FilePlus size={14} /></button>
          <button
            title={showLegacy ? 'Hide legacy' : 'Show legacy'}
            className={showLegacy ? 'active' : ''}
            onClick={() => setShowLegacy((v) => !v)}
          >
            {showLegacy ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button title={isFetching ? 'Refreshing' : 'Refresh'} onClick={() => void refetch()}><RefreshCcw size={14} className={isFetching ? 'spin' : ''} /></button>
        </div>
      </div>

      <div className="hub-spaces" aria-label="Hub spaces">
        <button
          type="button"
          className="hub-space-chip home"
          title={HUB_HOME.blurb}
          onClick={() => onOpenFile(HUB_HOME.path, HUB_HOME.label)}
        >
          <span>{HUB_HOME.emoji}</span> {HUB_HOME.label}
        </button>
        {HUB_SPACES.map((space) => (
          <button
            key={space.id}
            type="button"
            className="hub-space-chip"
            title={space.blurb}
            onClick={() => {
              setExpanded((prev) => {
                const n = new Set(prev);
                n.add('');
                n.add(space.path);
                return n;
              });
              void (async () => {
                const root = treeRef.current;
                const node = root?.children?.find((c) => c.path === space.path || c.name === space.path);
                if (node) await loadChildren(node);
              })();
            }}
          >
            <span>{space.emoji}</span> {space.label}
          </button>
        ))}
        {showLegacy && (
          <button
            type="button"
            className="hub-space-chip legacy"
            title={HUB_LEGACY.blurb}
            onClick={() => {
              setExpanded((prev) => {
                const n = new Set(prev);
                n.add('');
                n.add('legacy');
                return n;
              });
            }}
          >
            <span>{HUB_LEGACY.emoji}</span> {HUB_LEGACY.label}
          </button>
        )}
      </div>

      <div className="hub-ticker" title={ticker}>
        <span className="hub-ticker-track">{ticker}</span>
      </div>

      <div className="filetree-search">
        <Search size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search spaces & files" />
      </div>

      {newEntryParent && (
        <div style={{ padding: '4px 8px' }}>
          <input
            ref={newEntryRef}
            className="tree-rename-input"
            autoFocus
            placeholder={newEntryParent.kind === 'file' ? 'filename.md' : 'folder-name'}
            onBlur={() => setNewEntryParent(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewEntry((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setNewEntryParent(null);
            }}
          />
        </div>
      )}

      <div className="filetree r-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {filteredTree ? (
          <TreeNode
            node={filteredTree}
            depth={0}
            expanded={expanded}
            query={query}
            selectedPath={selectedPath}
            loadingPath={loadingPath}
            renamingPath={renamingPath}
            dirtyPaths={dirtyPaths}
            dropTargetPath={dropTargetPath}
            draggingPath={draggingPath}
            onToggle={toggle}
            onOpenFile={(node) => onOpenFile(node.path, node.name)}
            onContextMenu={(e, node) => setContextMenu({ x: e.clientX, y: e.clientY, node })}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenamingPath(null)}
            onDragPath={(path) => {
              setDraggingPath(path);
              if (!path) setDropTargetPath(null);
            }}
            onHoverDir={setDropTargetPath}
            onDropOn={(dir, source) => { void handleTreeMove(dir, source); }}
          />
        ) : (
          <div className="filetree-empty">Reading the workspace...</div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onRename={(node) => setRenamingPath(node.path)}
          onDelete={handleDelete}
          onNewFile={(parent) => handleNewEntry(parent, 'file')}
          onNewFolder={(parent) => handleNewEntry(parent, 'directory')}
          onAskElrond={onAskElrond}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
