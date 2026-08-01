// Responsive switch for the reimagined chat. The shared shell state (theme,
// sticky scroll, sparks, composer draft, room, chronicle, commands) lives HERE
// so it survives a mobile/desktop breakpoint cross without resetting the draft
// or the selected room. Mounted by ChatTab (the live chat entry in the Studio
// IDE). Narrow detection is container-width based (a Studio pane can be narrow
// even on a wide viewport), falling back to the viewport on first paint.

import { useEffect, useRef, useState } from 'react';
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

  // Track the actual mount width (Studio pane), not just the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setNarrow(w <= NARROW_PX);
    });
    ro.observe(el);
    setNarrow(el.clientWidth <= NARROW_PX);
    return () => ro.disconnect();
  }, []);

  const view: ViewProps = { s, picker: props.picker, repo: props.repo, agent: props.agent };
  return (
    <div ref={wrapRef} style={{ display: 'contents' }}>
      {narrow ? <Mobile {...view} /> : <Conversation {...view} />}
    </div>
  );
}

export default Threshold;
