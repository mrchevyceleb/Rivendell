/** Client-side map of ASSISTANT-HUB fixed spaces (Notion-style sidebar roots). */

export type HubSpaceDef = {
  id: string;
  label: string;
  path: string;
  kind: 'page' | 'dir';
  blurb: string;
  emoji: string;
};

export const HUB_HOME: HubSpaceDef = {
  id: 'home',
  label: 'Home',
  path: 'home.md',
  kind: 'page',
  blurb: 'Start here',
  emoji: '✦',
};

export const HUB_SPACES: HubSpaceDef[] = [
  { id: 'inbox', label: 'Inbox', path: 'inbox', kind: 'dir', blurb: 'Unsorted landing zone', emoji: '📥' },
  { id: 'projects', label: 'Projects', path: 'projects', kind: 'dir', blurb: 'Finite outcomes', emoji: '🗂' },
  { id: 'areas', label: 'Areas', path: 'areas', kind: 'dir', blurb: 'Ongoing responsibilities', emoji: '🏛' },
  { id: 'resources', label: 'Resources', path: 'resources', kind: 'dir', blurb: 'Reference material', emoji: '📚' },
  { id: 'scratch', label: 'Scratch', path: 'scratch', kind: 'dir', blurb: 'Ephemeral agent work', emoji: '🧪' },
  { id: 'shares', label: 'Shares', path: 'Shares', kind: 'dir', blurb: 'share.stonelabs.app pages', emoji: '🔗' },
  { id: 'archive', label: 'Archive', path: 'archive', kind: 'dir', blurb: 'Cold storage', emoji: '📦' },
];

export const HUB_LEGACY: HubSpaceDef = {
  id: 'legacy',
  label: 'Legacy',
  path: 'legacy',
  kind: 'dir',
  blurb: 'Frozen pre-reorg mess (read-only)',
  emoji: '🕸',
};

export const STUDIO_SHOW_LEGACY_KEY = 'rivendell:studio-show-legacy';

export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function inboxNotePath(slug = 'note'): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'note';
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  // Local date + time so repeated "new note" clicks never collide same day.
  return `inbox/${todayStamp()}-${hh}${mm}${ss}-${clean}.md`;
}
