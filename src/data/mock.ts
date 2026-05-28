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

export const rooms: Room[] = [
  { key: '/', name: 'The Hall', role: 'Live with Elrond', icon: 'hall' },
  { key: '/dashboard', name: 'Dashboard', role: 'Today at a glance', icon: 'dashboard' },
  { key: '/council', name: 'The Council', role: 'Task board', icon: 'council' },
  { key: '/tidings', name: 'Tidings', role: 'Unified email inbox', icon: 'tidings' },
  { key: '/calendar', name: 'Calendar', role: 'Matt + YPP schedule', icon: 'calendar' },
  { key: '/library', name: 'Library', role: 'Docs and references', icon: 'library' },
  { key: '/pins', name: 'Pins', role: 'Quick notes', icon: 'pins' },
  { key: '/reckoning', name: 'Reckoning', role: 'P&L tracker', icon: 'reckoning' },
  { key: '/forge', name: 'Forge', role: 'Cron and deploy log', icon: 'forge' },
  { key: '/weavings', name: 'Weavings', role: 'Employee queue', icon: 'weavings' },
  { key: '/annals', name: 'Annals', role: 'Past sessions', icon: 'annals' },
  { key: '/scribe', name: 'Scribe', role: 'Live activity log', icon: 'scribe' },
];

// All seeds are intentionally empty. Rivendell rooms must reflect real
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
