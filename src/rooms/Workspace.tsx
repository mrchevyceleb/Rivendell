import {
  ChevronRight,
  Code2,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  MessageSquare,
  RefreshCcw,
  Save,
  Send,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import {
  apiJson,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  fetchWorkspaceFileForEdit,
  renameWorkspaceEntry,
  saveWorkspaceFile,
} from '../data/api';
import type { FileTreeNode, WorkspaceChildrenResponse, WorkspaceEditFileResponse } from '../data/types';
import { useWorkspaceTree } from '../hooks/useRoomData';
import { useScribeSocket } from '../hooks/useScribeSocket';
import { useChat } from '../chat/hooks/useChat';
import { useRepos } from '../chat/hooks/useRepos';
import { useCompanionPicker } from '../chat/hooks/useCompanionPicker';
import { CompanionControls } from '../chat/components/CompanionControls';
import { Conversation } from '../chat/components/desktop/Conversation';

// ─── Companion display label ────────────────────────────────────────────────

function companionAgentLabel(cli: string): string {
  switch (cli) {
    case 'assistant': return 'Elrond';
    case 'claude': return 'Personal Claude';
    case 'codex': return 'Codex';
    case 'codex-personal': return 'Personal Codex';
    case 'banana': return 'OpenRouter';
    case 'banana-local': return 'Local';
    case 'banana-fireworks': return 'Fireworks';
    default: return cli;
  }
}

// ─── CodeMirror language map ────────────────────────────────────────────────

function languageExtension(lang: string) {
  switch (lang) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return javascript({ jsx: true });
    case 'ts': case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'json': return json();
    case 'md': case 'mdx': case 'markdown': return markdown();
    case 'py': return python();
    case 'css': return css();
    case 'html': return html();
    default: return null;
  }
}

// ─── Workspace parchment theme for CodeMirror ───────────────────────────────

const parchmentTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: 'var(--mono, ui-monospace, monospace)',
    background: 'var(--bg-deep)',
    color: 'var(--ink)',
    height: '100%',
  },
  '.cm-content': { padding: '16px 24px', caretColor: 'var(--r-gold)' },
  '.cm-cursor': { borderLeftColor: 'var(--r-gold)' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: 'var(--bg-deep)', borderRight: '1px solid var(--r-line)', color: 'var(--ink-faint)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--r-gold) 8%, transparent)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--r-gold) 5%, transparent)' },
  '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--r-elf-blue) 25%, transparent)' },
  '&.cm-focused .cm-selectionBackground': { background: 'color-mix(in srgb, var(--r-elf-blue) 30%, transparent)' },
}, { dark: true });

// ─── CodeMirror editor component ────────────────────────────────────────────

function CodeEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly,
}: {
  value: string;
  language: string;
  onChange: (v: string) => void;
  onSave: () => void;
  readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = useRef(value);

  useEffect(() => {
    if (!containerRef.current) return;
    const langExt = languageExtension(language);
    const saveKeymap = keymap.of([{
      key: 'Mod-s',
      run: () => { onSaveRef.current(); return true; },
    }]);
    const extensions = [
      history(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      saveKeymap,
      parchmentTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newVal = update.state.doc.toString();
          valueRef.current = newVal;
          onChangeRef.current(newVal);
        }
      }),
      EditorView.lineWrapping,
      ...(langExt ? [langExt] : []),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // Only recreate when file changes (language / readOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  // Sync external value changes (e.g. live-reload) without destroying editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === valueRef.current) return;
    valueRef.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', overflow: 'auto' }}
      className="r-scroll"
    />
  );
}

// ─── File tree utils ─────────────────────────────────────────────────────────

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

