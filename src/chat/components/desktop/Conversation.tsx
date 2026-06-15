import { useEffect, useState } from 'react';
import { SamPortrait, Dinkus, Chip } from '../primitives/atoms';
import {
  SamMessage,
  UserMessage,
  ToolCall,
  ChatInput,
} from '../primitives/chat';
import { Markdown } from '../primitives/Markdown';
import { ArtifactCard } from '../blocks/ArtifactCard';
import { DocLinkCard } from '../blocks/DocLinkCard';
import { FolderLinkCard } from '../blocks/FolderLinkCard';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import type { ChatBlock, CommandEntry } from '../../data/types';
import type { CommandSet } from '../../utils/commandAutocomplete';

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
  commandSets?: CommandSet[];
  onSend?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onSteer?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onBack?: () => void;
  onFreshStart?: () => void;
  onStop?: () => void;
  acceptImages?: boolean;
  /** Slim layout for embedding in a narrow side panel (e.g. the Workspace
   *  room). Drops the full-page hero (portrait, giant headline, date) and
   *  tightens horizontal padding so the chat fits a ~380px column. */
  compact?: boolean;
  /** Live-activity refs from useChat — power the "working" banner so the user
   *  can tell active work (and compaction) from a hang. */
  lastActivityRef?: { current: number };
  turnStartRef?: { current: number };
  compactingRef?: { current: boolean };
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
  closed: 'reconnecting',
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
  commandSets,
  onSend,
  onSteer,
  onBack,
  onFreshStart,
  onStop,
  acceptImages = true,
  compact = false,
  lastActivityRef,
  turnStartRef,
  compactingRef,
}: ConversationProps) {
  const { scrollRef, bottomRef, contentRef, onScroll } = useStickyScroll();
  const sidePad = compact ? '0 16px' : '0 48px';
  const contentMax = compact ? 'none' : 760;

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
        <div ref={contentRef} style={{ maxWidth: contentMax, margin: '0 auto', padding: sidePad }}>
          {!compact && (
            <>
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
            </>
          )}
          <div
            style={{
              textAlign: 'center',
              marginTop: compact ? 0 : 12,
              marginBottom: compact ? 4 : 0,
              display: 'flex',
              justifyContent: compact ? 'flex-start' : 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Chip dot tone={statusToneByStatus[status]}>
              {statusLabel[status]}
            </Chip>
            <Chip tone="neutral">{agent.toLowerCase()}</Chip>
            {repo && !compact && <Chip tone="neutral">{repo}</Chip>}
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
          {!compact && (
            <div className="sw-ornament" style={{ margin: '32px 0 36px' }}>
              <Dinkus />
            </div>
          )}

          {blocks.length === 0 && status !== 'streaming' && (
            <p
              style={{
                fontFamily: 'var(--serif-display)',
                fontStyle: 'italic',
                color: 'var(--ink-faint)',
                textAlign: 'center',
                margin: compact ? '24px 0' : '32px 0',
                fontSize: compact ? 15 : undefined,
              }}
            >
              Speak, master, and I shall set forth.
            </p>
          )}

          {renderBlocks(blocks, agent)}

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

      <ActiveToolBanner
        blocks={blocks}
        streaming={status === 'streaming'}
        lastActivityRef={lastActivityRef}
        turnStartRef={turnStartRef}
        compactingRef={compactingRef}
      />

      <div
        style={{
          padding: compact ? '12px 0 16px' : '18px 0 26px',
          borderTop: '1px solid var(--rule-soft)',
          background: 'var(--vellum)',
        }}
      >
        <div style={{ maxWidth: contentMax, margin: '0 auto', padding: sidePad }}>
          {(usage || onFreshStart || (onStop && status === 'streaming')) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              {usage && (
                <ContextMeter
                  fraction={usage.fraction}
                  inputTokens={usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens}
                  windowTokens={usage.windowTokens}
                />
              )}
              <span style={{ marginLeft: 'auto' }} />
              {onStop && status === 'streaming' && (
                <button
                  onClick={onStop}
                  title="Stop generating"
                  className="sw-btn sw-btn-ember"
                  style={{ fontSize: 12, padding: '4px 12px', minHeight: 0 }}
                >
                  stop
                </button>
              )}
              {onFreshStart && (
                <button
                  onClick={onFreshStart}
                  title="Start a new thread"
                  className="sw-btn"
                  style={{ fontSize: 12, padding: '4px 12px', minHeight: 0, fontFamily: 'var(--serif-display)', fontStyle: 'italic', color: 'var(--ink-soft)' }}
                >
                  fresh thread
                </button>
              )}
            </div>
          )}
          <ChatInput
            compact={compact}
            agent={agent}
            repo={repo}
            placeholder="speak, master…"
            onSend={onSend}
            onSteer={onSteer}
            onBack={onBack}
            commands={commands}
            commandPrefix={commandPrefix}
            commandSets={commandSets}
            busy={status === 'streaming'}
            acceptImages={acceptImages}
          />
        </div>
      </div>
    </div>
  );
}

