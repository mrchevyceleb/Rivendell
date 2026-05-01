import { FolderOpen } from 'lucide-react';

export function FolderLinkCard({ path, title }: { path: string; title?: string }) {
  const display = title || (path === '' ? 'ASSISTANT-HUB' : path.split('/').pop() || path);
  const targetUrl = `/library?path=${encodeURIComponent(path)}`;

  const navigate = () => {
    window.history.pushState({}, '', targetUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <button
      type="button"
      className="chat-link-card"
      onClick={navigate}
      title={`Open ${display} in the Library`}
    >
      <FolderOpen size={16} />
      <span className="chat-link-card-text">
        <span className="chat-link-card-title">{display}</span>
        <span className="chat-link-card-sub">{path || 'workspace root'}</span>
      </span>
    </button>
  );
}
