import { useMemo } from 'react';
import { Download, Plus } from 'lucide-react';
import { Button, Chip, Surface } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { usePlEntries } from '../hooks/useRoomData';
import type { PlEntry } from '../data/types';
import { formatMoney } from '../utils/format';

type PeriodStats = {
  label: string;
  rangeLabel: string;
  income: number;
  expense: number;
  net: number;
  margin: number | null;
  count: number;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function summarize(entries: PlEntry[], year: number, month: number, label: string): PeriodStats {
  const filtered = entries.filter((entry) => {
    const [y, m] = entry.date.split('-').map(Number);
    return y === year && m === month + 1;
  });
  const income = filtered.filter((e) => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const expense = filtered.filter((e) => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const net = income - expense;
  const margin = income > 0 ? (net / income) * 100 : null;
  return {
    label,
    rangeLabel: `${MONTHS[month]} ${year}`,
    income,
    expense,
    net,
    margin,
    count: filtered.length,
  };
}

function formatMargin(margin: number | null): string {
  if (margin === null) return '—';
  return `${margin.toFixed(1)}%`;
}

export function Reckoning() {
  const { data: entries = [] } = usePlEntries();

  const { mtd, lastMonth, recent } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastYear = month === 0 ? year - 1 : year;
    const lastMonthIdx = month === 0 ? 11 : month - 1;

    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      mtd: summarize(entries, year, month, 'Month to date'),
      lastMonth: summarize(entries, lastYear, lastMonthIdx, 'Last month'),
      recent: sorted.slice(0, 20),
    };
  }, [entries]);

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Reckoning"
        title="P&L tracker"
        subtitle="A thin view over the existing plTracker tools."
        actions={
          <>
            <Button tone="ghost" onClick={() => window.open('/api/pl/export.csv', '_blank')}>
              <Download size={15} />
              Export
            </Button>
            <Button
              tone="gold"
              onClick={() =>
                window.location.assign(
                  '/?prompt=Add%20a%20P%26L%20entry%20to%20the%20Reckoning%20and%20ask%20me%20for%20date%2C%20type%2C%20amount%2C%20and%20category.',
                )
              }
            >
              <Plus size={15} />
              Add entry
            </Button>
          </>
        }
      />
      <div className="finance-layout">
        <div className="period-stack">
          <PeriodCard stats={mtd} />
          <PeriodCard stats={lastMonth} />
        </div>
        <Surface>
          <div className="recent-header">
            <h2>Recent entries</h2>
            <span className="recent-count">Last {recent.length} of {entries.length}</span>
          </div>
          <div className="table-list">
            {recent.map((entry) => (
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
            {recent.length === 0 && (
              <div className="recent-empty">No entries yet.</div>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}

function PeriodCard({ stats }: { stats: PeriodStats }) {
  return (
    <section className="period-card">
      <header>
        <span className="period-label">{stats.label}</span>
        <span className="period-range">{stats.rangeLabel}</span>
      </header>
      <dl>
        <div>
          <dt>Revenue</dt>
          <dd className="period-emerald">{formatMoney(stats.income)}</dd>
        </div>
        <div>
          <dt>Expenses</dt>
          <dd className="period-rose">{formatMoney(stats.expense)}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className="period-gold">{formatMoney(stats.net)}</dd>
        </div>
        <div>
          <dt>Profit margin</dt>
          <dd className="period-gold">{formatMargin(stats.margin)}</dd>
        </div>
      </dl>
      <footer>{stats.count} {stats.count === 1 ? 'entry' : 'entries'}</footer>
    </section>
  );
}
