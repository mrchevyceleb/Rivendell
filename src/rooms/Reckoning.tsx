import { Download, Plus } from 'lucide-react';
import { Button, Chip, Metric, Surface } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { usePlEntries } from '../hooks/useRoomData';
import { formatMoney } from '../utils/format';

export function Reckoning() {
  const { data: entries = [] } = usePlEntries();
  const income = entries.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0);
  const expense = entries.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Reckoning"
        title="P&L tracker"
        subtitle="A thin view over the existing plTracker tools."
        actions={
          <>
            <Button tone="ghost">
              <Download size={15} />
              Export
            </Button>
            <Button tone="gold">
              <Plus size={15} />
              Add entry
            </Button>
          </>
        }
      />
      <div className="finance-layout">
        <div className="metric-grid">
          <Metric label="Income" value={formatMoney(income)} tone="emerald" />
          <Metric label="Expenses" value={formatMoney(expense)} tone="rose" />
          <Metric label="Net" value={formatMoney(income - expense)} tone="gold" />
        </div>
        <Surface>
          <h2>Recent entries</h2>
          <div className="table-list">
            {entries.map((entry) => (
              <div key={entry.id}>
                <div>
                  <strong>{entry.label}</strong>
                  <small>
                    {entry.account} · {entry.date}
                  </small>
                </div>
                <Chip tone={entry.type === 'income' ? 'emerald' : 'rose'}>{entry.type}</Chip>
                <code>{formatMoney(entry.amount)}</code>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
