import { RefreshCcw } from 'lucide-react';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { useAnnals } from '../hooks/useRoomData';
import { timeAgo } from '../utils/format';

export function Annals() {
  const { data: entries = [], refetch } = useAnnals();

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Annals"
        title="Past sessions"
        subtitle="Claude and Codex chronicle entries from recent local work."
        actions={
          <Button tone="ghost" onClick={() => refetch()}>
            <RefreshCcw size={15} />
            Refresh
          </Button>
        }
      />
      <div className="annals-list">
        {entries.map((entry) => (
          <article className="annal-row" key={entry.id}>
            <div className="roman">{entry.repoName.slice(0, 1)}</div>
            <div>
              <strong>{entry.title}</strong>
              <small>{entry.cwd}</small>
            </div>
            <Chip tone={entry.busy ? 'elf' : entry.running ? 'emerald' : 'neutral'}>
              {entry.busy ? 'busy' : entry.running ? 'running' : 'closed'}
            </Chip>
            <code>{timeAgo(entry.ts)}</code>
          </article>
        ))}
      </div>
    </div>
  );
}
