import type {
  CalendarEventsResponse,
  ChronicleEntry,
  CronJob,
  EmailItem,
  FamilyItem,
  HallSummary,
  LibraryDoc,
  MessageItem,
  PinItem,
  PlEntry,
  RivendellJob,
  Room,
  ScribeEvent,
  Task,
} from './types';
import { ROOM_NAMES } from './roomNames';

export const rooms: Room[] = [
  { key: '/', name: ROOM_NAMES.hall.name, role: ROOM_NAMES.hall.tagline, icon: 'hall' },
  { key: '/dashboard', name: ROOM_NAMES.dashboard.name, role: ROOM_NAMES.dashboard.tagline, icon: 'dashboard' },
  { key: '/council', name: ROOM_NAMES.council.name, role: ROOM_NAMES.council.tagline, icon: 'council' },
  { key: '/tidings', name: ROOM_NAMES.tidings.name, role: ROOM_NAMES.tidings.tagline, icon: 'tidings' },
  { key: '/calendar', name: ROOM_NAMES.calendar.name, role: ROOM_NAMES.calendar.tagline, icon: 'calendar' },
  { key: '/library', name: ROOM_NAMES.library.name, role: ROOM_NAMES.library.tagline, icon: 'library' },
  { key: '/workspace', name: ROOM_NAMES.workspace.name, role: ROOM_NAMES.workspace.tagline, icon: 'workspace' },
  { key: '/pins', name: ROOM_NAMES.pins.name, role: ROOM_NAMES.pins.tagline, icon: 'pins' },
  { key: '/reckoning', name: ROOM_NAMES.reckoning.name, role: ROOM_NAMES.reckoning.tagline, icon: 'reckoning' },
  { key: '/forge', name: ROOM_NAMES.forge.name, role: ROOM_NAMES.forge.tagline, icon: 'forge' },
  { key: '/weavings', name: ROOM_NAMES.weavings.name, role: ROOM_NAMES.weavings.tagline, icon: 'weavings' },
  { key: '/annals', name: ROOM_NAMES.annals.name, role: ROOM_NAMES.annals.tagline, icon: 'annals' },
  { key: '/scribe', name: ROOM_NAMES.scribe.name, role: ROOM_NAMES.scribe.tagline, icon: 'scribe' },
];

// All seeds are intentionally empty. TARDIS rooms must reflect real
// upstream data — the moment we provide a fake fallback, the UI starts
// claiming things that aren't true. `hallSummary` is a zero-state shell
// only because callers spread it.
export const tasks: Task[] = [];
export const emails: EmailItem[] = [];
export const messages: MessageItem[] = [];
export const family: FamilyItem[] = [];
export const calendarEvents: CalendarEventsResponse = { events: [] };
export const docs: LibraryDoc[] = [];
export const pins: PinItem[] = [];
export const plEntries: PlEntry[] = [];
export const cronJobs: CronJob[] = [];
export const jobs: RivendellJob[] = [];
export const scribeEvents: ScribeEvent[] = [];
export const chronicle: ChronicleEntry[] = [];

export const hallSummary: HallSummary = {
  tasksDue: 0,
  unreadEmail: 0,
  pendingMessages: 0,
  queuedJobs: 0,
  runningJobs: 0,
  needsReview: 0,
};
