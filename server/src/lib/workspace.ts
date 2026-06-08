import { mkdir, readdir, readFile, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { ELROND_WORKSPACE_PATH } from '../config.ts';

export type FileTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
  deferred?: boolean;
  error?: string;
};

const DEFERRED_DIRS = new Set([
  '.git',
  '.next',
  '.ruff_cache',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.env',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const TEXT_FILENAMES = new Set([
  '.dockerignore',
  '.env',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  'dockerfile',
  'makefile',
]);

export function workspaceRoot(): string {
  return resolve(ELROND_WORKSPACE_PATH);
}

// Display-only label sent to the client. Never an absolute Mac path; OneDrive
// syncs ASSISTANT-HUB to every device, so a friendly relative-style label is
// what we want the UI to show regardless of which machine Matt is on.
export const WORKSPACE_DISPLAY_LABEL = 'ASSISTANT-HUB';
export const WORKSPACE_DISPLAY_PATH = '~/Documents/ASSISTANT-HUB';

export async function readWorkspaceTree(): Promise<{ root: string; displayPath: string; tree: FileTreeNode; fileCount: number; dirCount: number }> {
  const absRoot = workspaceRoot();
  if (!existsSync(absRoot)) {
    throw new Error(`Elrond workspace does not exist: ${absRoot}`);
  }
  let fileCount = 0;
  let dirCount = 0;

  const walk = async (absPath: string, relPath: string, mode: 'recursive' | 'shallow'): Promise<FileTreeNode> => {
    const s = await stat(absPath);
    const node: FileTreeNode = {
      name: relPath ? basename(absPath) : WORKSPACE_DISPLAY_LABEL,
      path: relPath,
      type: s.isDirectory() ? 'directory' : 'file',
      size: s.isFile() ? s.size : undefined,
      modifiedAt: s.mtime.toISOString(),
    };

    if (s.isDirectory()) {
      dirCount += 1;
      const shouldDefer = mode === 'shallow' || (relPath !== '' && DEFERRED_DIRS.has(node.name));
      node.deferred = shouldDefer;
      if (!shouldDefer) {
        node.children = await readChildren(absPath, relPath, 'recursive', walk);
      }
    } else {
      fileCount += 1;
    }

    return node;
  };

  const tree = await walk(absRoot, '', 'recursive');
  return { root: WORKSPACE_DISPLAY_LABEL, displayPath: WORKSPACE_DISPLAY_PATH, tree, fileCount, dirCount };
}

export async function readWorkspaceChildren(relPath: string): Promise<{ root: string; path: string; children: FileTreeNode[] }> {
  const { absPath, inside } = resolveWorkspacePath(relPath, true);
  const s = await stat(absPath);
  if (!s.isDirectory()) throw new Error('Requested path is not a directory');

  const children = await readChildren(absPath, inside, 'shallow', async (childAbsPath, childRelPath, mode) => {
    const childStat = await stat(childAbsPath);
    const node: FileTreeNode = {
      name: basename(childAbsPath),
      path: childRelPath,
      type: childStat.isDirectory() ? 'directory' : 'file',
      size: childStat.isFile() ? childStat.size : undefined,
      modifiedAt: childStat.mtime.toISOString(),
    };
    if (childStat.isDirectory()) node.deferred = mode === 'shallow' || DEFERRED_DIRS.has(node.name);
    return node;
  });

  return { root: WORKSPACE_DISPLAY_LABEL, path: inside, children };
}

export async function readWorkspaceFile(relPath: string): Promise<{
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  language: string;
  content: string;
  tooLarge: boolean;
}> {
  const { absPath, inside } = resolveWorkspacePath(relPath, false);

  const s = await stat(absPath);
  if (!s.isFile()) throw new Error('Requested path is not a file');

  const ext = extname(absPath).toLowerCase();
  const tooLarge = s.size > 220_000;
  const isText = TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(basename(absPath).toLowerCase()) || basename(absPath).startsWith('.env');
  const content = tooLarge
    ? `File is ${Math.round(s.size / 1024)} KB. Preview is intentionally capped.`
    : isText
      ? await readFile(absPath, 'utf8')
      : 'Binary or unsupported file type. Preview is not available.';

  return {
    path: inside,
    name: basename(absPath),
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    language: ext.replace('.', '') || 'text',
    content,
    tooLarge,
  };
}

