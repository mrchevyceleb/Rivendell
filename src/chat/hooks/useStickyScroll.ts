import { useCallback, useEffect, useRef, useState } from 'react';

// Sticky-tail scroll for the chat conversation. Pins the view to the bottom
// of `scrollRef` while content grows, and gets out of the way when the user
// explicitly takes over. Also drives the reimagined "To the latest word" jump
// pill: a 56px pin threshold, a React-exposed `pinned` flag, and an unread
// counter that completed replies increment while the user is scrolled up.
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

// §3.6: pinned when within 56px of the feed bottom.
const RESUME_THRESHOLD_PX = 56;
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
  // `pinned` is the React-visible mirror of `!userOverrideRef` so the jump pill
  // can render. Kept in state; recomputed on every scroll.
  const [pinned, setPinned] = useState(true);
  // Completed replies bump this while the user is scrolled up.
  const [unread, setUnread] = useState(0);
  // True while the user is mid-drag selecting text inside the transcript, or
  // is keeping a non-collapsed selection alive after release. While set, we
  // refuse to pin — a programmatic scroll under the user's cursor collapses
  // the in-progress selection, which is exactly what Matt was hitting.
  const selectingRef = useRef(false);

  const setOverride = useCallback((next: boolean) => {
    userOverrideRef.current = next;
    setPinned(!next);
    if (!next) setUnread(0);
  }, []);

  const pin = useCallback(() => {
    if (userOverrideRef.current) return;
    if (selectingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_GUARD_MS;
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    el.scrollTop = el.scrollHeight;
  }, []);

  // §3.6: sending force-follows the feed regardless of the user's scroll
  // position, and clears the override so live appends keep auto-following.
  const forcePin = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_GUARD_MS;
    el.scrollTop = el.scrollHeight;
    setOverride(false);
  }, [setOverride]);

  // Smooth-scroll to the very bottom and clear the unread counter (jump pill).
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_GUARD_MS;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setOverride(false);
  }, [setOverride]);

  // A completed reply calls this; it only counts while the user is scrolled up.
  const noteUnread = useCallback(() => {
    if (!userOverrideRef.current) return;
    setUnread((n) => n + 1);
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
      requestAnimationFrame(pin);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin]);

  // User-intent capture. A gesture only counts as "I'm taking over" when it
  // actually moves the view away from the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= RESUME_THRESHOLD_PX;
    const takeover = () => {
      if (isAtBottom()) return;
      setOverride(true);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) { setOverride(true); return; }
      takeover();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!NAV_KEYS.has(e.key)) return;
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
        setOverride(true);
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
  }, [setOverride]);

  // Selection-aware pin gate (see original comment block — prevents programmatic
  // scrolls from yanking an in-progress text selection).
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
    const settle = () => { selectingRef.current = hasLiveSelection(); };

    const onPointerDown = (event: PointerEvent) => {
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
  // mark takeover when the view leaves the bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Date.now() < programmaticUntilRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setOverride(distanceFromBottom > RESUME_THRESHOLD_PX);
  }, [setOverride]);

  return {
    scrollRef, bottomRef, contentRef, onScroll, pin, forcePin,
    pinned, unread, noteUnread, jumpToBottom,
  };
}
