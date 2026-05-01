import { useEffect, useRef } from 'react';
import { SamPortrait, Dinkus, Chip } from '../primitives/atoms';
import {
  SamMessage,
  UserMessage,
  ToolCall,
  ChatInput,
} from '../primitives/chat';
import { Markdown } from '../primitives/Markdown';
import type { ChatBlock, CommandEntry } from '../../data/types';

type Status = 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';

type ConversationProps = {
  agent?: string;
  repo?: string;
  title?: string;
  blocks: ChatBlock[];
  status: Status;
  errorText?: string | null;
  usage?: { inputTokens: number; cacheReadTokens: number; cacheCreateTokens: number; fraction: number; windowTokens: number } | null;
  commands?: CommandEntry[];
  commandPrefix?: string;
  onSend?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onSteer?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onBack?: () => void;
  onFreshStart?: () => void;
  onStop?: () => void;
  acceptImages?: boolean;
};

const statusToneByStatus: Record<Status, 'ember' | 'moss' | 'gold' | 'neutral'> = {
  idle: 'neutral',
  connecting: 'gold',
  ready: 'moss',
  streaming: 'ember',
  closed: 'neutral',
  error: 'gold',
};

const statusLabel: Record<Status, string> = {
  idle: 'idle',
  connecting: 'kindling',
  ready: 'at hand',
  streaming: 'tending',
  closed: 'asleep',
  error: 'troubled',
};

