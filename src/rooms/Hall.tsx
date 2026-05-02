import {
  Bot,
  CircleStop,
  GitBranch,
  History,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  SquarePen,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatBlock, CommandEntry, CompanionId, Repo } from '../chat/data/types';
import { commandText, getCommandSuggestionMulti } from '../chat/utils/commandAutocomplete';
import type { ContextUsage } from '../chat/hooks/useChat';
import { useChat } from '../chat/hooks/useChat';
import { useCommands } from '../chat/hooks/useCommands';
import { useLive } from '../chat/hooks/useLive';
import { useRepos } from '../chat/hooks/useRepos';
import { useStickyScroll } from '../chat/hooks/useStickyScroll';
import { Markdown } from '../chat/components/primitives/Markdown';
import { ArtifactCard } from '../chat/components/blocks/ArtifactCard';
import { DocLinkCard } from '../chat/components/blocks/DocLinkCard';
import { FolderLinkCard } from '../chat/components/blocks/FolderLinkCard';
import { Button, Chip } from '../components/Primitives';
import { useScribeEvents } from '../hooks/useRoomData';
import { useScribeSocket } from '../hooks/useScribeSocket';
import { Evenstar, Signet } from '../theme/Ornaments';
import { timeAgo } from '../utils/format';

type ChatStatus = 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';
type ActiveChat = { cli: CompanionId; repoPath: string };

const ACTIVE_KEY = 'rivendell:hall-chat-active';
const SCRIBE_COLLAPSED_KEY = 'rivendell:hall-scribe-collapsed';

const companionLabel: Record<CompanionId, string> = {
  assistant: 'Elrond',
  claude: 'Claude Code',
  codex: 'Codex',
};

const companionTitle: Record<CompanionId, string> = {
  assistant: 'Lord of Imladris',
  claude: 'Anthropic emissary',
  codex: 'OpenAI emissary',
};

const companionSub: Record<CompanionId, string> = {
  assistant: 'local Claude Code session in ASSISTANT-HUB',
  claude: 'tool-rich, persistent session',
  codex: 'local Codex session in ASSISTANT-HUB',
};

const statusCopy: Record<ChatStatus, string> = {
  idle: 'idle',
  connecting: 'connecting',
  ready: 'attending',
  streaming: 'thinking',
  closed: 'reconnecting',
  error: 'needs attention',
};

