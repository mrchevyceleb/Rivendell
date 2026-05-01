import type { CommandEntry } from '../data/types';

export type CommandSuggestion = {
  command: CommandEntry;
  prefix: string;
  fullText: string;
  tail: string;
};

export type CommandSet = {
  prefix: string;
  commands: CommandEntry[];
};

export function getCommandSuggestion(
  value: string,
  prefix: string,
  commands: CommandEntry[],
): CommandSuggestion | null {
  if (!prefix || !value.startsWith(prefix)) return null;
  if (/\s/.test(value)) return null;

  const query = value.slice(prefix.length).toLowerCase();
  const match = commands.find((cmd) => {
    const name = cmd.name.toLowerCase();
    return name.startsWith(query) && name !== query;
  });
  if (!match) return null;

  const fullText = `${prefix}${match.name}`;
  return {
    command: match,
    prefix,
    fullText,
    tail: fullText.slice(value.length),
  };
}

/**
 * Try each command set in order (e.g. {prefix:'/',commands:claude} then
 * {prefix:'$',commands:codex}) and return the first match. Lets a single
 * composer offer both Claude Code (`/foo`) and Codex (`$foo`) skill
 * autocomplete simultaneously.
 */
export function getCommandSuggestionMulti(
  value: string,
  sets: CommandSet[],
): CommandSuggestion | null {
  for (const set of sets) {
    const hit = getCommandSuggestion(value, set.prefix, set.commands);
    if (hit) return hit;
  }
  return null;
}

export function commandText(prefix: string, name: string): string {
  return `${prefix}${name}`;
}
