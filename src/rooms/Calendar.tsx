import { CalendarDays, Clock3, ExternalLink, Link2, MapPin, RefreshCcw, Users } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Button, Chip, EmptyState } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import type { CalendarEvent } from '../data/types';
import { useCalendarEvents } from '../hooks/useRoomData';
import { ROOM_NAMES } from '../data/roomNames';

type CalendarAccount = 'primary' | 'workspace2';
type CalendarFilter = CalendarAccount | 'all';
type CalendarAccountMeta = { label: string; email: string; sourceName: string; className: string; color: string };

type EventWithDate = {
  event: CalendarEvent;
  start: Date;
  end: Date | null;
};

const DEFAULT_ACCOUNTS: Record<CalendarAccount, CalendarAccountMeta> = {
  primary: {
    label: 'Primary',
    email: 'Primary account',
    sourceName: 'Primary calendar',
    className: 'source-primary',
    color: 'var(--r-elf-blue)',
  },
  workspace2: {
    label: 'Secondary',
    email: 'Secondary account',
    sourceName: 'Secondary calendar',
    className: 'source-ypp',
    color: 'var(--r-silver)',
  },
};

const agendaFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

const compactDayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export function Calendar() {
  const { data, refetch, isFetching, isLoading, isError, error } = useCalendarEvents();
  const [filter, setFilter] = useState<CalendarFilter>('all');
  const now = Date.now();
  const allEvents = useMemo(() => {
    return (data.events ?? [])
      .map((event): EventWithDate | null => {
        const start = eventDate(event.start);
        if (!start) return null;
        return { event, start, end: eventDate(event.end) };
      })
      .filter((item): item is EventWithDate => Boolean(item))
      .filter(({ event }) => event.status !== 'cancelled')
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [data.events]);

  const accounts = useMemo(() => {
    const next = {
      primary: { ...DEFAULT_ACCOUNTS.primary },
      workspace2: { ...DEFAULT_ACCOUNTS.workspace2 },
    };
    const seen = new Set<CalendarAccount>();
    for (const { event } of allEvents) {
      const source = sourceFor(event);
      if (seen.has(source)) continue;
      seen.add(source);
      if (event.accountLabel) next[source].label = event.accountLabel;
      if (event.account) next[source].email = event.account;
      if (event.calendarName) next[source].sourceName = event.calendarName;
      if (event.color) next[source].color = event.color;
    }
    return next;
  }, [allEvents]);

  const accountCounts = useMemo(() => {
    return allEvents.reduce(
      (counts, item) => {
        counts[sourceFor(item.event)] += 1;
        return counts;
      },
      { primary: 0, workspace2: 0 } as Record<CalendarAccount, number>,
    );
  }, [allEvents]);

  const visibleEvents = useMemo(() => {
    if (filter === 'all') return allEvents;
    return allEvents.filter((item) => sourceFor(item.event) === filter);
  }, [allEvents, filter]);

  const groupedDays = useMemo(() => groupByDay(visibleEvents), [visibleEvents]);
  const nextEvent = allEvents.find((item) => item.end?.getTime() ? item.end.getTime() >= now : item.start.getTime() >= now);
  const week = useMemo(() => buildWeekStrip(visibleEvents), [visibleEvents]);
  const filterLabel = filter === 'all' ? 'both calendars' : accounts[filter].sourceName;
  const showLoading = isLoading && allEvents.length === 0;
  const subtitle = data.truncated
    ? `Your connected calendars, merged into one color-coded agenda. Showing the first ${data.maxResults ?? allEvents.length}.`
    : 'Your connected calendars, merged into one color-coded agenda.';

  return (
    <div
      className="split-room calendar-room"
      style={{
        '--calendar-primary': accounts.primary.color,
        '--calendar-ypp': accounts.workspace2.color,
      } as CSSProperties}
    >
      <aside className="room-rail calendar-rail r-scroll">
        <p className="r-eyebrow-gold">{ROOM_NAMES.calendar.name}</p>
        <h2>Schedule</h2>

        <CalendarAccountFilters
          filter={filter}
          onFilterChange={setFilter}
          allCount={allEvents.length}
          accountCounts={accountCounts}
          accounts={accounts}
        />

        <NextEventPanel nextEvent={nextEvent} />

        <div className="calendar-legend">
          <span><i className="calendar-dot source-primary" /> {accounts.primary.label}</span>
          <span><i className="calendar-dot source-ypp" /> {accounts.workspace2.label}</span>
        </div>
      </aside>

      <section className="room-scroll r-scroll">
        <RoomHeader
          eyebrow={ROOM_NAMES.calendar.eyebrow}
          title={`${visibleEvents.length} events from ${filterLabel}`}
          subtitle={subtitle}
          actions={
            <Button tone="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCcw size={15} />
              Refresh
            </Button>
          }
        />

        <div className="calendar-mobile-tools">
          <CalendarAccountFilters
            filter={filter}
            onFilterChange={setFilter}
            allCount={allEvents.length}
            accountCounts={accountCounts}
            accounts={accounts}
          />
          <NextEventPanel nextEvent={nextEvent} />
        </div>

        <div className="calendar-board">
          <div className="calendar-week-strip" aria-label="Upcoming week">
            {week.map((day) => (
              <div key={day.key} className={day.isToday ? 'is-today' : ''}>
                <span>{day.weekday}</span>
                <strong>{day.day}</strong>
                <small>{day.count}</small>
              </div>
            ))}
          </div>

          {showLoading ? (
            <EmptyState title="Loading calendar" body="Pulling your connected calendar events." />
          ) : null}

          {isError ? (
            <EmptyState title="Calendar unreachable" body={error instanceof Error ? error.message : 'The calendar feed did not answer.'} />
          ) : null}

          {!isError && !showLoading && groupedDays.length === 0 ? (
            <EmptyState title="No events in view" body="The merged calendar feed is quiet for this window." />
          ) : null}

          <div className="calendar-agenda">
            {groupedDays.map((day) => (
              <section className="calendar-day" key={day.key}>
                <header>
                  <div>
                    <p>{relativeDayLabel(day.date)}</p>
                    <h3>{agendaFormatter.format(day.date)}</h3>
                  </div>
                  <Chip tone="neutral">{eventCountLabel(day.events.length)}</Chip>
                </header>

                <div className="calendar-event-stack">
                  {day.events.map((item) => (
                    <CalendarEventCard item={item} accounts={accounts} key={`${item.event.id}-${item.start.toISOString()}`} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CalendarAccountFilters({
  filter,
  onFilterChange,
  allCount,
  accountCounts,
  accounts,
}: {
  filter: CalendarFilter;
  onFilterChange: (filter: CalendarFilter) => void;
  allCount: number;
  accountCounts: Record<CalendarAccount, number>;
  accounts: Record<CalendarAccount, CalendarAccountMeta>;
}) {
  return (
    <div className="calendar-account-stack">
      <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilterChange('all')}>
        <span className="calendar-dot duo" />
        <span>
          <strong>All calendars</strong>
          <small>Primary + secondary</small>
        </span>
        <code>{allCount}</code>
      </button>
      {Object.entries(accounts).map(([key, account]) => (
        <button
          key={key}
          className={filter === key ? `active ${account.className}` : account.className}
          onClick={() => onFilterChange(key as CalendarAccount)}
        >
          <span className={`calendar-dot ${account.className}`} />
          <span>
            <strong>{account.sourceName}</strong>
            <small>{account.email}</small>
          </span>
          <code>{accountCounts[key as CalendarAccount]}</code>
        </button>
      ))}
    </div>
  );
}

function NextEventPanel({ nextEvent }: { nextEvent?: EventWithDate }) {
  return (
    <div className="calendar-next">
      <span className="calendar-next-icon">
        <Clock3 size={16} />
      </span>
      <div>
        <small>Next</small>
        <strong>{nextEvent ? nextEvent.event.summary || 'Untitled event' : 'Open stretch'}</strong>
        <span>{nextEvent ? `${formatCompactDay(nextEvent.start)} · ${formatTimeRange(nextEvent)}` : 'Nothing else in view'}</span>
      </div>
    </div>
  );
}

function CalendarEventCard({
  item,
  accounts,
}: {
  item: EventWithDate;
  accounts: Record<CalendarAccount, CalendarAccountMeta>;
}) {
  const { event } = item;
  const source = sourceFor(event);
  const account = accounts[source];
  const joinLink = findJoinLink(event);
  const description = htmlToText(event.description).slice(0, 220);
  const attendees = Array.isArray(event.attendees) ? event.attendees.filter((attendee) => !attendee.self).length : 0;

  return (
    <article className={`calendar-event ${account.className}`}>
      <div className="calendar-event-time">
        <strong>{formatTimeRange(item)}</strong>
        <span>{account.label}</span>
      </div>
      <div className="calendar-event-body">
        <div className="calendar-event-title">
          <span className={`calendar-dot ${account.className}`} />
          <h4>{event.summary || 'Untitled event'}</h4>
        </div>
        <div className="calendar-event-meta">
          <span>
            <CalendarDays size={13} />
            {account.sourceName}
          </span>
          {event.location ? (
            <span>
              <MapPin size={13} />
              {shortenLocation(event.location)}
            </span>
          ) : null}
          {attendees > 0 ? (
            <span>
              <Users size={13} />
              {attendeeLabel(attendees)}
            </span>
          ) : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="calendar-event-actions">
        {joinLink ? (
          <Button tone="elf" onClick={() => window.open(joinLink, '_blank', 'noopener,noreferrer')} title="Open meeting link">
            <Link2 size={14} />
            Join
          </Button>
        ) : null}
        {event.htmlLink ? (
          <Button tone="ghost" onClick={() => window.open(event.htmlLink, '_blank', 'noopener,noreferrer')} title="Open in Google Calendar">
            <ExternalLink size={14} />
            Open
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function sourceFor(event: CalendarEvent): CalendarAccount {
  if (event.source === 'workspace2') return 'workspace2';
  if (event.source === 'secondary') return 'workspace2';
  return 'primary';
}

function eventDate(value: CalendarEvent['start']): Date | null {
  if (!value) return null;
  if (value.dateTime) {
    const date = new Date(value.dateTime);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value.date) {
    const parts = value.date.split('-').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return null;
}

function groupByDay(events: EventWithDate[]) {
  const map = new Map<string, { key: string; date: Date; events: EventWithDate[] }>();
  events.forEach((item) => {
    const key = localDateKey(item.start);
    const existing = map.get(key);
    if (existing) {
      existing.events.push(item);
      return;
    }
    map.set(key, { key, date: startOfDay(item.start), events: [item] });
  });
  return Array.from(map.values());
}

function buildWeekStrip(events: EventWithDate[]) {
  const today = startOfDay(new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date),
      day: new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(date),
      count: events.filter((item) => localDateKey(item.start) === key).length,
      isToday: index === 0,
    };
  });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function relativeDayLabel(date: Date) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(date).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7 && diff > 1) return 'This week';
  return compactDayFormatter.format(date);
}

function formatCompactDay(date: Date) {
  return compactDayFormatter.format(date);
}

function formatTimeRange(item: EventWithDate) {
  if (isAllDay(item)) return 'All day';
  const start = timeFormatter.format(item.start);
  if (!item.end) return start;
  return `${start} - ${timeFormatter.format(item.end)}`;
}

function isAllDay(item: EventWithDate) {
  if (item.event.start?.date) return true;
  if (!item.end) return false;
  const startsAtMidnight = item.start.getHours() === 0 && item.start.getMinutes() === 0;
  const endsLate = item.end.getHours() === 23 && item.end.getMinutes() >= 55;
  const endsAtMidnight = item.end.getHours() === 0 && item.end.getMinutes() === 0;
  const durationMs = item.end.getTime() - item.start.getTime();
  return startsAtMidnight && (
    (endsLate && localDateKey(item.start) === localDateKey(item.end))
    || (endsAtMidnight && durationMs >= 82_800_000)
  );
}

function eventCountLabel(count: number) {
  return count === 1 ? '1 event' : `${count} events`;
}

function attendeeLabel(count: number) {
  return count === 1 ? '1 guest' : `${count} guests`;
}

function htmlToText(value?: string) {
  if (!value) return '';
  const spaced = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(a|p|div|li|td|th|tr)>/gi, ' </$1>');
  if (typeof DOMParser === 'undefined') return spaced.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function findJoinLink(event: CalendarEvent) {
  if (event.hangoutLink && isMeetingUrl(event.hangoutLink)) return event.hangoutLink;
  const conferenceLink = event.conferenceData?.entryPoints
    ?.filter((entry) => entry.entryPointType === 'video')
    .map((entry) => entry.uri)
    .find((uri): uri is string => Boolean(uri && isMeetingUrl(uri)));
  if (conferenceLink) return conferenceLink;
  const haystack = [event.location, event.description].filter(Boolean).join('\n');
  const urls = haystack.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return urls.map(cleanUrl).find(isMeetingUrl);
}

function cleanUrl(url: string) {
  return url.replace(/[).,]+$/, '');
}

function isMeetingUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    if (host === 'meet.google.com') return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(path);
    if (host === 'teams.microsoft.com') return path.includes('/l/meetup-join/');
    if (host.endsWith('zoom.us')) return path.startsWith('/j/') || path.startsWith('/my/') || path.includes('/wc/');
    if (host.endsWith('webex.com')) return path.includes('/meet/') || path.includes('/join/');
    if (host === 'whereby.com') return path.length > 1;
    if (host === 'upwork.com') return path.includes('/messages/rooms/');
    return false;
  } catch {
    return false;
  }
}

function shortenLocation(location: string) {
  const link = location.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (!link) return location;
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}
