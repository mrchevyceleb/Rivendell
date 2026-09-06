// The desktop shell (desktop/) exposes a small bridge on window.tardisShell.
// The console never needs it: everything here has a browser fallback.

export type WorkspaceLinkKind = 'doc' | 'folder';

export type NativeOpenResult = { ok: boolean; where?: 'local' | 'fetched'; error?: string };

export interface TardisShellBridge {
  native: true;
  platform: string;
  version: string;
  /** Local copy of the workspace on this machine, when the shell knows one. */
  workspaceRoot?: string;
  /** Open a workspace path with the machine's own apps (fetching a copy from
   *  the ship when the file is not synced locally). */
  openWorkspacePath?: (relPath: string, kind: WorkspaceLinkKind) => Promise<NativeOpenResult>;
}

export function nativeShell(): TardisShellBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { tardisShell?: TardisShellBridge }).tardisShell;
  return bridge?.native ? bridge : null;
}

/** DOM event carrying a short notice for the shell to show as a toast. */
export const TOAST_EVENT = 'rivendell:toast';

export function showToast(text: string): void {
  window.dispatchEvent(new CustomEvent<{ text: string }>(TOAST_EVENT, { detail: { text } }));
}

/** DOM event asking the open composer to append text to its draft. */
export const DRAFT_APPEND_EVENT = 'rivendell:draft-append';

export function appendToDraft(text: string): void {
  window.dispatchEvent(new CustomEvent<{ text: string }>(DRAFT_APPEND_EVENT, { detail: { text } }));
}
