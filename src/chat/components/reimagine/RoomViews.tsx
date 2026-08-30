// Compact shared views for the reimagined chat shells: the chronicle ribbon
// ticker and the chronicle event rows. Both pull from the shared useChronicle
// cache so the ribbon, the mobile Chronicle sheet, and anything else reading
// the same events stay in sync. (The embedded Council board, Forge jobs list,
// and sidebar hubs strip were removed with the desktop sidebar and the mobile
// room tabs — the real Council / Forge Studio tabs are the one true views.)

import type { ChronicleEvent } from '../../data/mock';

// ── chronicle ribbon (marquee ticker) ──────────────────────────────────────
export function RibbonTicker({ events }: { events: ChronicleEvent[] }) {
  if (!events.length) return null;
  const row = (e: ChronicleEvent, k: string) => (
    <span key={k}>
      {e.t} · {e.title} · {e.repo} · {e.status ?? ''}
    </span>
  );
  const sep = (k: string) => (
    <span key={k} className="gl">
      ✦
    </span>
  );
  // Two distinct copies (unique keys each) so the marquee loops seamlessly.
  const a: import('react').ReactNode[] = [];
  const b: import('react').ReactNode[] = [];
  events.forEach((e, i) => {
    a.push(row(e, `a${i}`), sep(`as${i}`));
    b.push(row(e, `b${i}`), sep(`bs${i}`));
  });
  return (
    <div className="ribbon">
      <div className="ribbon-track">
        {a}
        {b}
      </div>
    </div>
  );
}

// ── chronicle event rows (mobile sheet) ────────────────────────────────────
export function ChronicleRows({
  events,
  onPick,
}: {
  events: ChronicleEvent[];
  onPick?: (e: ChronicleEvent) => void;
}) {
  if (!events.length) {
    return <div className="evt ink" style={{ gridTemplateColumns: '14px 1fr' }}><span className="dot" /><span className="t" style={{ color: 'var(--faint)' }}>the book is quiet</span></div>;
  }
  return (
    <>
      {events.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`evt ${e.kind}`}
          onClick={() => onPick?.(e)}
        >
          <span className="dot" />
          <span className="t">{e.title}</span>
          <span className="when">{e.t}</span>
          <span className="s">
            {e.repo} · {e.status ?? ''}
          </span>
        </button>
      ))}
    </>
  );
}
