import { ChevronRight, File, FileText, Folder, FolderOpen, RefreshCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { apiJson } from '../data/api';
import type { FileTreeNode, WorkspaceChildrenResponse, WorkspaceFileResponse } from '../data/types';
import { useWorkspaceTree } from '../hooks/useRoomData';

export function Library() {
  const { data, refetch, isFetching } = useWorkspaceTree();
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(readPathParam()));
  const [selected, setSelected] = useState<WorkspaceFileResponse | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [deepLinkTarget, setDeepLinkTarget] = useState<string | null>(() => readPathParam());

  useEffect(() => {
    if (data?.tree) setTree(data.tree);
  }, [data?.tree]);

  const filteredTree = useMemo(() => {
    if (!tree) return null;
    return filterTree(tree, query);
  }, [tree, query]);

  const openFile = async (node: FileTreeNode) => {
    if (node.type !== 'file') return;
    setLoadingFile(true);
    try {
      setSelected(await apiJson<WorkspaceFileResponse>(`/api/docs/file?path=${encodeURIComponent(node.path)}`));
    } finally {
      setLoadingFile(false);
    }
  };

  const loadChildren = async (node: FileTreeNode): Promise<FileTreeNode[]> => {
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
  };

  const toggle = async (node: FileTreeNode) => {
    const willOpen = !expanded.has(node.path);
    if (willOpen) await loadChildren(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };

  useEffect(() => {
    if (!deepLinkTarget || !tree) return;
    let cancelled = false;

    void (async () => {
      const parts = deepLinkTarget.split('/').filter(Boolean);
      let current = tree;
      let walked = '';
      for (const segment of parts) {
        walked = walked ? `${walked}/${segment}` : segment;
        const children = current.children ?? (await loadChildren(current));
        if (cancelled) return;
        const next = children.find((child) => child.path === walked);
        if (!next) break;
        setExpanded((prev) => {
          if (prev.has(next.path)) return prev;
          const updated = new Set(prev);
          updated.add(next.path);
          return updated;
        });
        if (next.type === 'file') {
          await openFile(next);
          break;
        }
        current = next;
      }

      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      params.delete('path');
      const search = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
      setDeepLinkTarget(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [tree, deepLinkTarget]);

  useEffect(() => {
    const onNav = () => {
      const next = readPathParam();
      if (!next) return;
      setDeepLinkTarget(next);
      setExpanded((prev) => {
        const merged = new Set(prev);
        for (const path of initialExpanded(next)) merged.add(path);
        return merged;
      });
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);

  return (
    <div className="library-room">
      <RoomHeader
        eyebrow="The Library"
        title="Elrond's workspace"
        subtitle={data?.displayPath ?? '~/Documents/ASSISTANT-HUB'}
        actions={
          <>
            <Chip tone="gold">{data?.fileCount ?? 0} loaded files</Chip>
            <Chip>{data?.dirCount ?? 0} loaded folders</Chip>
            <Button tone="ghost" onClick={() => refetch()}>
              <RefreshCcw size={15} />
              {isFetching ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      <div className="library-shell">
        <aside className="filetree-panel">
          <div className="filetree-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ASSISTANT-HUB" />
          </div>
          <div className="filetree r-scroll">
            {filteredTree ? (
              <TreeNode
                node={filteredTree}
                depth={0}
                expanded={expanded}
                query={query}
                selectedPath={selected?.path}
                loadingPath={loadingPath}
                onToggle={toggle}
                onOpenFile={openFile}
              />
            ) : (
              <div className="filetree-empty">Reading the workspace...</div>
            )}
          </div>
        </aside>

        <main className="file-preview">
          {selected ? (
            <>
              <header>
                <div>
                  <p className="r-eyebrow-gold">{selected.language || 'file'}</p>
                  <h2>{selected.name}</h2>
                  <span>{selected.path}</span>
                </div>
                <Chip tone={selected.tooLarge ? 'rose' : 'elf'}>{formatBytes(selected.size)}</Chip>
              </header>
              <FilePreviewBody file={selected} loading={loadingFile} />
            </>
          ) : (
            <div className="file-preview-empty">
              <FolderOpen size={34} />
              <h2>ASSISTANT-HUB is Elrond's working shelf.</h2>
              <p>Select a file on the left to preview it. Heavy folders like <code>node_modules</code> and <code>.git</code> load when opened.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FilePreviewBody({ file, loading }: { file: WorkspaceFileResponse; loading: boolean }) {
  if (loading) return <pre className="file-content r-scroll">Loading...</pre>;
  if (!isMarkdownFile(file)) return <pre className="file-content r-scroll">{file.content}</pre>;

  return (
    <div className="markdown-content r-scroll">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {file.content}
      </ReactMarkdown>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  query,
  selectedPath,
  loadingPath,
  onToggle,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  query: string;
  selectedPath?: string;
  loadingPath: string | null;
  onToggle: (node: FileTreeNode) => Promise<void>;
  onOpenFile: (node: FileTreeNode) => void;
}) {
  const isDirectory = node.type === 'directory';
  const isOpen = query.trim() ? true : expanded.has(node.path);
  const isLoading = loadingPath === node.path;
  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : fileIcon(node.name);

  return (
    <div className="tree-node">
      <button
        className={`${selectedPath === node.path ? 'selected' : ''} ${isDirectory ? 'directory' : 'file'} ${isLoading ? 'loading' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => void (isDirectory ? onToggle(node) : onOpenFile(node))}
      >
        {isDirectory ? <ChevronRight className={isOpen ? 'open' : ''} size={14} /> : <span className="tree-spacer" />}
        <Icon size={15} />
        <span>{node.name}</span>
        {isDirectory ? <code>{isLoading ? '...' : node.error ? '!' : node.children ? node.children.length : node.deferred ? 'load' : ''}</code> : null}
      </button>
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
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  return {
    ...root,
    children: root.children.map((child) => attachChildren(child, path, children)),
  };
}

function fileIcon(name: string) {
  return /\.(md|mdx|txt|json|yaml|yml|toml|env|sql)$/i.test(name) ? FileText : File;
}

function isMarkdownFile(file: WorkspaceFileResponse): boolean {
  return file.language === 'md' || file.language === 'markdown' || /\.md$/i.test(file.name);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readPathParam(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('path');
  return value ? value.replace(/^\//, '') : null;
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
