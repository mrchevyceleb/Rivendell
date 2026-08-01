// Shared state + behavior for the reimagined chat shells (desktop Conversation
// + mobile Mobile). Owns theme, sticky-scroll + jump pill, spark bursts, the
// composer draft, the Hall/Council/Forge(/Files) room switch, chronicle + slash
// commands, and the wiring between the Composer and useChat. Both screens render
// against the same hook so behavior is identical across breakpoints.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompanionPicker } from '../../hooks/useCompanionPicker';
import type { ChatBlock, CommandEntry, Repo } from '../../data/types';
import type { SendImage } from './Composer';
import type { ChronicleEvent } from '../../data/mock';
import { useChat } from '../../hooks/useChat';
import { useTheme } from '../../hooks/useTheme';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import { useChronicle } from '../../hooks/useChronicle';
import { useCommands } from '../../hooks/useCommands';
import { useSparks } from './useSparks';

export type ChatApi = ReturnType<typeof useChat>;
export type RoomId = 'hall' | 'council' | 'forge' | 'files';
export type ShellState = ReturnType<typeof useChatShell>;

// Props for the presentational shells (Conversation / Mobile). The shell STATE
// is hoisted into Threshold so it survives a breakpoint cross.
export type ShellViewProps = {
  s: ShellState;
  picker: CompanionPicker;
  repo?: Repo;
  agent?: string;
};

export type ShellProps = {
  chat: ChatApi;
  picker: CompanionPicker;
  repo?: Repo;
  agent?: string;
};

export function useChatShell({ chat, picker }: ShellProps) {
  const { theme, toggle } = useTheme();
  const sticky = useStickyScroll();
  const sparks = useSparks();
  const [room, setRoom] = useState<RoomId>('hall');
  const [value, setValue] = useState('');
  const chronicle = useChronicle();
  const catalog = useCommands();

  const commands: CommandEntry[] = useMemo(() => {
    const seen = new Set<string>();
    const out: CommandEntry[] = [];
    for (const c of [...catalog.claude, ...catalog.codex, ...catalog.banana]) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        out.push(c);
      }
    }
    return out;
  }, [catalog]);

  const busy = chat.status === 'streaming';

  // A turn just completed (streaming → ready) and the user is scrolled up:
  // bump the jump-pill unread counter (§3.6). Depend on the stable noteUnread
  // callback, not the whole sticky object (which changes identity each render).
  const { noteUnread } = sticky;
  const prevStatus = useRef(chat.status);
  useEffect(() => {
    if (prevStatus.current === 'streaming' && chat.status !== 'streaming') {
      noteUnread();
    }
    prevStatus.current = chat.status;
  }, [chat.status, noteUnread]);

  const send = (text: string, images?: SendImage[]) => {
    chat.send(text, images);
    setRoom('hall');
    // §3.6: sending force-follows the feed.
    requestAnimationFrame(() => sticky.forcePin());
  };
  const steer = (text: string, images?: SendImage[]) => {
    chat.steer(text, images);
    requestAnimationFrame(() => sticky.forcePin());
  };
  const stop = () => chat.stop();

  const pickChronicle = (e: ChronicleEvent) => {
    setRoom('hall');
    setValue(`resume the errand: ${e.title}`);
  };
  const pickFile = (path: string) => {
    setRoom('hall');
    setValue((v) => `${v.replace(/\s+$/, '')} @${path} `.trimStart());
  };

  return {
    theme, toggle,
    sticky, sparks,
    room, setRoom,
    value, setValue,
    chronicle: chronicle.events,
    commands,
    busy,
    send, steer, stop,
    pickChronicle, pickFile,
    blocks: chat.blocks as ChatBlock[],
    status: chat.status,
    error: chat.error,
  };
}