async function readChildren(
  absPath: string,
  relPath: string,
  mode: 'recursive' | 'shallow',
  readNode: (absPath: string, relPath: string, mode: 'recursive' | 'shallow') => Promise<FileTreeNode>,
): Promise<FileTreeNode[]> {
  const entries = await readdir(absPath, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return Promise.all(
    sorted.map(async (entry) => {
      const childAbsPath = resolve(absPath, entry.name);
      const childRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      try {
        return await readNode(childAbsPath, childRelPath, mode);
      } catch (error) {
        return {
          name: entry.name,
          path: childRelPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          error: error instanceof Error ? error.message : 'Unable to read this path',
        };
      }
    }),
  );
}

function resolveWorkspacePath(relPath: string, allowRoot: boolean): { absPath: string; inside: string } {
  const root = workspaceRoot();
  const absPath = resolve(root, relPath || '.');
  const inside = relative(root, absPath);
  if ((!allowRoot && inside === '') || inside.startsWith('..') || inside.startsWith('/')) {
    throw new Error('File path is outside the Elrond workspace');
  }
  return { absPath, inside };
}

async function assertInsideWorkspace(absPath: string): Promise<void> {
  const root = workspaceRoot();
  const realRoot = await realpath(root);
  let realTarget: string;
  try {
    realTarget = await realpath(absPath);
  } catch {
    // Path doesn't exist yet (create case) — lexical check is sufficient
    return;
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    throw new Error('File path is outside the Elrond workspace');
  }
}

const EDIT_MAX_BYTES = 2_000_000;

export async function readWorkspaceFileForEdit(relPath: string): Promise<{
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  language: string;
  content: string;
  editable: boolean;
  reason?: string;
}> {
  const { absPath, inside } = resolveWorkspacePath(relPath, false);
  const s = await stat(absPath);
  if (!s.isFile()) throw Object.assign(new Error('Requested path is not a file'), { code: 'EISDIR' });
  const ext = extname(absPath).toLowerCase();
  const name = basename(absPath);
  const language = ext.replace('.', '') || 'text';
  const meta = { path: inside, name, size: s.size, modifiedAt: s.mtime.toISOString(), language };
  const isText = TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(name.toLowerCase()) || name.startsWith('.env');
  if (!isText) return { ...meta, content: '', editable: false, reason: 'binary' };
  if (s.size > EDIT_MAX_BYTES) return { ...meta, content: '', editable: false, reason: 'too-large' };
  const content = await readFile(absPath, 'utf8');
  return { ...meta, content, editable: true };
}

export async function writeWorkspaceFile(
  relPath: string,
  content: string,
  opts?: { expectedModifiedAt?: string },
): Promise<{ path: string; size: number; modifiedAt: string }> {
  const { absPath, inside } = resolveWorkspacePath(relPath, false);
  await assertInsideWorkspace(absPath);
  const byteLen = Buffer.byteLength(content, 'utf8');
  if (byteLen > EDIT_MAX_BYTES) throw Object.assign(new Error('file too large to save'), { code: 'E2BIG' });
  if (opts?.expectedModifiedAt && existsSync(absPath)) {
    const cur = await stat(absPath);
    if (cur.mtime.toISOString() !== opts.expectedModifiedAt) {
      throw Object.assign(new Error('file changed on disk since you opened it'), { code: 'ECONFLICT' });
    }
  }
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
  const s = await stat(absPath);
  return { path: inside, size: s.size, modifiedAt: s.mtime.toISOString() };
}

export async function createWorkspaceEntry(
  relPath: string,
  kind: 'file' | 'directory',
): Promise<FileTreeNode> {
  const { absPath, inside } = resolveWorkspacePath(relPath, false);
  if (existsSync(absPath)) throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
  if (kind === 'directory') {
    await mkdir(absPath, { recursive: true });
  } else {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, '', { flag: 'wx' });
  }
  const s = await stat(absPath);
  return {
    name: basename(absPath),
    path: inside,
    type: kind === 'directory' ? 'directory' : 'file',
    size: s.isFile() ? s.size : undefined,
    modifiedAt: s.mtime.toISOString(),
    ...(kind === 'directory' ? { deferred: true, children: [] } : {}),
  };
}

export async function renameWorkspaceEntry(fromRel: string, toRel: string): Promise<{ path: string }> {
  const from = resolveWorkspacePath(fromRel, false);
  const to = resolveWorkspacePath(toRel, false);
  await assertInsideWorkspace(from.absPath);
  // to path doesn't exist yet so realpath would fail; lexical check already done above
  if (!existsSync(from.absPath)) throw Object.assign(new Error('source not found'), { code: 'ENOENT' });
  if (existsSync(to.absPath)) throw Object.assign(new Error('target already exists'), { code: 'EEXIST' });
  await mkdir(dirname(to.absPath), { recursive: true });
  await fsRename(from.absPath, to.absPath);
  return { path: to.inside };
}

export async function deleteWorkspaceEntry(relPath: string): Promise<{ path: string }> {
  const { absPath, inside } = resolveWorkspacePath(relPath, false);
  await assertInsideWorkspace(absPath);
  if (!existsSync(absPath)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
  const s = await stat(absPath);
  await rm(absPath, { recursive: s.isDirectory(), force: false });
  return { path: inside };
}
