import { Eye, ExternalLink, FileText } from 'lucide-react';
import { useProxyViewer } from '../../../hooks/useProxyViewer';
import { useStudioFiles, viewerPreferred } from '../../../shell/studio/studioFiles';
import { buildLinkUrls, normalizeWorkspacePath, openWorkspaceLink } from '../../utils/proxyLinks';

// Click = open the document inside Rivendell: text/code/markdown lands in the
// editor, browser-renderable files render in the in-app overlay. The two side
// buttons cover the alternates: Browser opens the file via Tailscale-served HTTP
// (any device), Preview forces the in-app overlay. Outside the Studio shell it
// falls back to the native rivendell:// handler.
export function DocLinkCard({ path, title }: { path: string; title?: string }) {
  const viewer = useProxyViewer();
  const studio = useStudioFiles();
  const normalizedPath = normalizeWorkspacePath(path);
  const safePath = normalizedPath ?? path;
  const { browserUrl, windowsPath } = buildLinkUrls(safePath, 'doc');
  const display = title || safePath.split('/').pop() || safePath;

  const openPrimary = () => {
    if (normalizedPath === null) return;
    if (studio) {
      if (viewerPreferred(normalizedPath)) { viewer.open({ source: 'doc', path: normalizedPath, title }); return; }
      studio.openFile(normalizedPath, title);
      return;
    }
    openWorkspaceLink(normalizedPath, 'doc');
  };

  return (
    <span className="chat-link-card-row">
      <button
        type="button"
        className="chat-link-card"
        onClick={openPrimary}
        title={studio ? `Open ${display} in Rivendell` : `Open ${display} natively (${windowsPath})`}
      >
        <FileText size={16} />
        <span className="chat-link-card-text">
          <span className="chat-link-card-title">{display}</span>
          <span className="chat-link-card-sub">{path}</span>
        </span>
      </button>
      <span className="chat-link-card-actions">
        <a
          className="chat-link-card-action"
          href={browserUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in browser tab"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={13} />
        </a>
        <button
          type="button"
          className="chat-link-card-action"
          onClick={(e) => {
            e.stopPropagation();
            if (normalizedPath !== null) viewer.open({ source: 'doc', path: normalizedPath, title });
          }}
          title="Preview in Rivendell"
        >
          <Eye size={13} />
        </button>
      </span>
    </span>
  );
}
