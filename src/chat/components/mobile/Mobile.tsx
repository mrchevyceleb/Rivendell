import { useEffect, useRef, useState } from 'react';
import { SamPortrait, Dinkus, Chip, SearchGlyph } from '../primitives/atoms';
import {
  SamMessage,
  UserMessage,
  ToolCall,
} from '../primitives/chat';
import { Markdown } from '../primitives/Markdown';
import { ArtifactCard } from '../blocks/ArtifactCard';
import { DocLinkCard } from '../blocks/DocLinkCard';
import { FolderLinkCard } from '../blocks/FolderLinkCard';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import { commandText, getCommandSuggestion, getCommandSuggestionMulti, type CommandSet } from '../../utils/commandAutocomplete';

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function MobileGrowingInput({
  value,
  onChange,
  onSubmit,
  commandPrefix,
  commands,
  commandSets,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  commandPrefix: string;
  commands: CommandEntry[];
  commandSets?: CommandSet[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const suggestion = commandSets && commandSets.length
    ? getCommandSuggestionMulti(value, commandSets)
    : getCommandSuggestion(value, commandPrefix, commands);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const acceptSuggestion = () => {
    if (!suggestion) return;
    onChange(suggestion.fullText);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(suggestion.fullText.length, suggestion.fullText.length);
    });
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        {suggestion && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              fontFamily: 'var(--serif-body)',
              fontStyle: value ? 'normal' : 'italic',
              color: 'transparent',
              fontSize: 19,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            <span>{value}</span>
            <span style={{ color: 'var(--ink-faint)' }}>{suggestion.tail}</span>
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (suggestion && (e.key === 'Tab' || e.key === 'ArrowRight')) {
              e.preventDefault();
              acceptSuggestion();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="speak, master..."
          rows={1}
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--serif-body)',
            fontStyle: value ? 'normal' : 'italic',
            color: value ? 'var(--ink)' : 'var(--ink-faint)',
            fontSize: 19,
            resize: 'none',
            maxHeight: '35dvh',
            overflowY: 'auto',
            lineHeight: 1.45,
            minWidth: 0,
            padding: 0,
          }}
        />
      </div>
      {suggestion && (
        <button
          onClick={acceptSuggestion}
          style={{
            marginTop: 4,
            border: 0,
            background: 'transparent',
            color: 'var(--ink-soft)',
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            fontSize: 12,
            padding: 0,
          }}
        >
          {commandText(suggestion.prefix, suggestion.command.name)}
        </button>
      )}
    </div>
  );
}
import {
  COMPANIONS,
  SPECIAL_REPOS,
  HUBS,
  STATS,
  CHRONICLE,
  ASSISTANT_HUB,
  type CompanionId,
  type Repo,
  type Hub,
  type ChronicleEvent,
  type ChronicleEventKind,
} from '../../data/mock';
import type { CommandEntry, LiveSession } from '../../data/types';

const COMPANION_LABEL: Record<CompanionId, string> = {
  claude: 'claude',
  codex: 'codex',
  assistant: 'assistant',
  banana: 'banana',
  'banana-local': 'banana',
  'banana-fireworks': 'fireworks',
  zai: 'glm',
  xai: 'grok',
};

