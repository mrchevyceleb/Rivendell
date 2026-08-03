// Responsive switch for the reimagined chat. The shared shell state (theme,
// sticky scroll, sparks, composer draft, room, chronicle, commands) lives HERE
// so it survives a mobile/desktop breakpoint cross without resetting the draft
// or the selected room. Mounted by ChatTab (the live chat entry in the Studio
// IDE). Narrow detection is container-width based (a Studio pane can be narrow
// even on a wide viewport), falling back to the viewport on first paint.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Conversation } from './Conversation';
import { Mobile } from '../mobile/Mobile';
import { useChatShell, type ShellProps, type ShellState } from '../reimagine/useChatShell';
import type { CompanionPicker } from '../../hooks/useCompanionPicker';
import type { Repo } from '../../data/types';

type ViewProps = { s: ShellState; picker: CompanionPicker; repo?: Repo; agent?: string };

const NARROW_PX = 760;

export function Threshold(props: ShellProps) {
  // Hoist the shell state above the mobile/desktop branch so a breakpoint cross
  // doesn't wipe the in-flight draft or the active room.
  const s = useChatShell(props);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= NARROW_PX : false,
  );

  // Track the actual mount width (Studio pane), not just the viewport. The
  // wrapper must be a REAL box: a `display:contents` element has no content box,
  // so ResizeObserver would only ever see width 0 and pin us to Mobile even on a
  // wide desktop. Ignore 0-width reads too, so a hidden (display:none) tab pane
  // doesn't flip the breakpoint to mobile while it's off-screen. Measured in a
  // layout effect so the first real measurement lands before paint (no flash of
  // the wrong shell when a narrow Studio pane sits inside a wide viewport).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (w: number) => { if (w > 0) setNarrow(w <= NARROW_PX); };
    const ro = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    ro.observe(el);
    measure(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Desktop is Hall-only (no room switcher), so normalize the SHARED room state
  // when we're wide. Without this, selecting Council/Forge/Files on mobile then
  // widening strands `s.room` on a hidden room: the desktop feed would be fine
  // but narrowing again would snap back to that stale room, and anything keyed
  // to `s.room` would read the wrong context.
  useEffect(() => {
    if (!narrow && s.room !== 'hall') s.setRoom('hall');
  }, [narrow, s.room, s.setRoom]);

  const view: ViewProps = { s, picker: props.picker, repo: props.repo, agent: props.agent };
  return (
    <div
      ref={wrapRef}
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}
    >
      {narrow ? <Mobile {...view} /> : <Conversation {...view} />}
    </div>
  );
}

export default Threshold;
