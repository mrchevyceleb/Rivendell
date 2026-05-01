import { FileCode2, FileText, FileType } from 'lucide-react';
import { useProxyViewer } from '../../../hooks/useProxyViewer';

const ICONS = {
  html: FileCode2,
  markdown: FileText,
  text: FileType,
} as const;

export function ArtifactCard({
  artifactId,
  artifactKind,
  title,
}: {
  artifactId: string;
  artifactKind: 'html' | 'markdown' | 'text';
  title: string;
}) {
  const viewer = useProxyViewer();
  const Icon = ICONS[artifactKind];

  return (
    <button
      type="button"
      className="chat-link-card"
      onClick={() => viewer.open({ source: 'artifact', id: artifactId, title })}
      title={`Preview ${title} in the in-app viewer`}
    >
      <Icon size={16} />
      <span className="chat-link-card-text">
        <span className="chat-link-card-title">{title}</span>
        <span className="chat-link-card-sub">{artifactKind} draft</span>
      </span>
    </button>
  );
}
