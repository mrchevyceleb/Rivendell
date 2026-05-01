import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { events, newEvent, type ScribeEvent } from '../data/mock.ts';
import { supabase } from '../lib/supabase.ts';

const clients = new Set<import('ws').WebSocket>();

export function latestEvents(): ScribeEvent[] {
  return events.slice(-250);
}

export async function emitScribe(input: Omit<ScribeEvent, 'id' | 'ts'> & { ts?: string }): Promise<ScribeEvent> {
  const event = newEvent(input);
  events.push(event);
  if (events.length > 500) events.splice(0, events.length - 500);

  if (supabase) {
    const { error } = await supabase.from('rivendell_job_events').insert({
      job_id: event.job_id ?? null,
      level: event.level,
      text: event.text,
      payload: event.payload ?? null,
      ts: event.ts,
    });
    if (error) console.warn(`[scribe] Supabase insert failed: ${error.message}`);
  }

  const frame = JSON.stringify({ type: 'event', event });
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(frame);
  }
  return event;
}

export function registerScribeSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/ws/scribe') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', events: latestEvents() }));
    ws.on('close', () => clients.delete(ws));
  });
}
