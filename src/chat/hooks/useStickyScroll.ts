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

  const pin = useCallback(() => {
    if (userOverrideRef.current) return;
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

  // User-intent capture. Any of these means "I'm taking over the scroll."
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const takeover = () => {
      userOverrideRef.current = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (NAV_KEYS.has(e.key)) takeover();
    };
    el.addEventListener('wheel', takeover, { passive: true });
    el.addEventListener('touchstart', takeover, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', takeover);
      el.removeEventListener('touchstart', takeover);
      el.removeEventListener('keydown', onKey);
    };
  }, []);

  // Resume sticky when the user lands at the very bottom on their own.
  // Skip the check during the brief window after a programmatic write so
  // auto-pin can't flip its own override flag.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Date.now() < programmaticUntilRef.current) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= RESUME_THRESHOLD_PX) {
      userOverrideRef.current = false;
    }
  }, []);

  return { scrollRef, bottomRef, contentRef, onScroll, pin };
}
