// Reads the engine / model / effort matrix at ~/samwise/.accounts/engines.json — the single
// source of truth (sibling to account-map.json) for the model+effort picker. Provides the
// default model + effort per engine, falling back to the passed values if the config is missing.
// Operator overrides live outside the repository.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface EngineDef {
  default_model?: string | null;
  default_effort?: string | null;
  effort_levels?: string[];
}
interface EnginesConfig {
  engines?: Record<string, EngineDef>;
}

const CONFIG_PATH = join(homedir(), 'samwise', '.accounts', 'engines.json');
let cached: EnginesConfig | null | undefined;
function load(): EnginesConfig | null {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as EnginesConfig;
  } catch {
    cached = null; // missing/unreadable → callers use their fallback
  }
  return cached;
}

/** Default { model, effort } for an engine, falling back to the given values if config is absent. */
export function engineDefault(
  engine: string,
  fallbackModel: string,
  fallbackEffort: string,
): { model: string; effort: string } {
  const e = load()?.engines?.[engine];
  return {
    model: e?.default_model ?? fallbackModel,
    effort: e?.default_effort ?? fallbackEffort,
  };
}
