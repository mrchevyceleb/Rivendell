import { useEffect, useState } from 'react';
import type { ScribeEvent } from '../data/types';

export function useScribeSocket(initial: ScribeEvent[] = []) {
  const [events, setEvents] = useState<ScribeEvent[]>(initial);
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    if (!initial.length) return;
    setEvents((prev) => (prev.length ? prev : initial));
  }, [initial]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/scribe`);

    ws.addEventListener('open', () => setState('open'));
    ws.addEventListener('close', () => setState('closed'));
    ws.addEventListener('message', (message) => {
      try {
        const parsed = JSON.parse(String(message.data));
        if (parsed.type === 'snapshot' && Array.isArray(parsed.events)) {
          setEvents(parsed.events);
        }
        if (parsed.type === 'event' && parsed.event) {
          setEvents((prev) => [...prev.slice(-199), parsed.event]);
        }
      } catch {
        // Ignore malformed websocket frames.
      }
    });

    return () => ws.close();
  }, []);

  return { events, state };
}