function renderBlocks(blocks: ChatBlock[], agent: string) {
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
        <SamMessage key={b.id} name={agent} time={timeLabel(b.ts)}>
          <Markdown>{b.text}</Markdown>
        </SamMessage>
      );
    }
    if (b.kind === 'doc-link') {
      return (
        <SamMessage key={b.id} name={agent} time={timeLabel(b.ts)}>
          <DocLinkCard path={b.path} title={b.title} />
        </SamMessage>
      );
    }
    if (b.kind === 'folder-link') {
      return (
        <SamMessage key={b.id} name={agent} time={timeLabel(b.ts)}>
          <FolderLinkCard path={b.path} title={b.title} />
        </SamMessage>
      );
    }
    if (b.kind === 'artifact') {
      return (
        <SamMessage key={b.id} name={agent} time={timeLabel(b.ts)}>
          <ArtifactCard artifactId={b.artifactId} artifactKind={b.artifactKind} title={b.title} />
        </SamMessage>
      );
    }
    return (
      <SamMessage key={b.id} name={agent} time={timeLabel(b.ts)}>
        <ToolCall
          tool={b.tool}
          args={b.args}
          result={b.result}
          running={b.running}
          status={b.running ? 'running' : 'done'}
          startedAt={b.ts}
        />
      </SamMessage>
    );
  });
}

function ActiveToolBanner({
  blocks,
  streaming,
  lastActivityRef,
  turnStartRef,
  compactingRef,
}: {
  blocks: ChatBlock[];
  streaming: boolean;
  lastActivityRef?: { current: number };
  turnStartRef?: { current: number };
  compactingRef?: { current: boolean };
}) {
  // Tick every second while streaming so the timer is visibly alive and the
  // "last reply Ns ago" gap updates even during a silent phase (compaction,
  // a slow tool, model thinking) — the thing that used to look like a hang.
  const [, force] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [streaming]);
  if (!streaming) return null;

  const now = Date.now();
  const last = blocks.length ? blocks[blocks.length - 1] : null;
  const activeTool = last && last.kind === 'tool' && last.running ? last : null;
  const writing = !!(last && last.kind === 'text' && 'open' in last && last.open);
  const compacting = compactingRef?.current ?? false;

  // Elapsed: the tool's own runtime when a tool is active, else the whole turn.
  const turnStart = turnStartRef?.current || 0;
  const elapsed = activeTool
    ? Math.max(0, Math.floor((now - activeTool.ts) / 1000))
    : turnStart
      ? Math.max(0, Math.floor((now - turnStart) / 1000))
      : 0;

  // Seconds since the last real server event — the true liveness signal. Tool
  // runs are expected to be quiet, so only flag the gap outside a tool.
  const sinceActivity = lastActivityRef?.current
    ? Math.max(0, Math.floor((now - lastActivityRef.current) / 1000))
    : 0;
  const quiet = !activeTool && sinceActivity >= 4;

  const label = compacting
    ? 'compacting context'
    : activeTool
      ? `running ${activeTool.tool}`
      : writing
        ? 'writing'
        : 'thinking';
  const elapsedLabel = elapsed ? ` · ${formatElapsedShort(elapsed)}` : '';
  const quietLabel = quiet && !compacting ? ` · last reply ${formatElapsedShort(sinceActivity)} ago` : '';
  const isSlow = (activeTool && elapsed >= 8) || (quiet && sinceActivity >= 12);
  return (
    <div
      style={{
        padding: '6px 0',
        background: isSlow
          ? 'color-mix(in srgb, var(--ember) 10%, var(--vellum))'
          : 'color-mix(in srgb, var(--ember) 5%, var(--vellum))',
        borderTop: '1px solid color-mix(in srgb, var(--ember) 25%, transparent)',
        textAlign: 'center',
        transition: 'background 200ms ease',
      }}
      aria-live="polite"
    >
      <span
        className="sw-smallcaps"
        style={{
          fontSize: 11,
          color: isSlow ? 'var(--ember)' : 'var(--ink-soft)',
          letterSpacing: '0.1em',
          fontWeight: isSlow ? 600 : 500,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}{elapsedLabel}{quietLabel}
      </span>
      <span className="sw-thinking" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
        <span></span>
        <span></span>
        <span></span>
      </span>
    </div>
  );
}

function formatElapsedShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
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
