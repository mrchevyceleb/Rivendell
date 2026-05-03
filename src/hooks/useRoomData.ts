import { useQuery } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import { hallSummary } from '../data/mock';
import type {
  ChronicleEntry,
  CronJob,
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
function roomQuery<T>(key: string[], path: string, empty: T) {
  const result = useQuery({
    queryKey: key,
    queryFn: () => apiJson<T>(path),
    staleTime,
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
  return roomQuery<MessageItem[]>(['messages'], '/api/messages', emptyMessages);
}

export function useFamily() {
  return roomQuery<FamilyItem[]>(['family'], '/api/family', emptyFamily);
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
  return roomQuery<CronJob[]>(['cron'], '/api/cron', emptyCronJobs);
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
