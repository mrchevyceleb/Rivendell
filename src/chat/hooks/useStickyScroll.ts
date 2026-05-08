import { useCallback, useEffect, useRef } from 'react';

// Sticky-tail scroll for the chat conversation. Pins the view to the bottom
// of `scrollRef` while content grows, and gets out of the way when the user
// explicitly takes over.
//
// Why this is its own hook (and a touch elaborate):
//  - Block-array changes alone aren't enough to detect content growth. Image
//    loads, code-block layout shifts, and font reflows all change height
//    without changing the React tree. We pin on every ResizeObserver tick.
//  - Inferring user intent from scroll position alone races against our own
//    programmatic scrolls — the auto-pin write fires onScroll, which used to
//    flip the override flag if the math was off by a pixel. We track user
//    intent from input events (wheel/touchstart/keydown) instead, and only
//    *clear* the override when the user voluntarily scrolls back to the
//    bottom (within RESUME_THRESHOLD_PX).
//  - Programmatic scrolls set a short timestamp window so the onScroll
//    handler can ignore them when deciding whether to resume sticky.

const RESUME_THRESHOLD_PX = 30;
const PROGRAMMATIC_GUARD_MS = 80;
const NAV_KEYS = new Set([
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Spacebar',
]);

export function useStickyScroll() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const userOverrideRef = useRef(false);
  const programmaticUntilRef = useRef(0);
  // True while the user is mid-drag selecting text inside the transcript, or
  // is keeping a non-collapsed selection alive after release. While set, we
  // refuse to pin — a programmatic scroll under the user's cursor collapses
  // the in-progress selection, which is exactly what Matt was hitting.
  const selectingRef = useRef(false);

  const pin = useCallback(() => {
    if (userOverrideRef.current) return;
    if (selectingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_GUARD_MS;
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    el.scrollTop = el.scrollHeight;
  }, []);

  // Pin on every content size change. ResizeObserver fires for token deltas,
  // image loads, and any other layout reflow inside the content wrapper.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      pin();
      return;
    }
    const observer = new ResizeObserver(() => {
      pin();
      // A second pass on the next frame catches the case where layout hadn't
      // settled when the observer fired.
      requestAnimationFrame(pin);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin]);

  // User-intent capture. A gesture only counts as "I'm taking over" when it
  // actually moves the view away from the bottom. A wheel-down or touchstart
  // while pinned at the bottom doesn't fire onScroll, so if we set the
  // override here unconditionally there'd be no event to clear it later and
  // streamed tokens would silently stop auto-pinning.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= RESUME_THRESHOLD_PX;
    const takeover = () => {
      if (isAtBottom()) return;
      userOverrideRef.current = true;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userOverrideRef.current = true;
        return;
      }
      takeover();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!NAV_KEYS.has(e.key)) return;
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
        userOverrideRef.current = true;
        return;
      }
      takeover();
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', takeover, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', takeover);
      el.removeEventListener('keydown', onKey);
    };
  }, []);

  // Selection-aware pin gate. `selectingRef` is true whenever a non-collapsed
  // selection lives inside the transcript, OR a primary-button drag-select is
  // in flight inside the transcript (so the very-first-frame race between
  // mousedown and the first selectionchange can't yank scroll out from under
  // the user). Signals:
  //   1. pointerdown (primary button only) inside the transcript primes the
  //      gate before any selection range exists, covering mouse, pen, and the
  //      pointer-event cousin of mouse on browsers that don't fire mousedown.
  //   2. selectionchange is the source of truth — it assigns the gate based
  //      on whether a non-collapsed selection currently overlaps the
  //      transcript. This catches touch long-press selection, keyboard
  //      shift-arrow selection, and "Select All" via menu/AT, none of which
  //      fire pointerdown/mousedown.
  //   3. pointerup re-evaluates from the live selection so a release outside
  //      the window still settles the gate correctly.
  //   4. pointercancel, blur, and visibilitychange clear the gate when the
  //      drag is interrupted (alt-tab, OS dialog, focus loss) — without
  //      these, a missed release could leave the chat permanently frozen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const hasLiveSelection = () => {
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!sel || sel.isCollapsed) return false;
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      return Boolean((anchor && el.contains(anchor)) || (focus && el.contains(focus)));
    };
    const settle = () => {
      selectingRef.current = hasLiveSelection();
    };

    const onPointerDown = (event: PointerEvent) => {
      // Primary button only — we don't gate on right-click, middle-click, or
      // synthesized touch context-menu pointers.
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      selectingRef.current = true;
    };

    el.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', settle);
    document.addEventListener('pointercancel', settle);
    document.addEventListener('selectionchange', settle);
    window.addEventListener('blur', settle);
    document.addEventListener('visibilitychange', settle);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', settle);
      document.removeEventListener('pointercancel', settle);
      document.removeEventListener('selectionchange', settle);
      window.removeEventListener('blur', settle);
      document.removeEventListener('visibilitychange', settle);
    };
  }, []);

  // Resume sticky when the user lands at the very bottom on their own, and
  // mark takeover when the view leaves the bottom. The takeover branch is the
  // load-bearing one for touch devices: a drag-up that begins at the bottom
  // can't be detected from touchstart alone (isAtBottom is still true at that
  // instant), so we rely on the scroll position actually moving away.
  // The PROGRAMMATIC_GUARD_MS window stops auto-pin's own scroll write from
  // flipping the flag.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Date.now() < programmaticUntilRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= RESUME_THRESHOLD_PX) {
      userOverrideRef.current = false;
    } else {
      userOverrideRef.current = true;
    }
  }, []);

  return { scrollRef, bottomRef, contentRef, onScroll, pin };
}
