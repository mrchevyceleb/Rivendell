import { useEffect, useMemo } from 'react';
import { CompanionControls } from '../../chat/components/CompanionControls';
import { Conversation } from '../../chat/components/desktop/Conversation';
import { useChat } from '../../chat/hooks/useChat';
import { useCompanionPicker } from '../../chat/hooks/useCompanionPicker';
import type { Repo } from '../../chat/data/types';
import type { FileTreeNode } from '../../data/types';
import { useWorkspaceTree } from '../../hooks/useRoomData';

// Flatten the (already-loaded) workspace tree into a sorted list of relative
// paths for `@`-path autocomplete in the composer. The tree is fetched once and
// cached by TanStack Query, so calling useWorkspaceTree here is a shared read.
function flattenTreePaths(node: FileTreeNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.path) out.push(node.path);
  node.children?.forEach((child) => flattenTreePaths(child, out));
  return out;
}

export function companionAgentLabel(cli: string): string {
  switch (cli) {
    case 'assistant': return 'Elrond';
    case 'claude': return 'Personal Claude';
    case 'codex': return 'Codex';
    case 'codex-personal': return 'Personal Codex';
    case 'banana': return 'OpenRouter';
    case 'banana-local': return 'Local';
    case 'banana-fireworks': return 'Fireworks';
    case 'zai': return 'GLM';
    default: return cli;
  }
}

export type ChatTabApi = { send: (message: string) => void; companionLabel: string };

export function ChatTab({
  chatId,
  repo,
  registerApi,
}: {
  chatId: string;
  repo?: Repo;
  registerApi: (chatId: string, api: ChatTabApi | null) => void;
}) {
  const picker = useCompanionPicker(`rivendell:studio-companion:${chatId}`);
  const tree = useWorkspaceTree();
  const pathSuggestions = useMemo(
    () => flattenTreePaths(tree.data?.tree).sort((a, b) => a.localeCompare(b)),
    [tree.data],
  );

  const chat = useChat({
    repo,
    cli: picker.cli,
    chatId,
    enabled: Boolean(repo),
    model: picker.model,
    effort: picker.effort,
  });

  // Publish this tab's send() so the shell (file "Ask Elrond", tree) can reach it.
  useEffect(() => {
    registerApi(chatId, { send: chat.send, companionLabel: companionAgentLabel(picker.companion) });
    return () => registerApi(chatId, null);
  }, [chatId, chat.send, picker.companion, registerApi]);

  return (
    <div className="studio-chattab">
      <CompanionControls picker={picker} />
      <Conversation
        compact
        agent={companionAgentLabel(picker.companion)}
        repo={repo?.name}
        title="thread"
        blocks={chat.blocks}
        status={chat.status}
        usage={chat.usage}
        errorText={chat.error}
        onSend={chat.send}
        onSteer={chat.steer}
        onStop={chat.stop}
        onFreshStart={chat.freshStart}
        pathSuggestions={pathSuggestions}
        acceptImages
        lastActivityRef={chat.lastActivityRef}
        turnStartRef={chat.turnStartRef}
        compactingRef={chat.compactingRef}
      />
    </div>
  );
}
