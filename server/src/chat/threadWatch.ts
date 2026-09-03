// Thread watch registry — which (repo, chatId) lanes have a live chat
// WebSocket bound right now, and whether that tab is VISIBLE. A reply landing
// in a thread the user is actively looking at is not "unread": the badge means
// "waiting for you", and it can't be waiting if he's watching. Backgrounded
// tabs do NOT count (they can still be unread on other devices). Written by
// the WS register (hello / watch message / close), read by unread counting.

// lane (`${repo}|${chatId}`) → watcher id (wsId) → currently visible
const lanes = new Map<string, Map<number, boolean>>();

function key(repoPath: string, chatId: string): string {
  return `${repoPath}|${chatId}`;
}

export function watchThread(repoPath: string, chatId: string, watcherId: number, visible: boolean): void {
  const k = key(repoPath, chatId);
  let watchers = lanes.get(k);
  if (!watchers) {
    watchers = new Map();
    lanes.set(k, watchers);
  }
  watchers.set(watcherId, visible);
}

export function setWatchVisible(repoPath: string, chatId: string, watcherId: number, visible: boolean): void {
  const watchers = lanes.get(key(repoPath, chatId));
  if (!watchers?.has(watcherId)) return;
  watchers.set(watcherId, visible);
}

export function unwatchThread(repoPath: string, chatId: string, watcherId: number): void {
  const k = key(repoPath, chatId);
  const watchers = lanes.get(k);
  if (!watchers) return;
  watchers.delete(watcherId);
  if (watchers.size === 0) lanes.delete(k);
}

/** True only while at least one watcher has the thread on a VISIBLE tab. */
export function isThreadWatched(repoPath: string, chatId: string): boolean {
  const watchers = lanes.get(key(repoPath, chatId));
  if (!watchers) return false;
  for (const visible of watchers.values()) if (visible) return true;
  return false;
}
