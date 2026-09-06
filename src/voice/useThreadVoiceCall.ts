// Named teammate voice calls over the normal TARDIS Hall transport.
// Speech is only I/O: every utterance is a regular bot-* user turn, so the
// selected engine, tools, memory, teammate access, durable history, and UI
// transcript are identical to typed chat.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JarvisEngineSettings } from '../jarvis/protocol';
import { useJarvisSession, type JarvisCaption } from '../jarvis/useJarvisSession';
import type { Agent } from '../grok/agents';

export type ThreadCallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';
export type ThreadCallTurn = { role: 'user' | 'assistant'; text: string };

export function useThreadVoiceCall(agent: Agent, settings: JarvisEngineSettings, repoPath: string) {
  const [turns, setTurns] = useState<ThreadCallTurn[]>([]);
  const [liveUser, setLiveUser] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  const clockRef = useRef<number | null>(null);

  const onCaption = useCallback((caption: JarvisCaption) => {
    const text = caption.text.trim();
    if (!text) return;
    if (caption.role === 'user') {
      if (!caption.final) {
        setLiveUser(text);
        return;
      }
      setLiveUser('');
      setTurns((previous) => {
        const last = previous[previous.length - 1];
        return last?.role === 'user' && last.text === text
          ? previous
          : [...previous, { role: 'user', text }];
      });
      return;
    }
    if (!caption.final) return;
    setTurns((previous) => {
      const last = previous[previous.length - 1];
      return last?.role === 'assistant' && last.text === text
        ? previous
        : [...previous, { role: 'assistant', text }];
    });
  }, []);

  const session = useJarvisSession({
    onActivity: () => {},
    onClosed: () => {},
    onCaption,
  });

  useEffect(() => () => {
    if (clockRef.current !== null) window.clearInterval(clockRef.current);
  }, []);

  const start = useCallback(async () => {
    setTurns([]);
    setLiveUser('');
    setDurationSec(0);
    if (clockRef.current !== null) window.clearInterval(clockRef.current);
    clockRef.current = window.setInterval(() => setDurationSec((value) => value + 1), 1000);
    await session.start(settings, { agentId: agent.id, chatId: agent.home, repoPath });
  }, [agent.home, agent.id, repoPath, session.start, settings.cli, settings.effort, settings.model]);

  const end = useCallback(() => {
    if (clockRef.current !== null) {
      window.clearInterval(clockRef.current);
      clockRef.current = null;
    }
    session.hangup();
  }, [session.hangup]);

  const state: ThreadCallState = session.phase === 'initializing'
    ? 'connecting'
    : session.phase === 'idle' && durationSec > 0
      ? 'ended'
      : session.phase;

  return {
    state,
    turns,
    liveUser,
    durationSec,
    muted: session.muted,
    error: session.error,
    audioBlocked: session.audioBlocked,
    unlockAudio: session.unlockAudio,
    tools: session.tools,
    start,
    end,
    toggleMute: () => session.setMicMuted(!session.muted),
  };
}
