import { useEffect } from 'react';
import { CompanionControls } from '../../chat/components/CompanionControls';
import { Conversation } from '../../chat/components/desktop/Conversation';
import { useChat } from '../../chat/hooks/useChat';
import { useCompanionPicker } from '../../chat/hooks/useCompanionPicker';
import type { Repo } from '../../chat/data/types';

export function companionAgentLabel(cli: string): string {
  switch (cli) {
    case 'assistant': return 'Elrond';
    case 'claude': return 'Personal Claude';
    case 'codex': return 'Codex';
    case 'codex-personal': return 'Personal Codex';
    case 'banana': return 'OpenRouter';
    case 'banana-local': return 'Local';
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
        acceptImages={false}
      />
    </div>
  );
}
