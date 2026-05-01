import { useQuery } from '@tanstack/react-query';
import { apiJson } from '../data/api';
import {
  chronicle,
  cronJobs,
  docs,
  emails,
  family,
  hallSummary,
  jobs,
  messages,
  pins,
  plEntries,
  scribeEvents,
  tasks,
} from '../data/mock';
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

function roomQuery<T>(key: string[], path: string, fallback: T) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await apiJson<T>(path);
      } catch {
        return fallback;
      }
    },
    staleTime,
  });
}

export function useHallSummary() {
  return roomQuery<HallSummary>(['hall-summary'], '/api/summary', hallSummary);
}

export function useTasks() {
  return roomQuery<Task[]>(['tasks'], '/api/tasks', tasks);
}

export function useEmails() {
  return roomQuery<EmailItem[]>(['email'], '/api/email', emails);
}

export function useMessages() {
  return roomQuery<MessageItem[]>(['messages'], '/api/messages', messages);
}

export function useFamily() {
  return roomQuery<FamilyItem[]>(['family'], '/api/family', family);
}

export function useDocs() {
  return roomQuery<LibraryDoc[]>(['docs'], '/api/docs', docs);
}

export function useWorkspaceTree() {
  return roomQuery<WorkspaceTreeResponse | null>(['workspace-tree'], '/api/docs/tree', null);
}

export function usePins() {
  return roomQuery<PinItem[]>(['pins'], '/api/pins', pins);
}

export function usePlEntries() {
  return roomQuery<PlEntry[]>(['pl'], '/api/pl', plEntries);
}

export function useCronJobs() {
  return roomQuery<CronJob[]>(['cron'], '/api/cron', cronJobs);
}

export function useWeavings() {
  return roomQuery<RivendellJob[]>(['weavings'], '/api/weavings/queue', jobs);
}

export function useAnnals() {
  return roomQuery<ChronicleEntry[]>(['annals'], '/api/chronicle', chronicle);
}

export function useScribeEvents() {
  return roomQuery<ScribeEvent[]>(['scribe-events'], '/api/scribe/events', scribeEvents);
}
