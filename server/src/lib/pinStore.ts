import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';

export type StoredPin = {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
};

const PINS_FILE = join(STATE_DIR, 'pins.json');

export async function listPins(search = '', category = ''): Promise<StoredPin[]> {
  const q = search.trim().toLowerCase();
  const cat = category.trim().toLowerCase();
  return sortPins((await readPins()).filter((pin) => {
    const matchesCategory = !cat || cat === 'all' || pin.category.toLowerCase() === cat;
    const matchesSearch =
      !q ||
      pin.title.toLowerCase().includes(q) ||
      pin.content.toLowerCase().includes(q) ||
      pin.category.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  }));
}

export async function createPin(input: Partial<StoredPin>): Promise<StoredPin> {
  const now = new Date().toISOString();
  const content = input.content?.trim() ?? '';
  const pin: StoredPin = {
    id: randomUUID(),
    title: cleanTitle(input.title, content),
    content,
    category: cleanCategory(input.category),
    pinned: Boolean(input.pinned),
    color: cleanColor(input.color),
    createdAt: now,
    updatedAt: now,
  };
  const next = sortPins([pin, ...(await readPins())]);
  await writePins(next);
  return pin;
}

export async function updatePin(id: string, patch: Partial<StoredPin>): Promise<StoredPin | null> {
  const pins = await readPins();
  const index = pins.findIndex((pin) => pin.id === id);
  if (index === -1) return null;

  const previous = pins[index];
  const content = patch.content !== undefined ? patch.content.trim() : previous.content;
  const updated: StoredPin = {
    ...previous,
    title: patch.title !== undefined ? cleanTitle(patch.title, content) : previous.title,
    content,
    category: patch.category !== undefined ? cleanCategory(patch.category) : previous.category,
    pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : previous.pinned,
    color: patch.color !== undefined ? cleanColor(patch.color) : previous.color,
    updatedAt: new Date().toISOString(),
  };

  const next = pins.map((pin) => (pin.id === id ? updated : pin));
  await writePins(sortPins(next));
  return updated;
}

export async function deletePin(id: string): Promise<boolean> {
  const pins = await readPins();
  const next = pins.filter((pin) => pin.id !== id);
  if (next.length === pins.length) return false;
  await writePins(next);
  return true;
}

async function readPins(): Promise<StoredPin[]> {
  try {
    const raw = await readFile(PINS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return sortPins(parsed.map(normalizePin).filter(Boolean) as StoredPin[]);
  } catch {
    // Fall through to an empty local shelf.
  }
  await writePins([]);
  return [];
}

async function writePins(pins: StoredPin[]): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PINS_FILE, `${JSON.stringify(sortPins(pins), null, 2)}\n`, 'utf8');
}

function normalizePin(value: unknown): StoredPin | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<StoredPin>;
  const now = new Date().toISOString();
  return {
    id: String(raw.id || randomUUID()),
    title: cleanTitle(raw.title, raw.content),
    content: String(raw.content || ''),
    category: cleanCategory(raw.category),
    pinned: Boolean(raw.pinned),
    color: cleanColor(raw.color),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || raw.createdAt || now),
  };
}

function sortPins(pins: StoredPin[]): StoredPin[] {
  return [...pins].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function cleanTitle(title?: string | null, content?: string | null): string {
  const value = title?.trim() || content?.trim().split('\n')[0]?.trim() || 'Untitled pin';
  return value.slice(0, 120);
}

function cleanCategory(category?: string | null): string {
  return (category?.trim() || 'general').slice(0, 40);
}

function cleanColor(color?: string | null): string | null {
  const value = color?.trim();
  return value ? value.slice(0, 32) : null;
}
