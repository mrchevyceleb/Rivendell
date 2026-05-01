import { RadioTower, RefreshCcw } from 'lucide-react';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { useScribeEvents } from '../hooks/useRoomData';
import { useScribeSocket } from '../hooks/useScribeSocket';
import { timeAgo } from '../utils/format';

export function Scribe() {
  const { data: initial = [], refetch } = useScribeEvents();
  const { events, state } = useScribeSocket(initial);
  const rows = events.length ? events : initial;

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Scribe"
        title="Every act, recorded"
        subtitle="Live worker activity, tool calls, notes, and errors."
        actions={
          <>
            <Chip tone={state === 'open' ? 'emerald' : state === 'connecting' ? 'gold' : 'neutral'}>{state}</Chip>
            <Button tone="ghost" onClick={() => refetch()}>
              <RefreshCcw size={15} />
              Refresh
            </Button>
          </>
        }
      />
      <section className="scribe-terminal">
        <div className="terminal-head">
          <RadioTower size={15} />
          <span>streaming from localhost:8091/ws/scribe</span>
        </div>
        <div className="log-list">
          {rows.slice(-120).map((event) => (
            <div key={event.id}>
              <code>{timeAgo(event.ts)}</code>
              <Chip tone={event.level === 'error' ? 'rose' : event.level === 'tool' ? 'elf' : event.level === 'note' ? 'gold' : 'neutral'}>
                {event.level}
              </Chip>
              <span>{event.text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
