import { Eye, ExternalLink, FileText } from 'lucide-react';
import { useProxyViewer } from '../../../hooks/useProxyViewer';
import { buildLinkUrls, openWorkspaceLink } from '../../utils/proxyLinks';

// Click = open the file in its native Windows app via the rivendell:// scheme
// (one-time PowerShell installer required per Windows PC). The two side
// buttons cover the cases where native isn't what you want: Browser opens the
// file via Tailscale-served HTTP (any device, no installer needed), Preview
// opens the in-app viewer Rivendell already has.
export function DocLinkCard({ path, title }: { path: string; title?: string }) {
  const viewer = useProxyViewer();
  const { browserUrl, windowsPath } = buildLinkUrls(path, 'doc');
  const display = title || path.split('/').pop() || path;

  return (
    <span className="chat-link-card-row">
      <button
        type="button"
        className="chat-link-card"
        onClick={() => openWorkspaceLink(path, 'doc')}
        title={`Open ${display} natively (${windowsPath})`}
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
            viewer.open({ source: 'doc', path, title });
          }}
          title="Preview in Rivendell"
        >
          <Eye size={13} />
        </button>
      </span>
    </span>
  );
}
