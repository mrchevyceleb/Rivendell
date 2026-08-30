// Bot-shell chat host — GrokApp's equivalent of the Studio's ChatTab.
// Owns the companion picker + useChat transport for one conversation
// (chatId), hoists useChatShell state, renders GrokConversation, and reports
// a ChatMeta snapshot up to the right pane (Session card: model, status,
// context meter, compaction).

import { useEffect, useRef } from 'react';
import { useChat } from '../chat/hooks/useChat';
import { useCompanionPicker } from '../chat/hooks/useCompanionPicker';
import { useChatShell } from '../chat/components/reimagine/useChatShell';
import { companionAgentLabel } from '../shell/studio/ChatTab';
import type { CompanionId, Repo } from '../chat/data/types';
import { GrokConversation } from './GrokConversation';
import type { ChatMeta } from './BotPanel';
import type { Agent } from './agents';
import { markAgentRead } from './agents';

export type GrokChatProps = {
  chatId: string;
  cli?: CompanionId;
  /** Persona lane id ('xai', 'claude-kim', …) — seeds the picker lane. */
  lane?: string;
  agent?: Agent;
  repo?: Repo;
  paneOpen: boolean;
  onTogglePane: () => void;
  onVoice: () => void;
  voiceActive: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenStudio: () => void;
  onOpenAgentEditor: () => void;
  onMeta: (meta: ChatMeta) => void;
};

export function GrokChat(props: GrokChatProps) {
  const { chatId, cli, lane, repo } = props;
  // Seed the picker lane SYNCHRONOUSLY (before the hook's useState initializer
  // reads localStorage) so persona threads never connect on the wrong lane.
  const storageKey = `rivendell:studio-companion:${chatId}`;
  const seededRef = useRef(false);
  if (!seededRef.current && typeof window !== 'undefined') {
    seededRef.current = true;
    const seed = lane ?? cli;
    if (seed) {
      try {
        if (localStorage.getItem(storageKey) !== seed) localStorage.setItem(storageKey, seed);
      } catch { /* storage unavailable — picker default wins */ }
    }
  }
  const picker = useCompanionPicker(storageKey);

  const chat = useChat({
    repo,
    cli: picker.cli,
    account: picker.account ?? undefined,
    chatId,
    enabled: Boolean(repo),
    model: picker.model,
    contextWindowTokens: picker.isLocal ? picker.localContextWindow : undefined,
    effort: picker.effort,
  });

  // Esc stops a streaming turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && chat.status === 'streaming') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
        chat.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat.status, chat.stop]);

  const s = useChatShell({ chat, picker });

  // Report the Session-card snapshot upward. compactingRef is a ref, so poll
  // it lightly while the session is live.
  const onMeta = props.onMeta;
  const agentLabel = props.agent?.name ?? companionAgentLabel(picker.cli);
  useEffect(() => {
    const report = () => {
      onMeta({
        agentLabel,
        model: picker.model ?? null,
        status: chat.status,
        fraction: chat.usage?.fraction,
        compacting: Boolean(chat.compactingRef?.current),
      });
    };
    report();
    const iv = window.setInterval(report, 1500);
    return () => window.clearInterval(iv);
  }, [onMeta, agentLabel, picker.model, chat.status, chat.usage?.fraction, chat.compactingRef]);

  // Unread badge hygiene: while this agent's thread is focused, keep the
  // server's read marker at the log head so only unfocused agents light up.
  useEffect(() => {
    if (!props.agent) return;
    const agentId = props.agent.id;
    const post = () => {
      // Only a VISIBLE, FOCUSED tab counts as "reading" — a backgrounded tab
      // must not silently clear the unread badge for replies it never showed.
      if (document.visibilityState === 'visible' && document.hasFocus()) void markAgentRead(agentId);
    };
    const t = window.setTimeout(post, 1200); // let the WS replay land first
    const iv = window.setInterval(post, 5000);
    return () => { window.clearTimeout(t); window.clearInterval(iv); };
  }, [props.agent?.id]);

  return (
    <GrokConversation
      s={s}
      picker={picker}
      repo={repo}
      agent={agentLabel}
      agentRecord={props.agent}
      paneOpen={props.paneOpen}
      onTogglePane={props.onTogglePane}
      onVoice={props.onVoice}
      voiceActive={props.voiceActive}
      theme={props.theme}
      onToggleTheme={props.onToggleTheme}
      onOpenStudio={props.onOpenStudio}
      onOpenAgentEditor={props.onOpenAgentEditor}
    />
  );
}
