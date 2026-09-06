// Tiny persisted settings for the desktop shell. One JSON file in the
// Electron userData directory; every read tolerates a missing or corrupt file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ThemeName = 'dark' | 'light';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface Settings {
  serverUrl?: string;
  theme?: ThemeName;
  bounds?: WindowBounds;
  maximized?: boolean;
}

let settingsPath = '';
let cache: Settings = {};

export function initSettings(userDataDir: string): Settings {
  settingsPath = path.join(userDataDir, 'settings.json');
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    cache = sanitize(raw);
  } catch {
    cache = {};
  }
  return { ...cache };
}

export function getSettings(): Settings {
  return { ...cache };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = sanitize({ ...cache, ...patch });
  try {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.error('[tardis] could not save settings:', error);
  }
  return { ...cache };
}

function sanitize(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: Settings = {};
  if (typeof input.serverUrl === 'string' && input.serverUrl) out.serverUrl = input.serverUrl;
  if (input.theme === 'light' || input.theme === 'dark') out.theme = input.theme;
  if (input.bounds && typeof input.bounds === 'object') {
    const b = input.bounds as Record<string, unknown>;
    if (isFinite(b.width) && isFinite(b.height) && b.width >= 320 && b.height >= 240) {
      out.bounds = { width: Math.round(b.width), height: Math.round(b.height) };
      if (isFinite(b.x) && isFinite(b.y)) {
        out.bounds.x = Math.round(b.x);
        out.bounds.y = Math.round(b.y);
      }
    }
  }
  if (typeof input.maximized === 'boolean') out.maximized = input.maximized;
  return out;
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