export function Conversation({
  agent = 'Claude Code',
  repo = '',
  title = 'a fresh errand',
  blocks,
  status,
  errorText,
  usage,
  commands = [],
  commandPrefix = '/',
  onSend,
  onSteer,
  onBack,
  onFreshStart,
  onStop,
  acceptImages = true,
}: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  // Pin to bottom on every blocks update unless the user has scrolled up.
  // Two layers: scrollIntoView on a sentinel covers most cases, and an rAF
  // pass after that catches the case where layout hadn't finished when
  // useEffect first ran.
  useEffect(() => {
    if (!stickyRef.current) return;
    const pin = () => {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    pin();
    const id = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(id);
  }, [blocks, status]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distanceFromBottom < 120;
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--vellum)',
        minWidth: 0,
      }}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="sw-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '28px 0 0',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 48px' }}>
          <div
            style={{
              textAlign: 'center',
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <SamPortrait size={44} />
          </div>
          <div className="sw-folio" style={{ textAlign: 'center', marginBottom: 8, fontSize: 13 }}>
            errand · {todayLabel()}
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--serif-display)',
              fontSize: 48,
              fontWeight: 500,
              color: 'var(--ink)',
              textAlign: 'center',
              lineHeight: 1.05,
            }}
          >
            <span style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>Of </span>
            {title}
          </h1>
          <div
            style={{
              textAlign: 'center',
              marginTop: 12,
              display: 'flex',
              justifyContent: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <Chip dot tone={statusToneByStatus[status]}>
              {statusLabel[status]}
            </Chip>
            <Chip tone="neutral">{agent.toLowerCase()}</Chip>
            {repo && <Chip tone="neutral">{repo}</Chip>}
          </div>
          {(onBack || onFreshStart || usage || (onStop && status === 'streaming')) && (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              {onBack && (
                <button
                  onClick={onBack}
                  className="sw-btn"
                  style={{
                    fontSize: 12.5,
                    padding: '4px 12px',
                    minHeight: 0,
                    fontFamily: 'var(--serif-display)',
                    fontStyle: 'italic',
                    color: 'var(--ember)',
                  }}
                >
                  the threshold
                </button>
              )}
              {usage && (
                <ContextMeter
                  fraction={usage.fraction}
                  inputTokens={usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens}
                  windowTokens={usage.windowTokens}
                />
              )}
              {onStop && status === 'streaming' && (
                <button
                  onClick={onStop}
                  title="stop the in-flight turn (next message will resume the conversation)"
                  className="sw-btn sw-btn-ember"
                  style={{ fontSize: 12.5, padding: '4px 12px', minHeight: 0 }}
                >
                  stop
                </button>
              )}
              {onFreshStart && (
                <button
                  onClick={onFreshStart}
                  title="kill the warm process, drop saved memory, start a new thread"
                  className="sw-btn"
                  style={{
                    fontSize: 12.5,
                    padding: '4px 12px',
                    minHeight: 0,
                    fontFamily: 'var(--serif-display)',
                    fontStyle: 'italic',
                    color: 'var(--ink-soft)',
                  }}
                >
                  fresh thread
                </button>
              )}
            </div>
          )}
          <div className="sw-ornament" style={{ margin: '32px 0 36px' }}>
            <Dinkus />
          </div>

          {blocks.length === 0 && status !== 'streaming' && (
            <p
              style={{
                fontFamily: 'var(--serif-display)',
                fontStyle: 'italic',
                color: 'var(--ink-faint)',
                textAlign: 'center',
                margin: '32px 0',
              }}
            >
              Speak, master, and I shall set forth.
            </p>
          )}

          {renderBlocks(blocks)}

          {status === 'streaming' && blocks.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span className="sw-thinking">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}

          {errorText && (
            <p
              style={{
                fontFamily: 'var(--serif-body)',
                fontStyle: 'italic',
                color: 'var(--ember)',
                textAlign: 'center',
                margin: '12px 0',
              }}
            >
              {errorText}
            </p>
          )}

          <div style={{ height: 28 }} />
          <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
        </div>
      </div>

      <div
        style={{
          padding: '18px 0 26px',
          borderTop: '1px solid var(--rule-soft)',
          background: 'var(--vellum)',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 48px' }}>
          <ChatInput
            agent={agent}
            repo={repo}
            placeholder="speak, master…"
            onSend={onSend}
            onSteer={onSteer}
            onBack={onBack}
            commands={commands}
            commandPrefix={commandPrefix}
            busy={status === 'streaming'}
            acceptImages={acceptImages}
          />
        </div>
      </div>
    </div>
  );
}

function renderBlocks(blocks: ChatBlock[]) {
  return blocks.map((b) => {
    if (b.kind === 'user') {
      return (
        <UserMessage key={b.id} time={timeLabel(b.ts)}>
          {b.text}
        </UserMessage>
      );
    }
    if (b.kind === 'text') {
      return (
        <SamMessage key={b.id} time={timeLabel(b.ts)}>
          <Markdown>{b.text}</Markdown>
        </SamMessage>
      );
    }
    // tool
    return (
      <SamMessage key={b.id} time={timeLabel(b.ts)}>
        <ToolCall
          tool={b.tool}
          args={b.args}
          result={b.result}
          running={b.running}
          status={b.running ? 'running' : 'done'}
        />
      </SamMessage>
    );
  });
}

function ContextMeter({
  fraction,
  inputTokens,
  windowTokens,
}: { fraction: number; inputTokens: number; windowTokens: number }) {
  const tone =
    fraction < 0.5 ? 'var(--moss)'
    : fraction < 0.8 ? 'var(--gold)'
    : 'var(--ember)';
  return (
    <span
      title={`${inputTokens.toLocaleString()} of ${windowTokens.toLocaleString()} tokens used`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <span
        style={{
          width: 56,
          height: 4,
          borderRadius: 2,
          background: 'var(--rule-soft)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${Math.round(fraction * 100)}%`,
            height: '100%',
            background: tone,
            transition: 'width 0.3s',
          }}
        />
      </span>
      <span className="sw-folio" style={{ fontStyle: 'italic', whiteSpace: 'nowrap' }}>
        {formatTokens(inputTokens)} / {formatTokens(windowTokens)}
      </span>
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayLabel(): string {
  const d = new Date();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const ord = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  return `the ${ord(d.getDate())} of ${months[d.getMonth()]}`;
}
