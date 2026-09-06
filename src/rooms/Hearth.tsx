import { CalendarPlus, WalletCards } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import { Button, Chip, Surface } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { useFamily } from '../hooks/useRoomData';
import { ROOM_NAMES } from '../data/roomNames';

const areaTone = {
  todo: 'gold',
  bill: 'rose',
  debt: 'rose',
  budget: 'elf',
  meal: 'emerald',
} as const;

export function Hearth() {
  const { data: items = [] } = useFamily();
  const queryClient = useQueryClient();

  const toggle = async (id: string, completed: boolean) => {
    await apiJson(`/api/family/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    });
    await queryClient.invalidateQueries({ queryKey: ['family'] });
  };

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow={ROOM_NAMES.hearth.eyebrow}
        title="Family and home"
        subtitle="Todos, bills, debts, budget notes, and meal plans."
        actions={
          <>
            <Button tone="ghost" onClick={() => window.location.assign('/?prompt=Add%20a%20bill%20to%20the%20Hearth%20and%20ask%20me%20for%20amount%2C%20due%20date%2C%20and%20owner.')}>
              <WalletCards size={15} />
              Add bill
            </Button>
            <Button tone="gold" onClick={() => window.location.assign('/?prompt=Create%20a%20family%20task%20and%20ask%20me%20for%20missing%20details.')}>
              <CalendarPlus size={15} />
              Add family task
            </Button>
          </>
        }
      />
      <div className="two-col">
        <section>
          <h2 className="section-title">Today’s keep</h2>
          <div className="stack-list">
            {items.map((item) => (
              <article className="family-row" key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Complete ${item.title}`}
                  checked={Boolean(item.completed)}
                  disabled={item.area !== 'todo'}
                  onChange={(event) => void toggle(item.id, event.target.checked)}
                />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.owner} · {item.due}
                  </small>
                </div>
                {item.amount ? <code>{item.amount}</code> : null}
                <Chip tone={areaTone[item.area]}>{item.area}</Chip>
              </article>
            ))}
          </div>
        </section>
        <Surface>
          <p className="r-eyebrow-gold">Hearthstone</p>
          <h2>Weekly family rhythm</h2>
          <div className="simple-schedule">
            <span>Mon</span>
            <strong>Library day and book bag</strong>
            <span>Tue</span>
            <strong>Soccer pickup at 5:30 PM</strong>
            <span>Wed</span>
            <strong>Spelling test</strong>
            <span>Fri</span>
            <strong>Pizza day cash</strong>
          </div>
        </Surface>
      </div>
    </div>
  );
}
