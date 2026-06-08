import {
  Activity,
  CalendarDays,
  CircleDollarSign,
  Code2,
  Hammer,
  Home,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Library,
  ListChecks,
  Pin,
  ScrollText,
} from 'lucide-react';

const glyphs = {
  hall: Home,
  dashboard: LayoutDashboard,
  council: ListChecks,
  tidings: Inbox,
  calendar: CalendarDays,
  library: Library,
  workspace: Code2,
  pins: Pin,
  reckoning: CircleDollarSign,
  forge: Hammer,
  weavings: KanbanSquare,
  annals: CalendarDays,
  scribe: ScrollText,
  activity: Activity,
};

export function RoomGlyph({ icon, size = 18 }: { icon: string; size?: number }) {
  const Icon = glyphs[icon as keyof typeof glyphs] ?? Activity;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
