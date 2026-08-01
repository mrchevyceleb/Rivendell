// Studio tab model. Tabs are *content* (a file, a chat, Forge, or Council), not rooms.

export type StudioTabKind = 'file' | 'chat' | 'forge' | 'council';

export type StudioTab = {
  id: string;
  kind: StudioTabKind;
  title: string;
  /** file tabs: workspace-relative path */
  path?: string;
  /** chat tabs: stable chat id (drives the server session map) */
  chatId?: string;
};

export const STUDIO_TABS_KEY = 'rivendell:studio-tabs';
export const STUDIO_ACTIVE_KEY = 'rivendell:studio-active-tab';
export const STUDIO_TREE_KEY = 'rivendell:studio-tree-collapsed';