export function Hall() {
  const reposState = useRepos();
  const repos = reposState.repos;
  const commands = useCommands();
  const liveSessions = useLive();
  const [companion, setCompanion] = useState<CompanionId>(() => normalizeCompanion(readActive()?.cli));
  const [repo, setRepo] = useState<Repo | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(() => readPromptParam());
  const [title, setTitle] = useState('a fresh errand');
  const [scribeCollapsed, setScribeCollapsed] = useState(() => localStorage.getItem(SCRIBE_COLLAPSED_KEY) === 'true');
  // Mobile-only: collapses the verbose status / repo / command-count strip into
  // a tap-to-expand panel so messages aren't pushed off the first screen.
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const restoreRef = useRef(readActive()?.repoPath ?? null);
  const dateLabel = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  const { data: initialEvents = [] } = useScribeEvents();
  const { events: scribeEvents, state: scribeState } = useScribeSocket(initialEvents);
  const scribeFeed = (scribeEvents.length ? scribeEvents : initialEvents).slice(-7).reverse();

  useEffect(() => {
    if (!repos.length || repo) return;
    const assistantHub = repos.find((item) => item.isAssistantHub);
    const restored = restoreRef.current
      ? repos.find((item) => item.path === restoreRef.current)
      : undefined;
    const nextRepo = assistantHub ?? restored ?? repos[0];
    setRepo(nextRepo);
    restoreRef.current = null;
  }, [repos, repo]);

  useEffect(() => {
    if (!repos.length) return;
    const assistantHub = repos.find((item) => item.isAssistantHub);
    if (assistantHub && repo?.path !== assistantHub.path) {
      setRepo(assistantHub);
    }
  }, [repos, repo?.path]);

  useEffect(() => {
    if (!repo) return;
    writeActive({ cli: companion, repoPath: repo.path });
  }, [companion, repo?.path]);

  useEffect(() => {
    localStorage.setItem(SCRIBE_COLLAPSED_KEY, String(scribeCollapsed));
  }, [scribeCollapsed]);

  const chat = useChat({
    repo,
    cli: companion,
    enabled: Boolean(repo),
    initialMessage: pendingPrompt,
    onInitialMessageSent: () => setPendingPrompt(null),
  });

  useEffect(() => {
    const firstUser = chat.blocks.find((block) => block.kind === 'user');
    if (firstUser?.kind === 'user') {
      const next = firstUser.text.trim().split('\n')[0]?.slice(0, 64);
      if (next) setTitle(next);
    } else {
      setTitle('a fresh errand');
    }
  }, [chat.blocks]);

  const activeCommands = companion === 'codex' ? commands.codex : commands.claude;
  const activeLive = liveSessions.find((session) => session.cwd === repo?.path && session.cli === companion);

  const switchCompanion = (next: CompanionId) => {
    setCompanion(next);
    if (next === 'assistant') {
      const assistantHub = repos.find((item) => item.isAssistantHub);
      if (assistantHub) setRepo(assistantHub);
    }
  };

  const beginFresh = () => {
    chat.freshStart();
    setTitle('a fresh errand');
  };

  const { scrollRef, bottomRef, contentRef, onScroll } = useStickyScroll();

  return (
    <div className={`hall-chat ${scribeCollapsed ? 'is-scribe-collapsed' : ''} ${mobileInfoOpen ? 'is-mobile-info-open' : ''}`}>
      <header className="hall-chat-topbar">
        <div className="hall-presence">
          <Signet size={40} color="var(--r-gold)">
            <Evenstar size={20} color="var(--r-gold)" />
          </Signet>
          <div className="hall-presence-text">
            <div className="agent-title">
              <strong>{companionLabel[companion]}</strong>
              <span className="agent-subtitle">{companionTitle[companion]}</span>
              <span className="agent-status-inline" aria-hidden="true">
                <span className={`live-orb ${chat.status === 'ready' || chat.status === 'streaming' ? 'is-live' : ''}`} />
                {statusCopy[chat.status]}
              </span>
            </div>
            <div className="agent-state">
              <span className={`live-orb ${chat.status === 'ready' || chat.status === 'streaming' ? 'is-live' : ''}`} />
              <span>{statusCopy[chat.status]} · {activeLive?.busy ? 'live session busy' : 'all systems clear'} · {repo?.name ?? 'choosing a room'}</span>
            </div>
          </div>
        </div>

        <div className="hall-chat-controls">
          <div className="companion-toggle" role="group" aria-label="Choose agent">
            {(['assistant', 'codex'] as CompanionId[]).map((item) => (
              <button key={item} className={companion === item ? 'active' : ''} onClick={() => switchCompanion(item)}>
                <span className={`status-pin status-${item === 'assistant' ? 'done' : 'running'}`} />
                {companionLabel[item]}
              </button>
            ))}
          </div>
          <button
            className={`rail-icon-button hall-info-toggle ${mobileInfoOpen ? 'is-active' : ''}`}
            type="button"
            onClick={() => setMobileInfoOpen((value) => !value)}
            title={mobileInfoOpen ? 'Hide details' : 'Show repo & status'}
            aria-label={mobileInfoOpen ? 'Hide details' : 'Show repo and status'}
            aria-expanded={mobileInfoOpen}
          >
            {mobileInfoOpen ? <X size={17} /> : <Info size={17} />}
          </button>
          <button
            className="rail-icon-button hall-rail-toggle"
            type="button"
            onClick={() => setScribeCollapsed((value) => !value)}
            title={scribeCollapsed ? 'Expand Scribe rail' : 'Collapse Scribe rail'}
            aria-label={scribeCollapsed ? 'Expand Scribe rail' : 'Collapse Scribe rail'}
          >
            {scribeCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
          </button>
        </div>
      </header>

      <div className="hall-chat-body">
        <main className="chat-main">
          <div className={`chat-context-bar ${mobileInfoOpen ? 'is-mobile-open' : ''}`}>
            <div className="repo-picker">
              <button
                className="repo-current locked"
                title={`${companionLabel[companion]} always works in ASSISTANT-HUB`}
              >
                <GitBranch size={15} />
                <span>{repo ? repo.name : reposState.status === 'loading' ? 'Scanning workspace...' : 'ASSISTANT-HUB'}</span>
                <code>locked</code>
              </button>
            </div>

            <div className="chat-meta-strip">
              <Chip tone={chat.status === 'streaming' ? 'elf' : chat.status === 'ready' ? 'emerald' : 'neutral'}>{statusCopy[chat.status]}</Chip>
              <span>{companionSub[companion]}</span>
              <span>{activeCommands.length} commands</span>
            </div>
          </div>

          <section ref={scrollRef} onScroll={onScroll} className="chat-transcript r-scroll">
            <div ref={contentRef}>
              <div className="chat-date-rule">
                <span />
                <strong>{dateLabel} · {title}</strong>
                <span />
              </div>

              {chat.blocks.length === 0 ? (
                <EmptyChat companion={companion} repo={repo} onPrompt={(prompt) => setPendingPrompt(prompt)} />
              ) : (
                chat.blocks.map((block) => <ChatBlockView key={block.id} block={block} companion={companion} />)
              )}

              {chat.status === 'streaming' ? (
                <div className="thinking-row">
                  <span className="r-pulse-dot gold" />
                  <span>{companionLabel[companion]} is thinking</span>
                </div>
              ) : null}
              {chat.error ? (
                <div className="chat-error" role="status">
                  {chat.error}
                </div>
              ) : null}
              <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
            </div>
          </section>

          <Composer
            disabled={!repo}
            streaming={chat.status === 'streaming'}
            onSend={chat.status === 'streaming' ? chat.steer : chat.send}
            onStop={chat.stop}
            onFreshStart={beginFresh}
            commandPrefix={companion === 'codex' ? '$' : '/'}
            claudeCommands={commands.claude}
            codexCommands={commands.codex}
            agentName={companionLabel[companion]}
            usage={chat.usage}
          />
        </main>

        {!scribeCollapsed ? (
          <aside className="scribe-rail">
            <div className="scribe-rail-head">
              <div>
                <p className="r-eyebrow-gold">The Scribe's Log</p>
                <h2>Whilst you were away</h2>
                <span>{scribeState === 'open' ? 'streaming' : 'reconnecting'} · {scribeFeed.length} recent acts</span>
              </div>
              <button
                className="rail-icon-button"
                type="button"
                onClick={() => setScribeCollapsed(true)}
                title="Collapse Scribe rail"
                aria-label="Collapse Scribe rail"
              >
                <PanelRightClose size={17} />
              </button>
            </div>
            <div className="scribe-timeline r-scroll">
              {scribeFeed.map((event) => (
                <div key={event.id} className={`scribe-timeline-row level-${event.level}`}>
                  <i />
                  <code>{timeAgo(event.ts)}</code>
                  <Chip tone={event.level === 'error' ? 'rose' : event.level === 'tool' ? 'elf' : event.level === 'note' ? 'gold' : 'neutral'}>
                    {event.level}
                  </Chip>
                  <span>{event.text}</span>
                </div>
              ))}
            </div>
            <Button tone="ghost" onClick={() => window.location.assign('/scribe')}>
              <History size={15} />
              Open full Scribe
            </Button>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

type StagedImage = { id: string; mediaType: string; base64: string; previewUrl: string };

function Composer({
  disabled,
  streaming,
  commandPrefix,
  onSend,
  onStop,
  onFreshStart,
  claudeCommands,
  codexCommands,
  agentName,
  usage,
}: {
  disabled: boolean;
  streaming: boolean;
  commandPrefix: string;
  onSend: (text: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onStop: () => void;
  onFreshStart: () => void;
  claudeCommands: CommandEntry[];
  codexCommands: CommandEntry[];
  agentName: string;
  usage: ContextUsage | null;
}) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<StagedImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Both Claude (`/`) and Codex (`$`) skill autocomplete are offered at all
  // times — the active companion only decides which prefix is the "default"
  // one shown in the footer. The first matching prefix wins.
  const suggestion = getCommandSuggestionMulti(value, [
    { prefix: '/', commands: claudeCommands },
    { prefix: '$', commands: codexCommands },
  ]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const needed = textarea.scrollHeight;
    textarea.style.height = `${Math.min(needed, 190)}px`;
    textarea.style.overflowY = needed > 190 ? 'auto' : 'hidden';
  }, [value]);

  // Revoke object URLs when the component unmounts so we don't leak blob refs.
  useEffect(() => {
    return () => {
      for (const img of images) URL.revokeObjectURL(img.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingestFiles = async (files: FileList | File[]) => {
    const next: StagedImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      // Chunked btoa avoids a call-stack blowout on multi-MB screenshots.
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const base64 = btoa(bin);
      const previewUrl = URL.createObjectURL(file);
      next.push({
        id: `img_${Math.random().toString(36).slice(2, 10)}`,
        mediaType: file.type,
        base64,
        previewUrl,
      });
    }
    if (next.length) {
      setImages((prev) => [...prev, ...next]);
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const submit = () => {
    const text = value.trim();
    if (disabled) return;
    if (!text && images.length === 0) return;
    const payload = images.length
      ? images.map((i) => ({ mediaType: i.mediaType, base64: i.base64 }))
      : undefined;
    onSend(text, payload);
    setValue('');
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.previewUrl);
      return [];
    });
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    setValue(suggestion.fullText);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(suggestion.fullText.length, suggestion.fullText.length);
    });
  };

  return (
    <footer className="chat-composer">
      {images.length > 0 ? (
        <div className="composer-image-tray" aria-label="Attached images">
          {images.map((img) => (
            <div key={img.id} className="composer-image-thumb">
              <img src={img.previewUrl} alt="attached" />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                aria-label="Remove image"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-input-wrap">
        {suggestion ? (
          <div className="composer-ghost" aria-hidden="true">
            <span className="composer-ghost-typed">{value}</span>
            <span className="composer-ghost-tail">{suggestion.tail}</span>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (suggestion && (event.key === 'Tab' || event.key === 'ArrowRight')) {
              const ta = textareaRef.current;
              const atEnd = ta ? ta.selectionStart === value.length && ta.selectionEnd === value.length : true;
              if (atEnd) {
                event.preventDefault();
                acceptSuggestion();
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={(event) => {
            const files: File[] = [];
            for (const item of Array.from(event.clipboardData.items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              event.preventDefault();
              void ingestFiles(files);
            }
          }}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.items).some((i) => i.kind === 'file')) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              event.preventDefault();
              void ingestFiles(files);
            }
          }}
          placeholder={disabled ? 'Finding ASSISTANT-HUB...' : streaming ? 'Steer the current turn...' : `Speak, and ${agentName} shall listen...`}
          rows={1}
        />
        <button
          className="composer-attach"
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          title="Attach an image (paste or drop also works)"
          aria-label="Attach image"
        >
          <Paperclip size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            if (event.target.files) void ingestFiles(event.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <button
          className="send-button"
          type="button"
          disabled={disabled || (!value.trim() && images.length === 0)}
          onClick={submit}
          title={streaming ? 'Steer' : 'Send'}
          aria-label={streaming ? 'Steer' : 'Send'}
        >
          <Send size={15} />
          <span className="send-button-label">{streaming ? 'Steer' : 'Send'}</span>
        </button>
      </div>
      <div className="composer-footer">
        <div>
          <button type="button" onClick={onFreshStart} title="Start a fresh thread">
            <SquarePen size={14} />
            fresh
          </button>
          <button
            type="button"
            className="composer-commands-hint"
            title="Tool command prefix — type / for Claude, $ for Codex"
          >
            <TerminalSquare size={14} />
            {commandPrefix} commands
          </button>
          {suggestion ? (
            <button
              type="button"
              className="composer-accept-hint"
              onClick={acceptSuggestion}
              title={`Tab to accept ${commandText(suggestion.prefix, suggestion.command.name)}`}
            >
              ↹ {commandText(suggestion.prefix, suggestion.command.name)}
            </button>
          ) : null}
          {streaming ? (
            <button type="button" onClick={onStop} title="Stop the current turn">
              <CircleStop size={14} />
              stop
            </button>
          ) : null}
        </div>
        {usage ? <ContextMeter usage={usage} /> : null}
      </div>
    </footer>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage }) {
  const used = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
  const pct = Math.round(usage.fraction * 100);
  const tone =
    usage.fraction < 0.5 ? 'var(--r-moss, #6f8f5e)'
    : usage.fraction < 0.8 ? 'var(--r-gold, #d4af63)'
    : 'var(--r-ember, #c46a3f)';
  const hint =
    usage.fraction < 0.5 ? 'plenty of room'
    : usage.fraction < 0.8 ? 'getting full'
    : 'consider hitting fresh';
  return (
    <div
      className="composer-context-meter"
      title={`${used.toLocaleString()} of ${usage.windowTokens.toLocaleString()} tokens used — ${hint}`}
    >
      <span className="composer-context-meter-track">
        <span
          className="composer-context-meter-fill"
          style={{ width: `${pct}%`, background: tone }}
        />
      </span>
      <span className="composer-context-meter-label">
        {formatTokens(used)} / {formatTokens(usage.windowTokens)}
      </span>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function ChatBlockView({ block, companion }: { block: ChatBlock; companion: CompanionId }) {
  if (block.kind === 'user') {
    return (
      <article className="chat-message user-message">
        <div className="message-avatar">M</div>
        <div>
          <header>
            <strong>Matt</strong>
            <span>{formatTime(block.ts)}</span>
          </header>
          <p>{block.text}</p>
        </div>
      </article>
    );
  }

  if (block.kind === 'tool') {
    return (
      <article className="chat-message assistant-message tool-message">
        <AgentAvatar companion={companion} />
        <div>
          <header>
            <strong>Tool</strong>
            <span>{block.running ? 'running' : 'returned'}</span>
          </header>
          <div className="tool-ledger">
            <div>
              <TerminalSquare size={14} />
              <code>{block.tool}</code>
            </div>
            {block.args ? <pre>{block.args}</pre> : null}
            {block.result ? <p>{block.result}</p> : null}
          </div>
        </div>
      </article>
    );
  }

  if (block.kind === 'doc-link' || block.kind === 'folder-link' || block.kind === 'artifact') {
    return (
      <article className="chat-message assistant-message">
        <AgentAvatar companion={companion} />
        <div>
          <header>
            <strong>{companionLabel[companion]}</strong>
            <span>{formatTime(block.ts)}</span>
          </header>
          <div className="assistant-text">
            {block.kind === 'doc-link' ? <DocLinkCard path={block.path} title={block.title} /> : null}
            {block.kind === 'folder-link' ? <FolderLinkCard path={block.path} title={block.title} /> : null}
            {block.kind === 'artifact' ? (
              <ArtifactCard artifactId={block.artifactId} artifactKind={block.artifactKind} title={block.title} />
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="chat-message assistant-message">
      <AgentAvatar companion={companion} />
      <div>
        <header>
          <strong>{companionLabel[companion]}</strong>
          <span>{formatTime(block.ts)}</span>
        </header>
        <div className="assistant-text"><Markdown>{block.text}</Markdown></div>
      </div>
    </article>
  );
}

function AgentAvatar({ companion }: { companion: CompanionId }) {
  return (
    <div className={`agent-avatar agent-${companion}`}>
      {companion === 'codex' ? <Bot size={16} /> : <Evenstar size={16} color="currentColor" />}
    </div>
  );
}

function EmptyChat({ companion, repo, onPrompt }: { companion: CompanionId; repo?: Repo; onPrompt: (prompt: string) => void }) {
  const prompts = [
    'Catch me up on what matters today.',
    companion === 'assistant' ? 'Check ASSISTANT-HUB and tell me what needs attention.' : repo ? `Scan ${repo.name} and tell me what needs attention.` : 'Help me choose where to start.',
    companion === 'codex' ? 'Review the current codebase for risks.' : 'Open a planning thread for today.',
  ];

  return (
    <div className="empty-chat">
      <Sparkles size={22} />
      <h2>The Hall is open.</h2>
      <p>Elrond runs locally in ASSISTANT-HUB. Switch to Codex when you want the OpenAI local agent.</p>
      <div>
        {prompts.map((prompt) => (
          <button key={prompt} onClick={() => onPrompt(prompt)}>
            <Plus size={14} />
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function readActive(): ActiveChat | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.cli === 'claude' || parsed.cli === 'codex' || parsed.cli === 'assistant') &&
      typeof parsed.repoPath === 'string'
    ) {
      return parsed as ActiveChat;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeCompanion(value: CompanionId | undefined): CompanionId {
  return value === 'codex' ? 'codex' : 'assistant';
}

function writeActive(active: ActiveChat) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
}

function readPromptParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  const prompt = params.get('prompt');
  if (!prompt) return null;
  params.delete('prompt');
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
  return prompt;
}
