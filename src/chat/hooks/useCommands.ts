import { useEffect, useState } from 'react';
import type { CommandCatalog } from '../data/types';

const EMPTY_COMMANDS: CommandCatalog = { claude: [], codex: [] };

export function useCommands(): CommandCatalog {
  const [commands, setCommands] = useState<CommandCatalog>(EMPTY_COMMANDS);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/commands')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CommandCatalog) => {
        if (!cancelled) setCommands(data);
      })
      .catch(() => {
        if (!cancelled) setCommands(EMPTY_COMMANDS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return commands;
}
