// Agent-scoped chat message pins — the right-pane pocket, NOT the Library/Pins room.
// Store: ~/.rivendell/message-pins.json

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';

export type MessagePin = {
  id: string;
  agentId: string;
  blockId: string;
  text: string;
  ts: number;
  createdAt: number;
};

const FILE = join(STATE_DIR, 'message-pins.json');
const TEXT_CAP = 800;

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizePin(value: unknown): MessagePin | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
  const blockId = typeof raw.blockId === 'string' ? raw.blockId.trim() : '';
  if (!id || !agentId || !blockId) return null;
  return {
    id,
    agentId,
    blockId,
    text: typeof raw.text === 'string' ? raw.text : '',
    ts: asFiniteNumber(raw.ts, 0),
    createdAt: asFiniteNumber(raw.createdAt, 0),
  };
}

function readAll(): MessagePin[] {
  let raw: string;
  try {
    raw = readFileSync(FILE, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const data = JSON.parse(raw) as { pins?: unknown } | unknown;
  const pins = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as { pins?: unknown }).pins) ? (data as { pins: unknown[] }).pins : []);
  return pins.map(normalizePin).filter((p): p is MessagePin => Boolean(p));
}

function save(pins: MessagePin[]): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ pins }, null, 2)}\n`);
  try {
    renameSync(tmp, FILE);
  } catch {
    // Windows cannot replace via rename; overwrite in place so a failed
    // write cannot leave the store deleted. Linux rename already replaced.
    writeFileSync(FILE, readFileSync(tmp));
    try { unlinkSync(tmp); } catch { /* leftover tmp is harmless */ }
  }
}

export function listMessagePins(agentId?: string): MessagePin[] {
  const pins = readAll();
  const filtered = agentId ? pins.filter((p) => p.agentId === agentId) : pins;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export function toggleMessagePin(input: {
  agentId: string;
  blockId: string;
  text: string;
  ts: number;
}): { pin: MessagePin | null; pinned: boolean } {
  const agentId = input.agentId.trim();
  const blockId = input.blockId.trim();
  if (!agentId || !blockId) return { pin: null, pinned: false };

  const pins = readAll();
  const idx = pins.findIndex((p) => p.agentId === agentId && p.blockId === blockId);
  if (idx >= 0) {
    pins.splice(idx, 1);
    save(pins);
    return { pin: null, pinned: false };
  }

  const pin: MessagePin = {
    id: `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    blockId,
    text: (input.text ?? '').trim().slice(0, TEXT_CAP),
    ts: Number.isFinite(input.ts) ? input.ts : Date.now(),
    createdAt: Date.now(),
  };
  pins.unshift(pin);
  save(pins);
  return { pin, pinned: true };
}

export function deleteMessagePin(id: string): boolean {
  const pins = readAll();
  const next = pins.filter((p) => p.id !== id);
  if (next.length === pins.length) return false;
  save(next);
  return true;
}

export function deleteMessagePinsForAgent(agentId: string): void {
  const pins = readAll();
  const next = pins.filter((p) => p.agentId !== agentId);
  if (next.length !== pins.length) save(next);
}
