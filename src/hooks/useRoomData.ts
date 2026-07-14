import { useQuery } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import { calendarEvents, hallSummary } from '../data/mock';
import type {
  CalendarEventsResponse,
  ChronicleEntry,
  CronJob,
  CronRun,
  EmailItem,
  FamilyItem,
  HallSummary,
  LibraryDoc,
  WorkspaceTreeResponse,
  MessageItem,
  PinItem,
  PlEntry,
  RivendellJob,
  ScribeEvent,
  Task,
} from '../data/types';

const staleTime = 20_000;
const emptyHallSummary: HallSummary = {
  ...hallSummary,
  tasksDue: 0,
  unreadEmail: 0,
  pendingMessages: 0,
  queuedJobs: 0,
  runningJobs: 0,
  needsReview: 0,
};
const emptyTasks: Task[] = [];
const emptyEmails: EmailItem[] = [];
const emptyMessages: MessageItem[] = [];
const emptyFamily: FamilyItem[] = [];
const emptyCalendarEvents: CalendarEventsResponse = calendarEvents;
const emptyDocs: LibraryDoc[] = [];
const emptyPins: PinItem[] = [];
const emptyPlEntries: PlEntry[] = [];
const emptyCronJobs: CronJob[] = [];
const emptyWeavings: RivendellJob[] = [];
const emptyAnnals: ChronicleEntry[] = [];
const emptyScribeEvents: ScribeEvent[] = [];

/**
 * Standard room data hook. Returns whatever the API returns. On error the
 * hook surfaces React Query's `error` to the caller — we deliberately do NOT
 * fall back to mock data, so a room is only ever real-or-empty-or-error.
 *
 * `empty` is the default value returned while the query is loading or has
 * errored, so consumers using `data ?? empty` get a clean shape without any
 * fake content.
 */
function roomQuery<T>(
  key: string[],
  path: string,
  empty: T,
  options?: { retry?: number | boolean },
) {
  const result = useQuery({
    queryKey: key,
    queryFn: () => apiJson<T>(path),
    staleTime,
    ...(options?.retry !== undefined ? { retry: options.retry } : {}),
  });
  return { ...result, data: result.data ?? empty };
}

export function useHallSummary() {
  // Hall summary is a shape, not a list; provide a zero-counter shell so the
  // UI never shows fake counts. Real data overrides on success.
  return roomQuery<HallSummary>(['hall-summary'], '/api/summary', emptyHallSummary);
}

export function useTasks() {
  return roomQuery<Task[]>(['tasks'], '/api/tasks', emptyTasks);
}

export function useEmails() {
  return roomQuery<EmailItem[]>(['email'], '/api/email', emptyEmails);
}

export function useMessages() {
  // Upstream MCP `messages` tool isn't built yet — the route returns 502 by
  // design. Skip retries so the failure surfaces once instead of 4×.
  return roomQuery<MessageItem[]>(['messages'], '/api/messages', emptyMessages, { retry: false });
}

export function useFamily() {
  return roomQuery<FamilyItem[]>(['family'], '/api/family', emptyFamily);
}

export function useCalendarEvents() {
  return roomQuery<CalendarEventsResponse>(['calendar'], '/api/calendar', emptyCalendarEvents);
}

export function useDocs() {
  return roomQuery<LibraryDoc[]>(['docs'], '/api/docs', emptyDocs);
}

export function useWorkspaceTree() {
  return roomQuery<WorkspaceTreeResponse | null>(['workspace-tree'], '/api/docs/tree', null);
}

export function usePins() {
  return roomQuery<PinItem[]>(['pins'], '/api/pins', emptyPins);
}

export function usePlEntries() {
  return roomQuery<PlEntry[]>(['pl'], '/api/pl', emptyPlEntries);
}

export function useCronJobs() {
  const result = useQuery({
    queryKey: ['cron'],
    queryFn: () => apiJson<CronJob[]>('/api/cron'),
    staleTime: 5_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  return { ...result, data: result.data ?? emptyCronJobs };
}

/**
 * Per-job execution history. Polls on an interval so a manual "Run once"
 * surfaces in the list, but TanStack Query handles dedup + abort so a slow
 * upstream can't stack overlapping requests or overwrite newer state. Disabled
 * for managed/readOnly jobs (synthetic ids that have no history rows).
 */
export function useCronHistory(jobId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['cron-history', jobId],
    queryFn: () => apiJson<{ runs: CronRun[] }>(`/api/cron/${encodeURIComponent(String(jobId))}/history?limit=15`),
    enabled: Boolean(jobId) && enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 8_000 : false,
    retry: false,
  });
}

export function useWeavings() {
  return roomQuery<RivendellJob[]>(['weavings'], '/api/weavings/queue', emptyWeavings);
}

export function useAnnals() {
  return roomQuery<ChronicleEntry[]>(['annals'], '/api/chronicle', emptyAnnals);
}

export function useScribeEvents() {
  return roomQuery<ScribeEvent[]>(['scribe-events'], '/api/scribe/events', emptyScribeEvents);
}
