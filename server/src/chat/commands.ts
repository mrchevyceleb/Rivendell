import { readdir, readFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { ASSISTANT_HUB_PATH, BANANA_COMMANDS_DIR, CLAUDE_COMMANDS_DIR, CODEX_SKILLS_DIR } from './config.ts';

export type CommandEntry = {
  name: string;
  title?: string;
  description?: string;
};

export type CommandCatalog = {
  claude: CommandEntry[];
  codex: CommandEntry[];
  banana: CommandEntry[];
};

async function markdownCommands(dir: string, prefix: string[] = []): Promise<CommandEntry[]> {
  let files: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }> = [];
  try {
    files = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries = await Promise.all(
    files
      .filter((file) => !file.name.startsWith('.'))
      .map(async (file) => {
        const path = join(dir, file.name);
        if (file.isDirectory()) return markdownCommands(path, [...prefix, file.name]);
        if (!file.isFile() || !file.name.endsWith('.md')) return [];
        const name = [...prefix, parse(file.name).name].join(':');
        const body = await readFile(path, 'utf8').catch(() => '');
        return [commandEntry(name, body)];
      }),
  );
  return entries.flat().sort(sortCommands);
}

async function skillCommands(dir: string): Promise<CommandEntry[]> {
  let children: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries = await Promise.all(
    children
      .filter((child) => child.isDirectory() && !child.name.startsWith('.'))
      .map(async (child) => {
        const body = await readFile(join(dir, child.name, 'SKILL.md'), 'utf8').catch(() => '');
        return commandEntry(child.name, body);
      }),
  );
  return entries.sort(sortCommands);
}

function mergeCommandEntries(...groups: CommandEntry[][]): CommandEntry[] {
  const byName = new Map<string, CommandEntry>();
  for (const group of groups) {
    for (const command of group) {
      const key = command.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, command);
    }
  }
  return Array.from(byName.values()).sort(sortCommands);
}

function commandEntry(name: string, body: string): CommandEntry {
  return {
    name,
    title: heading(body) ?? name,
    description: frontmatterValue(body, 'description'),
  };
}

function heading(body: string): string | undefined {
  const line = body.split('\n').find((l) => l.startsWith('# '));
  const text = line?.replace(/^#\s+/, '').trim();
  return text || undefined;
}

function frontmatterValue(body: string, key: string): string | undefined {
  if (!body.startsWith('---')) return undefined;
  const end = body.indexOf('\n---', 3);
  if (end === -1) return undefined;
  const line = body
    .slice(3, end)
    .split('\n')
    .find((l) => l.startsWith(`${key}:`));
  const value = line?.slice(key.length + 1).trim();
  return value || undefined;
}

function sortCommands(a: CommandEntry, b: CommandEntry): number {
  const priority = (name: string) => (
    name === 'match' ? 0
    : name === 'push' ? 1
    : 2
  );
  return priority(a.name) - priority(b.name) || a.name.localeCompare(b.name);
}

export async function readCommands(): Promise<CommandCatalog> {
  const [claude, codex, banana, assistantHubProject] = await Promise.all([
    markdownCommands(CLAUDE_COMMANDS_DIR),
    skillCommands(CODEX_SKILLS_DIR),
    markdownCommands(BANANA_COMMANDS_DIR),
    markdownCommands(join(ASSISTANT_HUB_PATH, '.claude', 'commands')),
  ]);
  return {
    claude,
    codex,
    banana: mergeCommandEntries(assistantHubProject, claude, banana),
  };
}