// ─── Mobile Threshold ───
export function MobileThreshold({
  repos,
  reposLoading,
  onSetForth,
  liveSessions = [],
  onSelectLive,
  theme = 'light',
  onToggleTheme,
}: {
  repos: Repo[];
  reposLoading?: boolean;
  onSetForth: (params: {
    companion: CompanionId;
    repo?: Repo;
    initialMessage?: string;
  }) => void;
  liveSessions?: LiveSession[];
  onSelectLive?: (s: LiveSession) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}) {
  const [companion, setCompanion] = useState<CompanionId>('claude');
  const liveAssistantHub = repos.find((r) => r.isAssistantHub) ?? ASSISTANT_HUB;
  const regularRepos = repos.filter((r) => !r.isAssistantHub);
  const [selectedRepo, setSelectedRepo] = useState<Repo | undefined>(undefined);
  const [query, setQuery] = useState('');
  const defaultRepo = regularRepos[0];

  const pickCompanion = (id: CompanionId) => {
    setCompanion(id);
    if (id === 'assistant') setSelectedRepo(liveAssistantHub);
  };

  const effectiveRepo = companion === 'assistant' ? liveAssistantHub : selectedRepo ?? defaultRepo;
  const selectedRepoPath = effectiveRepo?.path;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 22px 24px',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
          style={{
            position: 'absolute',
            top: 16,
            right: 18,
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--rule-soft)',
            background: 'var(--vellum)',
            color: 'var(--ink-soft)',
            fontFamily: 'var(--serif-display)',
            fontSize: 16,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      )}
      <div
        style={{
          padding: 5,
          background: 'var(--vellum)',
          border: '1px solid var(--rule)',
          borderRadius: '50%',
          boxShadow: '0 1px 0 var(--shadow-warm), 0 0 28px rgba(184,89,58,0.10)',
          marginBottom: 16,
        }}
      >
        <SamPortrait size={88} ring={false} />
      </div>
      <div className="sw-folio" style={{ marginBottom: 6, letterSpacing: '0.18em', fontSize: 11 }}>
        · vol. ii ·
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: 'var(--serif-display)',
          fontSize: 64,
          fontWeight: 500,
          lineHeight: 0.95,
          color: 'var(--ink)',
          letterSpacing: 0,
        }}
      >
        Samwise
      </h1>
      <p
        style={{
          margin: '14px 0 0',
          fontFamily: 'var(--serif-display)',
          fontStyle: 'italic',
          fontSize: 22,
          color: 'var(--ink-soft)',
          textAlign: 'center',
          maxWidth: 340,
        }}
      >
        At your service, master.
        <span style={{ color: 'var(--ink-faint)' }}> Whither this morning?</span>
      </p>

      <div style={{ display: 'flex', gap: 14, marginTop: 26, alignItems: 'center' }}>
        <PStat n={STATS.underway} l="underway" tone="ember" />
        <span style={{ width: 1, height: 38, background: 'var(--rule-soft)' }} />
        <PStat n={STATS.awaits} l="awaits" tone="gold" />
        <span style={{ width: 1, height: 38, background: 'var(--rule-soft)' }} />
        <PStat n={STATS.finished} l="finished" tone="moss" />
      </div>

      {/* Live sessions — Sam may still have another errand warm. Tap to hop
          back in. Hidden when there's nothing running so the threshold stays
          clean for the common case. */}
      {liveSessions.length > 0 && (
        <div
          style={{
            width: '100%',
            marginTop: 18,
            background: 'var(--vellum)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            boxShadow: '0 1px 0 var(--shadow-warm)',
            overflow: 'hidden',
          }}
        >
          <div
            className="sw-smallcaps"
            style={{
              fontSize: 9.5,
              padding: '10px 14px 4px',
              color: 'var(--ember)',
              letterSpacing: '0.18em',
            }}
          >
            · awake now ·
          </div>
          {liveSessions.map((s) => (
            <div
              key={`${s.cli}|${s.cwd}`}
              onClick={() => onSelectLive?.(s)}
              style={{
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                background: s.busy ? 'rgba(184,89,58,0.10)' : 'transparent',
                borderTop: '1px solid var(--rule-soft)',
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: 'var(--ember)',
                  flexShrink: 0,
                  animation: s.busy ? 'sw-pulse 1.4s infinite' : 'none',
                  opacity: s.busy ? 1 : 0.5,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--serif-display)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.repoName}
                </div>
                <div
                  className="sw-mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--ink-faint)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {COMPANION_LABEL[s.cli]}{s.busy ? ' · tending' : ' · idle'}
                </div>
              </div>
              <span
                className="sw-folio"
                style={{
                  fontStyle: 'italic',
                  color: 'var(--ember)',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                rejoin →
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Palette card */}
      <div
        style={{
          width: '100%',
          marginTop: 26,
          background: 'var(--vellum)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          boxShadow: '0 1px 0 var(--shadow-warm)',
          overflow: 'hidden',
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!query.trim()) return;
            const text = query.trim();
            setQuery('');
            onSetForth({ companion, repo: effectiveRepo, initialMessage: text });
          }}
          style={{
            padding: '16px 16px',
            borderBottom: '1px solid var(--rule-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minHeight: 48,
            margin: 0,
          }}
        >
          <SearchGlyph size={16} />
          <input
            type="search"
            enterKeyHint="send"
            inputMode="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="speak, or pick below…"
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--serif-display)',
              fontStyle: query ? 'normal' : 'italic',
              fontSize: 21,
              color: query ? 'var(--ink)' : 'var(--ink-faint)',
            }}
          />
        </form>

        <div style={{ padding: '14px 16px 8px' }}>
          <PSectionLabel folio="i" label="your companion" />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {COMPANIONS.map((c) => (
              <PCompanion
                key={c.id}
                name={c.name}
                selected={c.id === companion}
                onSelect={() => pickCompanion(c.id)}
              />
            ))}
          </div>
        </div>
        <hr style={{ border: 0, height: 1, background: 'var(--rule-soft)', margin: 0 }} />
        <div style={{ padding: '14px 16px 10px' }}>
          <PSectionLabel
            folio="ii"
            label={
              companion === 'assistant' ? 'tending the hub' : 'where shall we work?'
            }
          />
          {companion === 'assistant' ? (
            <div
              style={{
                padding: '6px 8px',
                borderLeft: '2px solid var(--ember)',
                background: 'rgba(184,89,58,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                className="sw-mono"
                style={{
                  fontSize: 12,
                  color: 'var(--ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                ASSISTANT-HUB
              </span>
              <span
                className="sw-mono"
                style={{ fontSize: 10, color: 'var(--ember)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                · master
              </span>
              <span
                className="sw-folio"
                style={{ whiteSpace: 'nowrap', flexShrink: 0, fontStyle: 'italic' }}
              >
                always at hand
              </span>
            </div>
          ) : reposLoading && regularRepos.length === 0 ? (
            <div
              className="sw-folio"
              style={{ padding: '6px 4px', fontStyle: 'italic' }}
            >
              scanning the shelves…
            </div>
          ) : (
            <>
              {regularRepos.map((r) => (
                <PRepo
                  key={r.path}
                  repo={r}
                  selected={r.path === selectedRepoPath}
                  onClick={() => setSelectedRepo(r)}
                />
              ))}
              {SPECIAL_REPOS.map((r) => (
                <PRepo
                  key={r.path}
                  repo={r}
                  selected={false}
                  onClick={() => setSelectedRepo(undefined)}
                />
              ))}
            </>
          )}
        </div>

        <div
          style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--rule-soft)',
            background: 'var(--parchment-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span className="sw-folio" style={{ fontStyle: 'italic', fontSize: 12 }}>
            tap to set forth
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            className="sw-btn sw-btn-primary"
            onClick={() => {
              const text = query.trim();
              setQuery('');
              onSetForth({
                companion,
                repo: effectiveRepo,
                initialMessage: text || undefined,
              });
            }}
            style={{
              fontSize: 16,
              padding: '12px 22px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              minHeight: 46,
            }}
          >
            Set forth ↵
          </button>
        </div>
      </div>

      {/* Hubs */}
      <div
        style={{
          width: '100%',
          marginTop: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span className="sw-smallcaps" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          or, a hub
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--rule-soft)' }} />
        <span className="sw-folio" style={{ fontStyle: 'italic' }}>
          iii
        </span>
      </div>
      <div
        style={{
          width: '100%',
          marginTop: 10,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {HUBS.map((h) => (
          <PPill key={h.name} hub={h} />
        ))}
      </div>
    </div>
  );
}

// ─── Mobile Conversation ───
export function MobileConversation({
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
  onBack,
  onOpenChronicle,
  onSend,
  onSteer,
  onFreshStart,
  onStop,
  acceptImages = true,
}: {
  agent?: string;
  repo?: string;
  title?: string;
  blocks: import('../../data/types').ChatBlock[];
  status: 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';
  errorText?: string | null;
  usage?: { fraction: number; inputTokens: number; cacheReadTokens: number; cacheCreateTokens: number; windowTokens: number } | null;
  commands?: CommandEntry[];
  commandPrefix?: string;
  commandSets?: CommandSet[];
  onBack: () => void;
  onOpenChronicle: () => void;
  onSend?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onSteer?: (message: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onFreshStart?: () => void;
  onStop?: () => void;
  acceptImages?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; mediaType: string; base64: string; previewUrl: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const { scrollRef, bottomRef, contentRef, onScroll } = useStickyScroll();
  const [composerHeight, setComposerHeight] = useState(132);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setComposerHeight(Math.ceil(el.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ingestFiles = async (files: FileList | File[]) => {
    if (!acceptImages) return;
    const next: Array<{ id: string; mediaType: string; base64: string; previewUrl: string }> = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const base64 = btoa(bin);
      next.push({
        id: `img${Math.random().toString(36).slice(2, 8)}`,
        mediaType: f.type,
        base64,
        previewUrl: URL.createObjectURL(f),
      });
    }
    if (next.length) setPendingImages((prev) => [...prev, ...next]);
  };

  const removeImage = (id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const submit = () => {
    if (!draft.trim() && pendingImages.length === 0) return;
    const imgs = pendingImages.length
      ? pendingImages.map((i) => ({ mediaType: i.mediaType, base64: i.base64 }))
      : undefined;
    if (status === 'streaming' && onSteer) {
      onSteer(draft, imgs);
    } else {
      onSend?.(draft, imgs);
    }
    for (const i of pendingImages) URL.revokeObjectURL(i.previewUrl);
    setPendingImages([]);
    setDraft('');
  };

  const sendCommand = (name: string) => {
    const text = commandText(commandPrefix, name);
    if (status === 'streaming' && onSteer) onSteer(text);
    else onSend?.(text);
  };

  const statusLabel: Record<typeof status, string> = {
    idle: 'idle',
    connecting: 'kindling',
    ready: 'at hand',
    streaming: 'tending',
    closed: 'asleep',
    error: 'troubled',
  };
  const statusTone: Record<typeof status, 'ember' | 'moss' | 'gold' | 'neutral'> = {
    idle: 'neutral',
    connecting: 'gold',
    ready: 'moss',
    streaming: 'ember',
    closed: 'neutral',
    error: 'gold',
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--parchment)',
        position: 'relative',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 18px 12px',
          borderBottom: '1px solid var(--rule-soft)',
          background: 'var(--vellum)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 52,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 0,
            padding: '8px 4px',
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            fontSize: 16,
            color: 'var(--ember)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          ← errands
        </button>
        <SamPortrait size={28} />
        <span
          style={{
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            fontSize: 16,
            color: 'var(--ink-2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {title}
        </span>
        <Chip dot tone={statusTone[status]}>
          {statusLabel[status]}
        </Chip>
        {onFreshStart && (
          <button
            onClick={onFreshStart}
            title="fresh thread"
            aria-label="start a fresh thread"
            style={{
              background: 'transparent',
              border: 0,
              padding: 0,
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              fontSize: 16,
              color: 'var(--ink-soft)',
              cursor: 'pointer',
              width: 24,
              flexShrink: 0,
            }}
          >
            ↻
          </button>
        )}
      </div>
      {usage && (
        <div
          style={{
            height: 2,
            background: 'var(--rule-soft)',
          }}
        >
          <div
            style={{
              width: `${Math.round(usage.fraction * 100)}%`,
              height: '100%',
              background:
                usage.fraction < 0.5 ? 'var(--moss)'
                : usage.fraction < 0.8 ? 'var(--gold)'
                : 'var(--ember)',
              transition: 'width 0.3s',
            }}
          />
        </div>
      )}

      {/* Reading column */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="sw-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '22px 22px 12px',
          background: 'var(--vellum)',
        }}
      >
       <div ref={contentRef}>
        <div className="sw-folio" style={{ textAlign: 'center', marginBottom: 8, fontSize: 12 }}>
          {agent.toLowerCase()} · {repo}
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--serif-display)',
            fontSize: 32,
            fontWeight: 500,
            color: 'var(--ink)',
            textAlign: 'center',
            lineHeight: 1.05,
          }}
        >
          <span style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>Of </span>
          {title}
        </h1>
        <div className="sw-ornament" style={{ margin: '14px 0 18px' }}>
          <Dinkus />
        </div>

        {blocks.length === 0 && status !== 'streaming' && (
          <p
            style={{
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              color: 'var(--ink-faint)',
              textAlign: 'center',
              margin: '24px 0',
              fontSize: 14,
            }}
          >
            Speak, master, and I shall set forth.
          </p>
        )}

        {blocks.map((b) => {
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
          if (b.kind === 'doc-link') {
            return (
              <SamMessage key={b.id} time={timeLabel(b.ts)}>
                <DocLinkCard path={b.path} title={b.title} />
              </SamMessage>
            );
          }
          if (b.kind === 'folder-link') {
            return (
              <SamMessage key={b.id} time={timeLabel(b.ts)}>
                <FolderLinkCard path={b.path} title={b.title} />
              </SamMessage>
            );
          }
          if (b.kind === 'artifact') {
            return (
              <SamMessage key={b.id} time={timeLabel(b.ts)}>
                <ArtifactCard artifactId={b.artifactId} artifactKind={b.artifactKind} title={b.title} />
              </SamMessage>
            );
          }
          return (
            <SamMessage key={b.id} time={timeLabel(b.ts)}>
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
        })}

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
              margin: '8px 0',
              fontSize: 13,
            }}
          >
            {errorText}
          </p>
        )}

        <div style={{ height: 8 }} />
        <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
       </div>
      </div>

      <MobileActiveToolBanner blocks={blocks} streaming={status === 'streaming'} />

      {/* Composer */}
      <div
        ref={composerRef}
        style={{
          padding: '8px 12px 8px',
          borderTop: '1px solid var(--rule-soft)',
          background: 'var(--parchment-2)',
          flexShrink: 0,
        }}
      >
        {pendingImages.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {pendingImages.map((img) => (
              <div
                key={img.id}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 44,
                  borderRadius: 4,
                  overflow: 'hidden',
                  border: '1px solid var(--rule-soft)',
                  flexShrink: 0,
                }}
              >
                <img
                  src={img.previewUrl}
                  alt="attached"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  onClick={() => removeImage(img.id)}
                  aria-label="remove"
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: 0,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    fontSize: 10,
                    lineHeight: 1,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            background: 'var(--vellum)',
            borderRadius: 22,
            border: '1px solid var(--rule-soft)',
            padding: '6px 6px 6px 10px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            minHeight: 44,
          }}
          onPaste={(e) => {
            if (!acceptImages) return;
            const files: File[] = [];
            for (const item of Array.from(e.clipboardData.items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              e.preventDefault();
              void ingestFiles(files);
            }
          }}
        >
          {acceptImages && (
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="attach image"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 0,
                background: 'transparent',
                color: 'var(--ink-soft)',
                fontSize: 18,
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
                marginBottom: 2,
              }}
            >
              📎
            </button>
          )}
          <MobileGrowingInput
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            commandPrefix={commandPrefix}
            commands={commands}
            commandSets={commandSets}
          />
          {(() => {
            const hasText = draft.trim().length > 0 || pendingImages.length > 0;
            const streaming = status === 'streaming';
            // Empty + streaming → stop the turn.
            // Text + streaming → steer (stop + send the new prompt).
            // Otherwise → normal send.
            if (streaming && !hasText && onStop) {
              return (
                <button
                  onClick={onStop}
                  aria-label="stop"
                  style={{
                    width: 38, height: 38, borderRadius: '50%', border: 0,
                    background: 'var(--ember)', color: 'var(--vellum)',
                    fontFamily: 'var(--serif-display)', fontSize: 16,
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  ■
                </button>
              );
            }
            return (
              <button
                onClick={submit}
                aria-label={streaming ? 'steer' : 'send'}
                title={streaming ? 'stop + send this as a new prompt' : undefined}
                style={{
                  width: 38, height: 38, borderRadius: '50%', border: 0,
                  background: streaming ? 'var(--ember)' : 'var(--ink)',
                  color: 'var(--vellum)',
                  fontFamily: 'var(--serif-display)',
                  fontSize: 20, fontStyle: 'italic',
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                {streaming ? '↪' : '↑'}
              </button>
            );
          })()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 4,
            padding: '0 4px',
          }}
        >
          <button
            onClick={() => sendCommand('match')}
            style={{
              border: '1px solid var(--rule-soft)',
              background: 'var(--vellum)',
              color: 'var(--ink-soft)',
              borderRadius: 6,
              padding: '3px 8px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {commandText(commandPrefix, 'match')}
          </button>
          <button
            onClick={() => sendCommand('push')}
            style={{
              border: '1px solid var(--rule-soft)',
              background: 'var(--vellum)',
              color: 'var(--ink-soft)',
              borderRadius: 6,
              padding: '3px 8px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {commandText(commandPrefix, 'push')}
          </button>
          {onFreshStart && (
            <button
              onClick={onFreshStart}
              aria-label="start a fresh thread"
              title="fresh thread"
              style={{
                marginLeft: 'auto',
                border: '1px solid var(--rule-soft)',
                background: 'var(--vellum)',
                color: 'var(--ink-soft)',
                borderRadius: 6,
                padding: '3px 10px',
                fontFamily: 'var(--serif-display)',
                fontStyle: 'italic',
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>↻</span>
              fresh
            </button>
          )}
        </div>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {/* Chronicle FAB */}
      <button
        onClick={onOpenChronicle}
        aria-label="Open chronicle"
        style={{
          position: 'absolute',
          right: 16,
          bottom: composerHeight + 16,
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: 'var(--vellum)',
          border: '1.5px solid var(--rule)',
          boxShadow: '0 4px 14px rgba(74,50,24,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--ember)',
            border: '2px solid var(--vellum)',
            animation: 'sw-pulse 1.4s infinite',
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 2,
          }}
        />
        <SamPortrait size={56} ring={false} />
      </button>

      {/* Repo info subhead — kept minimal so chrome stays out of the way */}
      <span style={{ display: 'none' }}>{`${agent}·${repo}`}</span>
    </div>
  );
}

// ─── Mobile Chronicle Sheet ───
export function MobileChronicleSheet({
  events,
  open,
  onClose,
  onSelect,
  onNew,
}: {
  events: ChronicleEvent[];
  open: boolean;
  onClose: () => void;
  onSelect?: (id: string) => void;
  onNew?: () => void;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--parchment)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: '0 -16px 40px rgba(74,50,24,0.25)',
          padding: '10px 0 28px',
          maxHeight: '80%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <span
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              background: 'var(--rule)',
            }}
          />
        </div>
        <div
          style={{
            padding: '4px 22px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <SamPortrait size={28} />
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--serif-display)',
              fontSize: 22,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>The </span>
            Chronicle
          </h2>
          <span
            style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}
            className="sw-folio"
          >
            {events.length} today
          </span>
        </div>
        <hr className="sw-rule-solid" style={{ margin: '0 22px 0' }} />

        <div
          className="sw-scroll"
          style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 0' }}
        >
          {events.map((e) => (
            <PChronicleRow key={e.id} e={e} onSelect={onSelect} />
          ))}
        </div>

        <div
          style={{ padding: '10px 22px 0', borderTop: '1px solid var(--rule-soft)' }}
        >
          <button
            className="sw-btn sw-btn-primary"
            onClick={onNew}
            style={{
              width: '100%',
              fontSize: 16,
              padding: '12px',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              letterSpacing: '0.02em',
            }}
          >
            + a new errand
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile atoms ───
function PStat({
  n,
  l,
  tone,
}: { n: number | string; l: string; tone: 'ember' | 'moss' | 'gold' }) {
  const colors = {
    ember: 'var(--ember)',
    moss: 'var(--moss)',
    gold: 'var(--gold)',
  } as const;
  return (
    <div style={{ textAlign: 'center', minWidth: 70 }}>
      <div
        style={{
          fontFamily: 'var(--serif-display)',
          fontSize: 32,
          fontWeight: 500,
          lineHeight: 1,
          color: colors[tone],
        }}
      >
        {n}
      </div>
      <div
        className="sw-smallcaps"
        style={{ fontSize: 10.5, marginTop: 4, whiteSpace: 'nowrap' }}
      >
        {l}
      </div>
    </div>
  );
}

function PSectionLabel({ folio, label }: { folio: string; label: string }) {
  return (
    <div
      className="sw-smallcaps"
      style={{ fontSize: 11, marginBottom: 10, whiteSpace: 'nowrap' }}
    >
      <span className="sw-folio" style={{ marginRight: 6 }}>
        {folio}
      </span>
      {label}
    </div>
  );
}

function PCompanion({
  name,
  selected,
  onSelect,
}: { name: string; selected?: boolean; onSelect?: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        flex: 1,
        padding: '12px 8px',
        background: selected ? 'var(--ink)' : 'var(--vellum)',
        color: selected ? 'var(--vellum)' : 'var(--ink)',
        border: '1px solid ' + (selected ? 'var(--ink)' : 'var(--rule-soft)'),
        borderRadius: 12,
        textAlign: 'center',
        fontFamily: 'var(--serif-display)',
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'pointer',
      }}
    >
      {name}
    </div>
  );
}

function PRepo({
  repo,
  selected,
  onClick,
}: { repo: Repo; selected?: boolean; onClick?: () => void }) {
  const { branch, recent, pinned, italic, awaits } = repo;
  const label = italic ? repo.name : repo.name;
  return (
    <div
      onClick={onClick}
      title={repo.path}
      style={{
        padding: '8px 8px',
        background: selected ? 'rgba(184,89,58,0.08)' : 'transparent',
        borderLeft: pinned
          ? '2px solid var(--ember)'
          : awaits
            ? '2px solid var(--gold)'
            : '2px solid transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: italic ? 'var(--ink-soft)' : 'var(--ink)',
          fontStyle: italic ? 'italic' : 'normal',
          fontFamily: italic ? 'var(--serif-display)' : 'var(--mono)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flex: '1 1 0',
        }}
      >
        {label}
      </span>
      {branch && (
        <span
          className="sw-mono"
          style={{
            fontSize: 10.5,
            color: 'var(--ember)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          · {branch}
        </span>
      )}
      {recent && (
        <span
          className="sw-folio"
          style={{
            whiteSpace: 'nowrap',
            flexShrink: 0,
            color: awaits ? 'var(--gold)' : undefined,
            fontStyle: awaits ? 'italic' : undefined,
          }}
        >
          {recent}
        </span>
      )}
    </div>
  );
}

function PPill({ hub }: { hub: Hub }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: hub.cozy ? 'var(--parchment-3)' : 'var(--vellum)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 22,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--serif-display)',
          fontSize: 15,
          fontStyle: 'italic',
          whiteSpace: 'nowrap',
        }}
      >
        {hub.name}
      </span>
      <span
        className="sw-mono"
        style={{ fontSize: 11, color: 'var(--ink-faint)' }}
      >
        {hub.count}
      </span>
    </div>
  );
}

function PChronicleRow({
  e,
  onSelect,
}: { e: ChronicleEvent; onSelect?: (id: string) => void }) {
  const colors: Record<ChronicleEventKind, string> = {
    ember: 'var(--ember)',
    gold: 'var(--gold)',
    moss: 'var(--moss)',
    ink: 'var(--ink-faint)',
  };
  const c = colors[e.kind];
  const active = e.running;
  return (
    <div
      onClick={() => onSelect?.(e.id)}
      style={{
        padding: '10px 10px',
        marginBottom: 4,
        background: active ? 'var(--vellum)' : 'transparent',
        borderLeft: active ? '2px solid var(--ember)' : '2px solid transparent',
        borderRadius: 2,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          marginTop: 6,
          background: 'var(--vellum)',
          border: `1.5px solid ${c}`,
          flexShrink: 0,
          animation: e.busy ? 'sw-pulse 1.4s infinite' : 'none',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            marginBottom: 2,
          }}
        >
          <span className="sw-folio" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
            {e.t}
          </span>
          {e.busy && (
            <span
              className="sw-smallcaps"
              style={{ fontSize: 9, color: 'var(--ember)', whiteSpace: 'nowrap' }}
            >
              tending
            </span>
          )}
          {e.running && !e.busy && (
            <span
              className="sw-smallcaps"
              style={{ fontSize: 9, color: 'var(--gold)', whiteSpace: 'nowrap' }}
            >
              warm
            </span>
          )}
          {e.awaits && (
            <span
              className="sw-smallcaps"
              style={{ fontSize: 9, color: 'var(--gold)', whiteSpace: 'nowrap' }}
            >
              asks
            </span>
          )}
          {e.asleep && (
            <span
              className="sw-smallcaps"
              style={{ fontSize: 9, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}
            >
              asleep
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--serif-display)',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.15,
          }}
        >
          <span style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>Of the </span>
          {e.title}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <span
            className="sw-mono"
            style={{
              fontSize: 10.5,
              color: 'var(--ink-soft)',
              whiteSpace: 'nowrap',
            }}
          >
            {e.repo}
          </span>
          <span style={{ color: 'var(--ink-faint)' }}>·</span>
          <span
            style={{
              fontFamily: 'var(--serif-body)',
              fontSize: 12,
              color: e.awaits ? 'var(--gold)' : 'var(--ink-2)',
              fontStyle: e.awaits ? 'italic' : 'normal',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
            }}
          >
            {e.status}
          </span>
        </div>
      </div>
    </div>
  );
}

// Re-export for convenience
export { CHRONICLE };

function MobileActiveToolBanner({
  blocks,
  streaming,
}: {
  blocks: import('../../data/types').ChatBlock[];
  streaming: boolean;
}) {
  const last = blocks.length ? blocks[blocks.length - 1] : null;
  const activeTool =
    last && last.kind === 'tool' && last.running
      ? { tool: last.tool, startedAt: last.ts }
      : null;
  const [, force] = useState(0);
  useEffect(() => {
    if (!activeTool) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeTool?.tool, activeTool?.startedAt]);
  if (!streaming) return null;
  const elapsed = activeTool ? Math.max(0, Math.floor((Date.now() - activeTool.startedAt) / 1000)) : null;
  const label = activeTool ? `running ${activeTool.tool}` : 'thinking';
  const elapsedLabel = elapsed === null ? '' : ` · ${formatMobileElapsed(elapsed)}`;
  const isSlow = elapsed !== null && elapsed >= 8;
  return (
    <div
      style={{
        padding: '5px 12px',
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
          fontSize: 10.5,
          color: isSlow ? 'var(--ember)' : 'var(--ink-soft)',
          letterSpacing: '0.1em',
          fontWeight: isSlow ? 600 : 500,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}{elapsedLabel}
      </span>
      <span className="sw-thinking" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
        <span></span>
        <span></span>
        <span></span>
      </span>
    </div>
  );
}

function formatMobileElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}
