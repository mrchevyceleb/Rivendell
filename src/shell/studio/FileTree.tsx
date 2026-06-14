import {
  ChevronRight,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  RefreshCcw,
  Search,
  Trash2,
  Type,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Primitives';
import {
  apiJson,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
} from '../../data/api';
import type { FileTreeNode, WorkspaceChildrenResponse } from '../../data/types';
import { useWorkspaceTree } from '../../hooks/useRoomData';
import { useScribeSocket } from '../../hooks/useScribeSocket';

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
          <MessageSquare size={13} /> Ask Elrond
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

function TreeNode({
  node,
  depth,
  expanded,
  query,
  selectedPath,
  loadingPath,
  renamingPath,
  dirtyPaths,
  onToggle,
  onOpenFile,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  query: string;
  selectedPath?: string;
  loadingPath: string | null;
  renamingPath: string | null;
  dirtyPaths?: Set<string>;
  onToggle: (node: FileTreeNode) => Promise<void>;
  onOpenFile: (node: FileTreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void;
  onRenameSubmit: (node: FileTreeNode, newName: string) => void;
  onRenameCancel: () => void;
}) {
  const isDirectory = node.type === 'directory';
  const isOpen = query.trim() ? true : expanded.has(node.path);
  const isLoading = loadingPath === node.path;
  const isRenaming = renamingPath === node.path;
  const isDirty = !isDirectory && dirtyPaths?.has(node.path);
  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : fileIcon(node.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) renameRef.current?.select();
  }, [isRenaming]);

  return (
    <div className="tree-node">
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
          className={`${selectedPath === node.path ? 'selected' : ''} ${isDirectory ? 'directory' : 'file'} ${isLoading ? 'loading' : ''}`}
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
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
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
}: {
  selectedPath?: string;
  dirtyPaths?: Set<string>;
  onOpenFile: (path: string, name: string) => void;
  onAskElrond: (path: string) => void;
}) {
  const { data, refetch, isFetching } = useWorkspaceTree();
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newEntryParent, setNewEntryParent] = useState<{ parent: string; kind: 'file' | 'directory' } | null>(null);
  const newEntryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data?.tree) setTree(data.tree);
  }, [data?.tree]);

  const filteredTree = useMemo(() => (tree ? filterTree(tree, query) : null), [tree, query]);

  const loadChildren = useCallback(async (node: FileTreeNode): Promise<FileTreeNode[]> => {
    if (node.type !== 'directory') return [];
    if (node.children) return node.children;
    setLoadingPath(node.path);
    try {
      const result = await apiJson<WorkspaceChildrenResponse>(`/api/docs/children?path=${encodeURIComponent(node.path)}`);
      setTree((prev) => (prev ? attachChildren(prev, node.path, result.children) : prev));
      return result.children;
    } finally {
      setLoadingPath(null);
    }
  }, []);

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

  // Live-refetch when Elrond changes the tree (not our own human writes).
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
    setNewEntryParent({ parent: parentPath, kind });
    setExpanded((prev) => { const n = new Set(prev); n.add(parentPath); return n; });
  }, []);

  const submitNewEntry = async (name: string) => {
    if (!newEntryParent || !name.trim()) { setNewEntryParent(null); return; }
    const { parent, kind } = newEntryParent;
    const path = parent ? `${parent}/${name.trim()}` : name.trim();
    setNewEntryParent(null);
    try {
      await createWorkspaceEntry(path, kind);
      await refetch();
      if (kind === 'file') onOpenFile(path, name.trim());
    } catch (err: any) {
      alert(`Create failed: ${err?.message ?? err}`);
    }
  };

  return (
    <>
      <div className="studio-tree-head">
        <span className="studio-tree-title">{data?.displayPath ?? '~/ASSISTANT-HUB'}</span>
        <div className="studio-tree-actions">
          <button title="New file" onClick={() => handleNewEntry('', 'file')}><FilePlus size={14} /></button>
          <button title="New folder" onClick={() => handleNewEntry('', 'directory')}><FolderPlus size={14} /></button>
          <button title={isFetching ? 'Refreshing' : 'Refresh'} onClick={() => void refetch()}><RefreshCcw size={14} className={isFetching ? 'spin' : ''} /></button>
        </div>
      </div>

      <div className="filetree-search">
        <Search size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" />
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
            onToggle={toggle}
            onOpenFile={(node) => onOpenFile(node.path, node.name)}
            onContextMenu={(e, node) => setContextMenu({ x: e.clientX, y: e.clientY, node })}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setRenamingPath(null)}
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
