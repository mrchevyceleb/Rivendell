import { FolderOpen, FolderTree } from 'lucide-react';
import { useStudioFiles } from '../../../shell/studio/studioFiles';
import { buildLinkUrls, normalizeWorkspacePath, openWorkspaceLink } from '../../utils/proxyLinks';

// Click reveals the folder in Rivendell's own file tree. The side button does
// the same explicitly. Outside the Studio shell it falls back to opening the
// folder in Windows Explorer via the rivendell:// handler.
export function FolderLinkCard({ path, title }: { path: string; title?: string }) {
  const studio = useStudioFiles();
  const normalizedPath = normalizeWorkspacePath(path);
  const safePath = normalizedPath ?? path;
  const display = title || (safePath === '' ? 'ASSISTANT-HUB' : safePath.split('/').pop() || safePath);
  const { windowsPath } = buildLinkUrls(safePath, 'folder');

  const openPrimary = () => {
    if (normalizedPath === null) return;
    if (studio) { studio.revealFolder(normalizedPath); return; }
    openWorkspaceLink(normalizedPath, 'folder');
  };

  return (
    <span className="chat-link-card-row">
      <button
        type="button"
        className="chat-link-card"
        onClick={openPrimary}
        title={studio ? `Reveal ${display} in the file tree` : `Open ${display} in File Explorer (${windowsPath})`}
      >
        <FolderOpen size={16} />
        <span className="chat-link-card-text">
          <span className="chat-link-card-title">{display}</span>
          <span className="chat-link-card-sub">{safePath || 'workspace root'}</span>
        </span>
      </button>
      <span className="chat-link-card-actions">
        <button
          type="button"
          className="chat-link-card-action"
          onClick={(e) => {
            e.stopPropagation();
            if (normalizedPath === null) return;
            if (studio) studio.revealFolder(normalizedPath);
            else openWorkspaceLink(normalizedPath, 'folder');
          }}
          title={studio ? 'Reveal in file tree' : `Open ${display} in File Explorer (${windowsPath})`}
        >
          <FolderTree size={13} />
        </button>
      </span>
    </span>
  );
}
