import { createContext, useContext } from 'react';

// Bridges deep components (chat markdown, link cards) up to the Studio shell so
// a clicked workspace link opens *inside* Rivendell: a text / code / markdown
// file lands in the editor as a tab, a folder is revealed in the file tree.
// Null when rendered outside the Studio shell — callers then fall back to
// opening the file out-of-app (native handler / browser tab).
export type StudioFileActions = {
  openFile: (path: string, name?: string) => void;
  revealFolder: (path: string) => void;
};

export const StudioFilesContext = createContext<StudioFileActions | null>(null);

export function useStudioFiles(): StudioFileActions | null {
  return useContext(StudioFilesContext);
}

// Extensions better shown rendered (in the ProxyViewer overlay) than as source
// in the code editor: web pages, documents, images, and media. Everything else
// — markdown, code, config, plain text, data files — opens in the editor, which
// degrades gracefully to an "open in browser" affordance for anything binary.
const VIEWER_EXTS = new Set([
  'html', 'htm', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'ogg',
]);

export function viewerPreferred(path: string): boolean {
  const leaf = path.split('/').pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot < 0) return false;
  return VIEWER_EXTS.has(leaf.slice(dot + 1).toLowerCase());
}
