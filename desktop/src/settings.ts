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
  /** This machine's copy of the workspace (ASSISTANT-HUB). */
  workspaceRoot?: string;
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
  if (typeof input.workspaceRoot === 'string' && input.workspaceRoot) out.workspaceRoot = input.workspaceRoot;
  if (input.bounds && typeof input.bounds === 'object') {
    const b = input.bounds as Record<string, unknown>;
    if (isFinite(b.width) && isFinite(b.height) && b.width >= 320 && b.height >= 240) {
      out.bounds = { width: clamp(b.width, 320, MAX_SIZE), height: clamp(b.height, 240, MAX_SIZE) };
      if (isFinite(b.x) && isFinite(b.y)) {
        out.bounds.x = clamp(b.x, -MAX_OFFSET, MAX_OFFSET);
        out.bounds.y = clamp(b.y, -MAX_OFFSET, MAX_OFFSET);
      }
    }
  }
  if (typeof input.maximized === 'boolean') out.maximized = input.maximized;
  return out;
}

// Generous, but finite: a corrupt settings file must never produce a window
// Chromium refuses to create.
const MAX_SIZE = 16384;
const MAX_OFFSET = 32768;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
