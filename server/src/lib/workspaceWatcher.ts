import chokidar from 'chokidar';
import { relative } from 'node:path';
import { ELROND_WORKSPACE_PATH } from '../config.ts';
import { workspaceRoot } from './workspace.ts';
import { emitScribe } from '../worker/scribe.ts';

const IGNORED = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/*.swp',
  '**/*.swx',
  '**/*~',
  '**/.DS_Store',
];

type WatcherOp = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

let watcher: ReturnType<typeof chokidar.watch> | null = null;

export function startWorkspaceWatcher(): void {
  const enabled = process.env.RIVENDELL_FS_WATCH !== 'false';
  if (!enabled) {
    console.log('[workspace-watcher] disabled (RIVENDELL_FS_WATCH=false)');
    return;
  }
  const root = workspaceRoot();
  watcher = chokidar.watch(root, {
    ignored: IGNORED,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const handle = (op: WatcherOp) => (absPath: string) => {
    const rel = relative(root, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return;
    void emitScribe({
      level: 'system',
      text: `Workspace: ${op} ${rel}`,
      payload: { kind: 'workspace-change', op, path: rel, by: 'fs' },
    });
  };

  watcher
    .on('add', handle('add'))
    .on('change', handle('change'))
    .on('unlink', handle('unlink'))
    .on('addDir', handle('addDir'))
    .on('unlinkDir', handle('unlinkDir'))
    .on('error', (err) => console.error('[workspace-watcher] error:', err));

  console.log(`[workspace-watcher] watching ${ELROND_WORKSPACE_PATH}`);
}

export function stopWorkspaceWatcher(): void {
  void watcher?.close();
  watcher = null;
}
