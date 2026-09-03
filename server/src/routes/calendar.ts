import { Router } from 'express';
import { callMcp } from '../lib/mcp.ts';
import { asyncHandler } from './helpers.ts';

export const calendarRouter = Router();

type CalendarSource = 'primary' | 'workspace2' | string;

type CalendarEventDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  calendarId?: string;
  calendarName?: string;
  account?: string;
  accountLabel?: string;
  source?: CalendarSource;
  status?: string;
  start?: CalendarEventDate;
  end?: CalendarEventDate;
  attendees?: unknown[];
  organizer?: unknown;
  [key: string]: unknown;
};

const ACCOUNT_META: Record<string, { accountLabel: string; calendarName: string; color: string }> = {
  primary: {
    accountLabel: process.env.RIVENDELL_CALENDAR_PRIMARY_LABEL || 'Primary',
    calendarName: process.env.RIVENDELL_CALENDAR_PRIMARY_NAME || 'Primary calendar',
    color: process.env.RIVENDELL_CALENDAR_PRIMARY_COLOR || '#6aa3ff',
  },
  workspace2: {
    accountLabel: process.env.RIVENDELL_CALENDAR_SECONDARY_LABEL || 'Secondary',
    calendarName: process.env.RIVENDELL_CALENDAR_SECONDARY_NAME || 'Secondary calendar',
    color: process.env.RIVENDELL_CALENDAR_SECONDARY_COLOR || '#d4af63',
  },
};
const SECONDARY_MARKERS = (process.env.RIVENDELL_CALENDAR_SECONDARY_MARKERS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const DEFAULT_MAX_RESULTS = 250;
const MAX_RESULTS = 250;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

function readDateQuery(value: unknown, name: string): { date?: Date; error?: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `${name} must be an ISO date string` };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `${name} must be a valid ISO date string` };
  }
  return { date };
}

function readMaxResults(value: unknown): { maxResults: number; error?: string } {
  if (value === undefined) return { maxResults: DEFAULT_MAX_RESULTS };
  if (typeof value !== 'string' || !value.trim()) {
    return { maxResults: DEFAULT_MAX_RESULTS, error: 'maxResults must be a number' };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return { maxResults: DEFAULT_MAX_RESULTS, error: 'maxResults must be a number' };
  }
  return { maxResults: Math.min(Math.max(parsed, 1), MAX_RESULTS) };
}

function defaultRange() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return {
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
  };
}

function readRange(query: Record<string, unknown>): { timeMin: string; timeMax: string; error?: string } {
  const fallback = defaultRange();
  const minResult = readDateQuery(query.timeMin, 'timeMin');
  if (minResult.error) return { ...fallback, error: minResult.error };
  const maxResult = readDateQuery(query.timeMax, 'timeMax');
  if (maxResult.error) return { ...fallback, error: maxResult.error };
  const min = minResult.date ?? new Date(fallback.timeMin);
  const max = maxResult.date ?? new Date(fallback.timeMax);
  if (min.getTime() >= max.getTime()) {
    return { ...fallback, error: 'timeMin must be before timeMax' };
  }
  if (max.getTime() - min.getTime() > MAX_RANGE_MS) {
    return { ...fallback, error: 'Calendar range cannot exceed 90 days' };
  }
  return {
    timeMin: min.toISOString(),
    timeMax: max.toISOString(),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function organizerEmail(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const email = (value as { email?: unknown }).email;
  return stringValue(email);
}

function sourceForEvent(event: CalendarEvent): 'primary' | 'workspace2' {
  const markers = [
    stringValue(event.source),
    stringValue(event.account),
    stringValue(event.calendarId),
    stringValue(event.calendarName),
    organizerEmail(event.organizer),
  ];
  if (markers.some((value) =>
    value === 'workspace2'
    || value === 'secondary'
    || SECONDARY_MARKERS.some((marker) => value.includes(marker)))) {
    return 'workspace2';
  }
  return 'primary';
}

function accountMetaFor(event: CalendarEvent) {
  return ACCOUNT_META[sourceForEvent(event)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractEvents(payload: unknown): CalendarEvent[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord) as CalendarEvent[];
  }
  if (!isRecord(payload)) {
    throw new Error('calendar upstream returned an unexpected response shape');
  }
  const candidates = [payload.events, payload.items];
  const events = candidates.find(Array.isArray);
  if (!events) {
    throw new Error('calendar upstream response did not include an events array');
  }
  return events.filter(isRecord) as CalendarEvent[];
}

function normalizeEvent(event: CalendarEvent) {
  const source = sourceForEvent(event);
  const meta = accountMetaFor(event);
  return {
    ...event,
    id: event.id || `${source}-${event.calendarId || 'calendar'}-${event.summary || 'untitled'}-${event.start?.dateTime || event.start?.date || ''}`,
    source,
    account: event.account || '',
    accountLabel: meta.accountLabel,
    calendarName: meta.calendarName,
    color: meta.color,
    attendees: Array.isArray(event.attendees) ? event.attendees : [],
  };
}

calendarRouter.get('/', asyncHandler(async (req, res) => {
  // Real upstream only — no hardcoded events. Errors surface as 502 so the
  // UI can show "couldn't reach calendar" instead of fake meetings.
  try {
    const range = readRange(req.query as Record<string, unknown>);
    if (range.error) {
      res.status(400).json({ error: range.error });
      return;
    }
    const maxResult = readMaxResults(req.query.maxResults);
    if (maxResult.error) {
      res.status(400).json({ error: maxResult.error });
      return;
    }
    const payload = await callMcp<unknown>('calendar', {
      action: 'list_events',
      params: {
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        maxResults: maxResult.maxResults,
      },
    });
    const rawEvents = extractEvents(payload);
    res.json({
      events: rawEvents.map(normalizeEvent),
      range,
      maxResults: maxResult.maxResults,
      truncated: rawEvents.length >= maxResult.maxResults,
    });
  } catch (err: any) {
    res.status(502).json({ error: `calendar upstream failed: ${err?.message || 'unknown error'}` });
  }
}));

calendarRouter.post('/draft', asyncHandler(async (req, res) => {
  try {
    res.json(await callMcp('calendar', { action: 'draft', ...req.body }));
  } catch (err: any) {
    res.status(502).json({ error: `calendar draft failed: ${err?.message || 'unknown error'}` });
  }
}));
