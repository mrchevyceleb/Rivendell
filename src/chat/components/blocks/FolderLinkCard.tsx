import { FolderOpen, Library as LibraryIcon } from 'lucide-react';
import { buildLinkUrls, openWorkspaceLink } from '../../utils/proxyLinks';

// Click opens the folder in Windows Explorer via the rivendell:// handler.
// Secondary button drops the user into Rivendell's own Library room scoped
// to the same path — useful from non-Windows devices (phone over Tailscale).
export function FolderLinkCard({ path, title }: { path: string; title?: string }) {
  const display = title || (path === '' ? 'ASSISTANT-HUB' : path.split('/').pop() || path);
  const { windowsPath } = buildLinkUrls(path, 'folder');
  const libraryUrl = `/library?path=${encodeURIComponent(path)}`;

  const openLibrary = () => {
    window.history.pushState({}, '', libraryUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <span className="chat-link-card-row">
      <button
        type="button"
        className="chat-link-card"
        onClick={() => openWorkspaceLink(path, 'folder')}
        title={`Open ${display} in File Explorer (${windowsPath})`}
      >
        <FolderOpen size={16} />
        <span className="chat-link-card-text">
          <span className="chat-link-card-title">{display}</span>
          <span className="chat-link-card-sub">{path || 'workspace root'}</span>
        </span>
      </button>
      <span className="chat-link-card-actions">
        <button
          type="button"
          className="chat-link-card-action"
          onClick={(e) => {
            e.stopPropagation();
            openLibrary();
          }}
          title="Open in Rivendell Library"
        >
          <LibraryIcon size={13} />
        </button>
      </span>
    </span>
  );
}
