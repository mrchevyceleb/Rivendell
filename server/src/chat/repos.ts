import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import {
  ASSISTANT_HUB_PATH,
  REPO_SCAN_PATHS,
  REPO_SCAN_HUB_PATHS,
  IGNORED_HUB_NAMES,
} from './config.ts';

export type DiscoveredRepo = {
  path: string;
  name: string;
  branch?: string;
  hub: string; // "Work", "Side projects", "The Hub", etc.
  pinned?: boolean;
  isAssistantHub?: boolean;
};

/** Current branch, read straight off disk instead of shelling out.
 *  `git symbolic-ref` costs a process spawn per repo, and discoverRepos runs for
 *  /api/repos, for the sidebar's polled /api/chat/history, and for the
 *  chronicle. On a box with many checkouts and worktrees that was hundreds of
 *  `git` spawns per poll: process creation alone took ~80% of the event loop,
 *  which is what made unrelated requests (including the JS bundle) take tens of
 *  seconds. `.git/HEAD` holds the same answer in a few bytes.
 *  Returns undefined on a detached HEAD, matching symbolic-ref's failure. */
async function gitBranch(path: string): Promise<string | undefined> {
  try {
    let gitDir = join(path, '.git');
    const st = await stat(gitDir);
    if (st.isFile()) {
      // Linked worktree: `.git` is a pointer file (`gitdir: <real git dir>`).
      // Git resolves a RELATIVE target against the directory holding the
      // pointer, not the process cwd.
      const pointer = await readFile(gitDir, 'utf8');
      const target = /^gitdir:\s*(.+)$/m.exec(pointer);
      if (!target) return undefined;
      gitDir = resolve(path, target[1].trim());
    }
    const head = await readFile(join(gitDir, 'HEAD'), 'utf8');
    const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(head);
    return ref ? ref[1].trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

async function scanParent(parent: string, hub: string): Promise<DiscoveredRepo[]> {
  if (!existsSync(parent)) return [];
  const entries = await readdir(parent, { withFileTypes: true });
  const out: DiscoveredRepo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const path = join(parent, e.name);
    const gitDir = join(path, '.git');
    if (!existsSync(gitDir)) continue;
    const branch = await gitBranch(path);
    out.push({ path, name: e.name, branch, hub });
  }
  return out;
}

// The walk touches several parent directories and every repo under them. It is
// requested by /api/repos, by the polled /api/chat/history, and by the
// chronicle, so uncached it re-ran several times a minute for every connected
// client. On-disk layout does not change that fast; serve a short-lived
// snapshot and let concurrent callers share one walk.
const DISCOVERY_TTL_MS = 30_000;
let discoveryCache: { at: number; repos: DiscoveredRepo[] } | null = null;
let discoveryInFlight: Promise<DiscoveredRepo[]> | null = null;

export async function discoverRepos(): Promise<DiscoveredRepo[]> {
  const cached = discoveryCache;
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.repos.slice();
  if (discoveryInFlight) return discoveryInFlight;
  discoveryInFlight = scanAllRepos()
    .then((repos) => {
      discoveryCache = { at: Date.now(), repos };
      return repos.slice();
    })
    .finally(() => {
      discoveryInFlight = null;
    });
  return discoveryInFlight;
}

async function scanAllRepos(): Promise<DiscoveredRepo[]> {
  const all: DiscoveredRepo[] = [];

  // Always include the Assistant Hub first (special, pinned).
  if (existsSync(ASSISTANT_HUB_PATH)) {
    const branch = await gitBranch(ASSISTANT_HUB_PATH);
    all.push({
      path: ASSISTANT_HUB_PATH,
      name: 'ASSISTANT-HUB',
      branch,
      hub: 'The Hub',
      pinned: true,
      isAssistantHub: true,
    });
  }

  for (const parent of REPO_SCAN_PATHS) {
    const hubName = basename(parent);
    const repos = await scanParent(parent, hubName);
    all.push(...repos);
  }

  // Two-level walk: each entry contains hub folders, each hub contains repos.
  for (const root of REPO_SCAN_HUB_PATHS) {
    if (!existsSync(root)) continue;
    const hubs = await readdir(root, { withFileTypes: true });
    for (const h of hubs) {
      if (!h.isDirectory()) continue;
      if (IGNORED_HUB_NAMES.has(h.name)) continue;
      const repos = await scanParent(join(root, h.name), h.name);
      all.push(...repos);
    }
  }

  // Stat for mtime to roughly sort by recent activity.
  const withMtime = await Promise.all(
    all.map(async (r) => {
      try {
        const s = await stat(r.path);
        return { r, mtime: s.mtimeMs };
      } catch {
        return { r, mtime: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);

  return withMtime.map((x) => x.r);
}
