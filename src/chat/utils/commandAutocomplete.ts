import type { CommandEntry } from '../data/types';

export type CommandSuggestion = {
  command: CommandEntry;
  fullText: string;
  tail: string;
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
    fullText,
    tail: fullText.slice(value.length),
  };
}

export function commandText(prefix: string, name: string): string {
  return `${prefix}${name}`;
}
