import chokidar from 'chokidar';
import { readdir } from 'node:fs/promises';
import { relative } from 'node:path';
import { ELROND_WORKSPACE_PATH } from '../config.ts';
import { workspaceRoot } from './workspace.ts';
import { isHubRootPollution } from './hubPaths.ts';
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

function toPosixRel(root: string, absPath: string): string {
  return relative(root, absPath).split('\\').join('/');
}

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
    const rel = toPosixRel(root, absPath);
    if (!rel || rel.startsWith('..')) return;
    void emitScribe({
      level: 'system',
      text: `Workspace: ${op} ${rel}`,
      payload: { kind: 'workspace-change', op, path: rel, by: 'fs' },
    });
    // Root pollution canary: something landed outside the closed hub schema.
    if ((op === 'add' || op === 'addDir') && isHubRootPollution(rel)) {
      void emitScribe({
        level: 'note',
        text: `Hub root pollution: ${rel} (move into inbox/projects/areas/resources/scratch or delete)`,
        payload: { kind: 'hub-root-pollution', op, path: rel, by: 'fs' },
      });
    }
  };

  watcher
    .on('add', handle('add'))
    .on('change', handle('change'))
    .on('unlink', handle('unlink'))
    .on('addDir', handle('addDir'))
    .on('unlinkDir', handle('unlinkDir'))
    .on('error', (err) => console.error('[workspace-watcher] error:', err));

  // One-shot root scan so pollution that appeared while Rivendell was down is noted.
  void readdir(root, { withFileTypes: true })
    .then((entries) => {
      for (const entry of entries) {
        if (!isHubRootPollution(entry.name)) continue;
        void emitScribe({
          level: 'note',
          text: `Hub root pollution (startup): ${entry.name}`,
          payload: { kind: 'hub-root-pollution', op: entry.isDirectory() ? 'addDir' : 'add', path: entry.name, by: 'fs' },
        });
      }
    })
    .catch((err) => console.error('[workspace-watcher] startup scan failed:', err));

  console.log(`[workspace-watcher] watching ${ELROND_WORKSPACE_PATH}`);
}

export function stopWorkspaceWatcher(): void {
  void watcher?.close();
  watcher = null;
}
