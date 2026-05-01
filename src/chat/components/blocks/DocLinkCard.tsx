import { FileText } from 'lucide-react';
import { useProxyViewer } from '../../../hooks/useProxyViewer';

export function DocLinkCard({ path, title }: { path: string; title?: string }) {
  const viewer = useProxyViewer();
  const display = title || path.split('/').pop() || path;

  return (
    <button
      type="button"
      className="chat-link-card"
      onClick={() => viewer.open({ source: 'doc', path, title })}
      title={`Open ${display} in the in-app viewer`}
    >
      <FileText size={16} />
      <span className="chat-link-card-text">
        <span className="chat-link-card-title">{display}</span>
        <span className="chat-link-card-sub">{path}</span>
      </span>
    </button>
  );
}