function initialExpanded(target: string | null): Set<string> {
  const set = new Set<string>(['']);
  if (!target) return set;
  const parts = target.split('/').filter(Boolean);
  let walked = '';
  for (const part of parts) {
    walked = walked ? `${walked}/${part}` : part;
    set.add(walked);
  }
  return set;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Context menu ────────────────────────────────────────────────────────────

type ContextMenuState = {
  x: number;
  y: number;
  node: FileTreeNode;
};

function ContextMenu({
  menu,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onSendToElrond,
  onClose,
}: {
  menu: ContextMenuState;
  onRename: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onSendToElrond: (path: string) => void;
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
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
        zIndex: 1000,
        background: 'var(--r-card)',
        border: '1px solid var(--r-line)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      {menu.node.type === 'file' && (
        <button className="ctx-item" onClick={() => { onSendToElrond(menu.node.path); onClose(); }}>
          <MessageSquare size={13} /> Send to Elrond
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

// ─── Tree node ───────────────────────────────────────────────────────────────

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
          {isDirty && <span style={{ color: 'var(--r-gold)', marginLeft: 4, fontSize: 10 }}>●</span>}
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

// ─── Main Workspace component ────────────────────────────────────────────────

export function Workspace() {
  // Tree state
  const { data, refetch, isFetching } = useWorkspaceTree();
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(null));
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  // Editor state
  const [openDoc, setOpenDoc] = useState<WorkspaceEditFileResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [baselineModifiedAt, setBaselineModifiedAt] = useState<string | undefined>();
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [externalChange, setExternalChange] = useState<string | null>(null);

  // Rename/delete/new state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newEntryParent, setNewEntryParent] = useState<{ parent: string; kind: 'file' | 'directory' } | null>(null);
  const newEntryRef = useRef<HTMLInputElement>(null);

  // Chat/Elrond
  const { repos } = useRepos();
  const assistantHubRepo = repos.find((r) => r.isAssistantHub) ?? repos[0];

  const picker = useCompanionPicker('rivendell:workspace-companion');

  const chat = useChat({
    repo: assistantHubRepo,
    cli: picker.cli,
    chatId: 'workspace',
    enabled: Boolean(assistantHubRepo),
    model: picker.model,
    effort: picker.effort,
  });

  // Mirror chat.send into a ref so sendToElrond is stable (no stale closure).
  const chatSendRef = useRef(chat.send);
  chatSendRef.current = chat.send;

  const dirty = Boolean(openDoc?.editable && draft !== openDoc.content);

  // Scribe live-sync
  const { events } = useScribeSocket();
  const lastEventRef = useRef<typeof events[number] | null>(null);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || last === lastEventRef.current) return;
    lastEventRef.current = last;
    const p = last.payload as any;
    if (p?.kind !== 'workspace-change' || p?.by === 'human') return;
    void refetch();
    if (!openDoc) return;
    const changedPath: string = p?.path ?? '';
    // A rename/delete of an ancestor also invalidates the open document.
    const affectsOpenDoc = changedPath === openDoc.path || openDoc.path.startsWith(`${changedPath}/`);
    if (!affectsOpenDoc) return;
    if (p?.op === 'change' && changedPath === openDoc.path) {
      // File contents changed — reload if clean, warn if dirty.
      if (!dirty) {
        void reloadOpenFile(openDoc.path);
      } else {
        setExternalChange(`Elrond changed ${changedPath}`);
      }
    } else {
      // Parent dir renamed/deleted or file itself removed — close the editor.
      setOpenDoc(null);
      setDraft('');
      setExternalChange(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Unsaved-changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Sync tree from query
  useEffect(() => {
    if (data?.tree) setTree(data.tree);
  }, [data?.tree]);

  const filteredTree = useMemo(() => {
    if (!tree) return null;
    return filterTree(tree, query);
  }, [tree, query]);

  // ── Tree ops ─────────────────────────────────────────────────────────────

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

  // ── Editor ops ────────────────────────────────────────────────────────────

  const openFile = useCallback(async (node: FileTreeNode) => {
    if (node.type !== 'file') return;
    if (dirty) {
      if (!confirm(`You have unsaved changes in ${openDoc?.name}. Discard and open ${node.name}?`)) return;
    }
    setLoadingFile(true);
    setSaveError(null);
    setConflictInfo(null);
    setExternalChange(null);
    try {
      const doc = await fetchWorkspaceFileForEdit(node.path);
      setOpenDoc(doc);
      setDraft(doc.content);
      setBaselineModifiedAt(doc.modifiedAt);
      setViewMode('edit');
    } finally {
      setLoadingFile(false);
    }
  }, [dirty, openDoc?.name]);

  const reloadOpenFile = async (path: string) => {
    const doc = await fetchWorkspaceFileForEdit(path);
    setOpenDoc(doc);
    setDraft(doc.content);
    setBaselineModifiedAt(doc.modifiedAt);
    setExternalChange(null);
  };

  const handleSave = useCallback(async () => {
    if (!openDoc || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setConflictInfo(null);
    try {
      const result = await saveWorkspaceFile(openDoc.path, draft, baselineModifiedAt);
      setOpenDoc((prev) => prev ? { ...prev, content: draft, modifiedAt: result.modifiedAt, size: result.size } : prev);
      setBaselineModifiedAt(result.modifiedAt);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes('409') || msg.includes('changed on disk')) {
        setConflictInfo(msg);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [openDoc, dirty, saving, draft, baselineModifiedAt]);

  // ── File management ops ───────────────────────────────────────────────────

  const handleRenameSubmit = useCallback(async (node: FileTreeNode, newName: string) => {
    setRenamingPath(null);
    const parentDir = node.path.split('/').slice(0, -1).join('/');
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      await renameWorkspaceEntry(node.path, newPath);
      if (openDoc?.path === node.path) setOpenDoc((prev) => prev ? { ...prev, path: newPath, name: newName } : prev);
      await refetch();
    } catch (err: any) {
      alert(`Rename failed: ${err?.message ?? err}`);
    }
  }, [openDoc, refetch]);

  const handleDelete = useCallback(async (node: FileTreeNode) => {
    if (!confirm(`Delete ${node.name}? This cannot be undone.`)) return;
    try {
      await deleteWorkspaceEntry(node.path);
      if (openDoc?.path === node.path) { setOpenDoc(null); setDraft(''); }
      await refetch();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? err}`);
    }
  }, [openDoc, refetch]);

  const handleNewEntry = useCallback(async (parentPath: string, kind: 'file' | 'directory') => {
    setNewEntryParent({ parent: parentPath, kind });
    // Expand the parent dir so the new input is visible
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
      if (kind === 'file') {
        const doc = await fetchWorkspaceFileForEdit(path);
        setOpenDoc(doc); setDraft(doc.content); setBaselineModifiedAt(doc.modifiedAt);
      }
    } catch (err: any) {
      alert(`Create failed: ${err?.message ?? err}`);
    }
  };

  const sendToElrond = useCallback((path: string) => {
    const ref = `ASSISTANT-HUB/${path}`;
    chatSendRef.current(`Please open and review \`${ref}\`.`);
  }, []);

  const isMarkdownView = openDoc?.language === 'md' || openDoc?.language === 'markdown' || (openDoc?.name?.endsWith('.md') ?? false);

  // Easter egg click handler on room header eyebrow
  const [eyebrowHits, setEyebrowHits] = useState(0);
  const flavors = ['The Workspace', 'Mend a scroll', 'Tend the archive', 'Edit in peace', 'Works of craft'];

  // Click easter egg
  const spawnEmoji = useCallback((e: React.MouseEvent) => {
    const emojis = ['✨', '📜', '⚔️', '🌿', '🔮', '🪄', '📖', '⭐'];
    const el = document.createElement('span');
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;pointer-events:none;font-size:20px;z-index:9999;animation:workspace-pop 0.8s ease forwards`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }, []);

  return (
    <>
      <style>{`
        @keyframes workspace-pop {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-48px) scale(1.4); opacity: 0; }
        }
        @keyframes workspace-save-pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--r-gold) 60%, transparent); }
          70%  { box-shadow: 0 0 0 8px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .workspace-save-pulse { animation: workspace-save-pulse 0.4s ease; }
        .ctx-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 6px 14px; background: none; border: none;
          color: var(--r-star); font-size: 13px; cursor: pointer; text-align: left;
          transition: background 0.12s;
        }
        .ctx-item:hover { background: color-mix(in srgb, var(--r-gold) 12%, transparent); }
        .ctx-item-danger { color: var(--r-rose, #e06c75) !important; }
        .tree-rename-input {
          width: calc(100% - 8px); margin: 0 4px; padding: 2px 6px;
          background: var(--r-card); border: 1px solid var(--r-gold);
          border-radius: 3px; color: var(--r-star); font-size: 13px; outline: none;
        }
        .workspace-editor-header {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 16px; border-bottom: 1px solid var(--r-line);
          background: var(--r-card); flex-shrink: 0; min-height: 44px; flex-wrap: wrap;
        }
      `}</style>

      <div className="library-room" onClick={spawnEmoji}>
        <RoomHeader
          eyebrow={flavors[eyebrowHits % flavors.length]}
          title="Workspace"
          subtitle={data?.displayPath ?? '~/ASSISTANT-HUB'}
          actions={
            <>
              <Chip tone="gold">{data?.fileCount ?? 0} files</Chip>
              <Chip>{data?.dirCount ?? 0} folders</Chip>
              <Button tone="ghost" onClick={() => handleNewEntry('', 'file')}>
                <FilePlus size={15} /> New file
              </Button>
              <Button tone="ghost" onClick={() => handleNewEntry('', 'folder' as 'directory')}>
                <FolderPlus size={15} /> New folder
              </Button>
              <Button
                tone="ghost"
                onClick={(e) => { e.stopPropagation(); setEyebrowHits((h) => h + 1); void refetch(); }}
              >
                <RefreshCcw size={15} />
                {isFetching ? 'Refreshing' : 'Refresh'}
              </Button>
            </>
          }
        />

        <div
          className="library-shell"
          style={{ display: 'grid', gridTemplateColumns: 'var(--ws-tree-w, 280px) 1fr var(--ws-chat-w, 380px)', minHeight: 0, height: '100%' }}
        >
          {/* ── Left: file tree ────────────────────────────────────────── */}
          <aside className="filetree-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', borderRight: '1px solid var(--r-line)' }}>
            <div className="filetree-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ASSISTANT-HUB"
              />
            </div>

            {/* New entry inline input */}
            {newEntryParent && (
              <div style={{ padding: '4px 8px' }}>
                <input
                  ref={newEntryRef}
                  className="tree-rename-input"
                  autoFocus
                  placeholder={newEntryParent.kind === 'file' ? 'filename.ts' : 'folder-name'}
                  onBlur={() => setNewEntryParent(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { void submitNewEntry((e.target as HTMLInputElement).value); }
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
                  selectedPath={openDoc?.path}
                  loadingPath={loadingPath}
                  renamingPath={renamingPath}
                  dirtyPaths={openDoc && dirty ? new Set([openDoc.path]) : undefined}
                  onToggle={toggle}
                  onOpenFile={openFile}
                  onContextMenu={(e, node) => setContextMenu({ x: e.clientX, y: e.clientY, node })}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={() => setRenamingPath(null)}
                />
              ) : (
                <div className="filetree-empty">Reading the workspace...</div>
              )}
            </div>
          </aside>

          {/* ── Center: editor ─────────────────────────────────────────── */}
          <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}>
            {openDoc ? (
              <>
                <div className="workspace-editor-header">
                  <span style={{ color: 'var(--r-gold)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{openDoc.language || 'file'}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{openDoc.name}</span>
                  <span style={{ color: 'var(--r-ink-mute)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{openDoc.path}</span>

                  {dirty && <Chip tone="gold">unsaved</Chip>}
                  {saving && <Chip tone="neutral">saving…</Chip>}
                  {!dirty && !saving && openDoc.editable && <Chip tone="elf">saved</Chip>}
                  {!openDoc.editable && <Chip tone="rose">{openDoc.reason === 'binary' ? 'binary' : 'too large'}</Chip>}

                  <Chip>{formatBytes(openDoc.size)}</Chip>

                  {isMarkdownView && openDoc.editable && (
                    <Button tone="ghost" onClick={() => setViewMode((m) => m === 'edit' ? 'preview' : 'edit')}>
                      {viewMode === 'edit' ? <><Eye size={13} /> Preview</> : <><Code2 size={13} /> Source</>}
                    </Button>
                  )}

                  {openDoc.editable && (
                    <Button
                      tone="gold"
                      onClick={handleSave}
                      disabled={!dirty || saving}
                    >
                      <Save size={13} /> Save
                    </Button>
                  )}

                  <Button tone="ghost" onClick={() => sendToElrond(openDoc.path)}>
                    <Send size={13} /> Ask {companionAgentLabel(picker.companion)}
                  </Button>

                  <Button tone="ghost" onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) { setOpenDoc(null); setDraft(''); } }}>
                    <X size={13} />
                  </Button>
                </div>

                {saveError && (
                  <div style={{ background: 'color-mix(in srgb, var(--r-rose, #e06c75) 15%, transparent)', padding: '8px 16px', fontSize: 12, color: 'var(--r-rose, #e06c75)' }}>
                    Save failed: {saveError}
                  </div>
                )}

                {conflictInfo && (
                  <div style={{ background: 'color-mix(in srgb, var(--r-gold) 12%, transparent)', padding: '8px 16px', fontSize: 12, color: 'var(--r-gold)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span>⚠ Conflict: {conflictInfo}</span>
                    <button onClick={() => { void reloadOpenFile(openDoc.path); setConflictInfo(null); }} style={{ background: 'none', border: '1px solid var(--r-gold)', borderRadius: 4, padding: '2px 8px', color: 'var(--r-gold)', cursor: 'pointer', fontSize: 11 }}>Reload theirs</button>
                    <button onClick={() => { void saveWorkspaceFile(openDoc.path, draft).then((r) => { setBaselineModifiedAt(r.modifiedAt); setOpenDoc((p) => p ? { ...p, content: draft, modifiedAt: r.modifiedAt } : p); setConflictInfo(null); }); }} style={{ background: 'none', border: '1px solid var(--r-gold)', borderRadius: 4, padding: '2px 8px', color: 'var(--r-gold)', cursor: 'pointer', fontSize: 11 }}>Overwrite</button>
                  </div>
                )}

                {externalChange && !conflictInfo && (
                  <div style={{ background: 'color-mix(in srgb, var(--r-elf-blue) 12%, transparent)', padding: '6px 16px', fontSize: 12, color: 'var(--r-elf-blue)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span>Elrond is tending this file</span>
                    {!dirty && <button onClick={() => { void reloadOpenFile(openDoc.path); }} style={{ background: 'none', border: '1px solid var(--r-elf-blue)', borderRadius: 4, padding: '2px 8px', color: 'var(--r-elf-blue)', cursor: 'pointer', fontSize: 11 }}>Reload</button>}
                  </div>
                )}

                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  {loadingFile ? (
                    <div style={{ padding: 24, color: 'var(--r-ink-mute)', fontFamily: 'var(--mono)', fontSize: 13 }}>Opening...</div>
                  ) : !openDoc.editable ? (
                    <div style={{ padding: 24, color: 'var(--r-ink-mute)' }}>
                      <p style={{ margin: 0, fontSize: 13 }}>
                        {openDoc.reason === 'binary' ? (
                          <>Binary file — <a href={`/api/files/raw?path=${encodeURIComponent(openDoc.path)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--r-gold)' }}>Open in browser</a></>
                        ) : (
                          <>File too large to edit ({formatBytes(openDoc.size)}). Max 2 MB.</>
                        )}
                      </p>
                    </div>
                  ) : isMarkdownView && viewMode === 'preview' ? (
                    <div className="markdown-content r-scroll" style={{ padding: '16px 24px', height: '100%', overflowY: 'auto' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
                    </div>
                  ) : (
                    <CodeEditor
                      value={draft}
                      language={openDoc.language}
                      onChange={setDraft}
                      onSave={handleSave}
                      readOnly={!openDoc.editable}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="file-preview-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <Code2 size={40} style={{ color: 'var(--r-gold)', opacity: 0.5 }} />
                <h2 style={{ margin: 0, fontFamily: 'var(--serif-display)', fontStyle: 'italic', color: 'var(--r-ink-soft)', fontSize: 20 }}>Choose a scroll to mend</h2>
                <p style={{ margin: 0, color: 'var(--r-ink-mute)', fontSize: 13, textAlign: 'center', maxWidth: 320 }}>
                  Select a file in the tree to open it. Right-click for create, rename, delete, and ask Elrond.
                </p>
              </div>
            )}
          </main>

          {/* ── Right: Elrond chat ─────────────────────────────────────── */}
          <aside style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', borderLeft: '1px solid var(--r-line)', overflow: 'hidden' }}>
            <CompanionControls picker={picker} />
            <Conversation
              compact
              agent={companionAgentLabel(picker.companion)}
              repo={assistantHubRepo?.name}
              title="workspace thread"
              blocks={chat.blocks}
              status={chat.status}
              usage={chat.usage}
              errorText={chat.error}
              onSend={chat.send}
              onSteer={chat.steer}
              onStop={chat.stop}
              onFreshStart={chat.freshStart}
              acceptImages={false}
            />
          </aside>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onRename={(node) => setRenamingPath(node.path)}
          onDelete={handleDelete}
          onNewFile={(parent) => handleNewEntry(parent, 'file')}
          onNewFolder={(parent) => handleNewEntry(parent, 'directory')}
          onSendToElrond={sendToElrond}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
