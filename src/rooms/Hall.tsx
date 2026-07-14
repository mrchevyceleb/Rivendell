import {
  Bot,
  CircleStop,
  GitBranch,
  History,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  SquarePen,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatBlock, ChatImagePreview, CommandEntry, CompanionId, LiveSession, Repo } from '../chat/data/types';
import { commandText, getCommandSuggestionMulti } from '../chat/utils/commandAutocomplete';
import type { ContextUsage } from '../chat/hooks/useChat';
import { useChat } from '../chat/hooks/useChat';
import { useBananaModel, useFireworksModel } from '../chat/hooks/useBananaModel';
import {
  normalizeZaiEffort,
  normalizeZaiModel,
  readStoredZaiEffort,
  readStoredZaiModel,
  ZAI_EFFORTS,
  ZAI_MODELS,
  normalizeXaiEffort,
  normalizeXaiModel,
  readStoredXaiEffort,
  readStoredXaiModel,
  XAI_EFFORTS,
  XAI_MODELS,
} from '../chat/hooks/useCompanionPicker';
import { ModelPicker } from '../chat/components/ModelPicker';
import { LocalModelPicker } from '../chat/components/LocalModelPicker';
import { CodexEnginePicker, CLAUDE_MODELS, CLAUDE_EFFORTS } from '../chat/components/CodexEnginePicker';
import {
  normalizeCodexEffort,
  normalizeCodexModel,
  readStoredCodexEffort,
  readStoredCodexModel,
} from '../chat/codexModels';
import { useCommands } from '../chat/hooks/useCommands';
import { useLive } from '../chat/hooks/useLive';
import { useRepos } from '../chat/hooks/useRepos';
import { useStickyScroll } from '../chat/hooks/useStickyScroll';
import { Markdown } from '../chat/components/primitives/Markdown';
import { ArtifactCard } from '../chat/components/blocks/ArtifactCard';
import { DocLinkCard } from '../chat/components/blocks/DocLinkCard';
import { FolderLinkCard } from '../chat/components/blocks/FolderLinkCard';
import { Button, Chip } from '../components/Primitives';
import { useMcpHealth, type McpHealthStatus } from '../hooks/useMcpHealth';
import { useScribeEvents } from '../hooks/useRoomData';
import { useScribeSocket } from '../hooks/useScribeSocket';
import { Evenstar, Signet } from '../theme/Ornaments';
import { timeAgo } from '../utils/format';

type ChatStatus = 'idle' | 'connecting' | 'ready' | 'streaming' | 'closed' | 'error';
type ActiveChat = { cli: CompanionId; repoPath: string };
type ChatTab = { id: string; cli: CompanionId; title: string; createdAt: number };

const ACTIVE_KEY = 'rivendell:hall-chat-active';
const CHAT_TABS_KEY = 'rivendell:hall-chat-tabs';
const ACTIVE_TAB_KEY = 'rivendell:hall-chat-active-tab';
// Tombstones for tabs closed in any window, so the cross-window tab-list merge
// honors deletions instead of resurrecting a closed tab from another window's
// stale list. Map of tab id → closedAt(ms); pruned to recent entries.
const CLOSED_TABS_KEY = 'rivendell:hall-chat-closed-tabs';
const CLOSED_TAB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAIN_CHAT_ID = 'main';
const FRESH_TITLE = 'a fresh errand';
const SCRIBE_COLLAPSED_KEY = 'rivendell:hall-scribe-collapsed';

const companionLabel: Record<CompanionId, string> = {
  assistant: 'Elrond',
  claude: 'Claude Code',
  codex: 'Codex',
  banana: 'Banana',
  'banana-local': 'Local LLM',
  'banana-fireworks': 'Fireworks',
  zai: 'Z.ai GLM',
  xai: 'xAI Grok',
};

const companionTitle: Record<CompanionId, string> = {
  assistant: 'Lord of Imladris',
  claude: 'repo-routed Claude Code',
  codex: 'OpenAI emissary',
  banana: 'Banana Code emissary',
  'banana-local': 'local model on the Spark',
  'banana-fireworks': 'Fireworks emissary',
  zai: 'GLM via Z.ai coding plan',
  xai: 'Grok 4.5 via xAI coding plan',
};

const companionSub: Record<CompanionId, string> = {
  assistant: 'Claude Code using the repo account map',
  claude: 'Claude Code using the repo account map',
  codex: 'Codex using the repo account map',
  banana: 'OpenRouter via Banana Code',
  'banana-local': 'local LM Studio model, direct',
  'banana-fireworks': 'Fireworks models, direct',
  zai: 'GLM 5.2 1M / 5.1 via Z.ai',
  xai: 'Grok 4.5 via xAI, direct',
};

// Banana is an engine multiplexer: the picked engine selects the wire cli
// and provider. Claude Code and Codex accounts still come from the repo map.
type BananaEngine = 'openrouter' | 'fireworks' | 'local' | 'zai' | 'xai';
const BANANA_ENGINES: { id: BananaEngine; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'fireworks', label: 'Fireworks' },
  { id: 'zai', label: 'Z.ai GLM' },
  { id: 'xai', label: 'xAI Grok' },
  { id: 'local', label: 'Local (vLLM)' },
];
const BANANA_REASONING_OPTIONS = [
  { value: 'low', label: 'effort · low' },
  { value: 'medium', label: 'effort · medium' },
  { value: 'high', label: 'effort · high' },
];
const LOCAL_THINKING_OPTIONS = [
  { value: 'low', label: 'thinking · off' },
  { value: 'medium', label: 'thinking · auto' },
  { value: 'high', label: 'thinking · on' },
];
function bananaEngineToCli(engine: string): CompanionId {
  switch (engine) {
    case 'local':
      return 'banana-local';
    case 'fireworks':
      return 'banana-fireworks';
    case 'zai':
      return 'zai';
    case 'xai':
      return 'xai';
    default:
      return 'banana';
  }
}

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
  const [tabs, setTabs] = useState<ChatTab[]>(() => readTabs(normalizeCompanion(readActive()?.cli)));
  const [activeTabId, setActiveTabId] = useState<string>(() => readActiveTabId(tabs));
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const companion = activeTab?.cli ?? 'assistant';
  const [repo, setRepo] = useState<Repo | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(() => readPromptParam());
  const [tabCloseError, setTabCloseError] = useState<string | null>(null);
  const [scribeCollapsed, setScribeCollapsed] = useState(() => localStorage.getItem(SCRIBE_COLLAPSED_KEY) === 'true');
  // Mobile-only: collapses the verbose status / repo / command-count strip into
  // a tap-to-expand panel so messages aren't pushed off the first screen.
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const restoreRef = useRef(readActive()?.repoPath ?? null);
  const dateLabel = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const title = activeTab?.title || FRESH_TITLE;

  const { data: initialEvents = [] } = useScribeEvents();
  const { events: scribeEvents, state: scribeState } = useScribeSocket(initialEvents);
  const scribeFeed = (scribeEvents.length ? scribeEvents : initialEvents).slice(-7).reverse();
  const mcpHealth = useMcpHealth();

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
    writeTabs(tabs);
  }, [tabs]);

  // Cross-browser-window tab-list safety. The tab list lives in one shared
  // localStorage key, and each window holds its own copy in React state. Without
  // this, a tab created in window B is silently erased the next time window A
  // writes its (older) list back. When another window changes the list, merge
  // by id — never drop a tab that exists in either window — and re-merge on
  // focus as a backstop. The merge is a no-op when nothing new appeared, so the
  // two windows settle instead of ping-ponging writes.
  useEffect(() => {
    const mergeFromStorage = () => {
      const stored = readTabs(companion);
      const closed = readClosedTabs();
      setTabs((prev) => {
        const known = new Set(prev.map((tab) => tab.id));
        // Honor deletions: drop tabs closed in another window…
        const kept = prev.filter((tab) => !(tab.id in closed));
        // …and add tabs created elsewhere that aren't known or already closed.
        const additions = stored.filter((tab) => !known.has(tab.id) && !(tab.id in closed));
        let next = [...kept, ...additions];
        // Never leave Hall with zero tabs (e.g. the active tab was closed in
        // another window and that window's replacement hasn't synced yet).
        if (next.length === 0) {
          next = [stored.find((tab) => !(tab.id in closed)) ?? defaultTab(companion)];
        }
        next.sort((a, b) => a.createdAt - b.createdAt);
        const unchanged = next.length === prev.length && next.every((tab, i) => tab.id === prev[i].id);
        return unchanged ? prev : next;
      });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHAT_TABS_KEY || e.key === CLOSED_TABS_KEY) mergeFromStorage();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', mergeFromStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', mergeFromStorage);
    };
  }, [companion]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId) && tabs[0]) {
      setActiveTabId(tabs[0].id);
      return;
    }
    localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
  }, [activeTabId, tabs]);

  useEffect(() => {
    localStorage.setItem(SCRIBE_COLLAPSED_KEY, String(scribeCollapsed));
  }, [scribeCollapsed]);

  // Model selections are shared across every Hall and embedded chat surface.
  const bananaModel = useBananaModel();
  const fireworksModel = useFireworksModel();
  const [codexModel, setCodexModel] = useState<string>(readStoredCodexModel);
  const [codexEffort, setCodexEffort] = useState<string>(
    () => readStoredCodexEffort(codexModel),
  );
  const changeCodexModel = (m: string) => {
    const model = normalizeCodexModel(m);
    const effort = normalizeCodexEffort(model, codexEffort);
    setCodexModel(model);
    setCodexEffort(effort);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rivendell:codex-model', model);
      localStorage.setItem('rivendell:codex-effort', effort);
    }
  };
  const changeCodexEffort = (e: string) => {
    const effort = normalizeCodexEffort(codexModel, e);
    setCodexEffort(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:codex-effort', effort);
  };
  const [claudeModel, setClaudeModel] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('rivendell:claude-model')) || 'claude-opus-4-8',
  );
  const [claudeEffort, setClaudeEffort] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('rivendell:claude-effort')) || 'xhigh',
  );
  const changeClaudeModel = (m: string) => {
    setClaudeModel(m);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:claude-model', m);
  };
  const changeClaudeEffort = (e: string) => {
    setClaudeEffort(e);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:claude-effort', e);
  };
  const [bananaEffort, setBananaEffort] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('rivendell:banana-effort')) || 'medium',
  );
  const changeBananaEffort = (e: string) => {
    setBananaEffort(e);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:banana-effort', e);
  };
  const [bananaEngine, setBananaEngineState] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('rivendell:banana-engine')) || 'openrouter',
  );
  const changeBananaEngine = (e: string) => {
    setBananaEngineState(e);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:banana-engine', e);
  };
  const [zaiModel, setZaiModelState] = useState(readStoredZaiModel);
  const [zaiEffort, setZaiEffortState] = useState(readStoredZaiEffort);
  const [xaiModel, setXaiModelState] = useState(readStoredXaiModel);
  const [xaiEffort, setXaiEffortState] = useState(readStoredXaiEffort);
  const changeZaiModel = (m: string) => {
    const model = normalizeZaiModel(m);
    setZaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-model', model);
  };
  const changeZaiEffort = (e: string) => {
    const effort = normalizeZaiEffort(e);
    setZaiEffortState(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-effort', effort);
  };
  const changeXaiModel = (m: string) => {
    const model = normalizeXaiModel(m);
    setXaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:xai-model', model);
  };
  const changeXaiEffort = (e: string) => {
    const effort = normalizeXaiEffort(e);
    setXaiEffortState(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:xai-effort', effort);
  };
  // Local (vLLM) catalog — fetched live from /api/local/models when the Local
  // engine is active. vLLM serves one model at a time; swapping it on the box
  // (then reopening the picker) repopulates this.
  const [localModel, setLocalModelState] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('rivendell:local-model')) || '',
  );
  const [localContextWindow, setLocalContextWindow] = useState<number | null>(null);
  const [localSupportsThinking, setLocalSupportsThinking] = useState(false);
  const changeLocalModel = (m: string | null) => {
    const next = m ?? '';
    setLocalModelState(next);
    if (typeof window !== 'undefined') {
      if (next) localStorage.setItem('rivendell:local-model', next);
      else localStorage.removeItem('rivendell:local-model');
    }
  };

  // The wire cli the Banana companion actually runs as, per its engine pick.
  // Elrond/Codex tabs map straight through. This drives the account/provider
  // family and which model/effort picker we surface.
  const effectiveCli: CompanionId = companion === 'banana' ? bananaEngineToCli(bananaEngine) : companion;
  const isClaudeEngine = effectiveCli === 'claude' || effectiveCli === 'assistant';
  const isCodexEngine = effectiveCli === 'codex';
  const isLocalEngine = effectiveCli === 'banana-local';
  const isOpenRouterEngine = effectiveCli === 'banana';
  const isFireworksEngine = effectiveCli === 'banana-fireworks';
  const isZaiEngine = effectiveCli === 'zai';
  const isXaiEngine = effectiveCli === 'xai';
  const isBananaEngine = isOpenRouterEngine || isLocalEngine || isFireworksEngine;

  const chat = useChat({
    repo,
    cli: effectiveCli,
    chatId: activeTab?.id ?? MAIN_CHAT_ID,
    enabled: Boolean(repo),
    initialMessage: pendingPrompt,
    onInitialMessageSent: () => setPendingPrompt(null),
    model:
      isLocalEngine ? (localModel || undefined)
      : isOpenRouterEngine ? bananaModel.model
      : isFireworksEngine ? fireworksModel.model
      : isZaiEngine ? zaiModel
      : isXaiEngine ? xaiModel
      : isCodexEngine ? codexModel
      : isClaudeEngine ? claudeModel
      : undefined,
    contextWindowTokens: isLocalEngine ? localContextWindow : undefined,
    effort:
      isCodexEngine ? codexEffort
      : isZaiEngine ? zaiEffort
      : isXaiEngine ? xaiEffort
      : isClaudeEngine ? claudeEffort
      : isBananaEngine ? bananaEffort
      : undefined,
  });

  useEffect(() => {
    const firstUser = chat.blocks.find((block) => block.kind === 'user');
    const next = firstUser?.kind === 'user'
      ? firstUser.text.trim().split('\n')[0]?.slice(0, 64) || FRESH_TITLE
      : FRESH_TITLE;
    const currentTabId = activeTab?.id;
    if (!currentTabId) return;
    setTabs((prev) => prev.map((tab) => (
      tab.id === currentTabId && tab.title !== next ? { ...tab, title: next } : tab
    )));
  }, [activeTab?.id, chat.blocks]);

  const activeCommands =
    isCodexEngine ? commands.codex
    : isBananaEngine ? commands.banana
    : commands.claude;
  const activeLive = liveSessions.find((session) => (
    session.cwd === repo?.path &&
    session.cli === companion &&
    (session.chatId || MAIN_CHAT_ID) === (activeTab?.id ?? MAIN_CHAT_ID)
  ));

  const switchCompanion = (next: CompanionId) => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId ? { ...tab, cli: next } : tab
    )));
    if (next === 'assistant') {
      const assistantHub = repos.find((item) => item.isAssistantHub);
      if (assistantHub) setRepo(assistantHub);
    }
  };

  const beginFresh = () => {
    chat.freshStart();
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId ? { ...tab, title: FRESH_TITLE } : tab
    )));
  };

  const createChatTab = () => {
    const tab = createTab(companion);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setPendingPrompt(null);
  };

  const closeChatTab = async (tabId: string) => {
    setTabCloseError(null);
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const closingTab = tabs[index];
    if (!closingTab) return;
    const busySessions = repo
      ? liveSessions.filter((session) => (
          session.cwd === repo.path &&
          (session.chatId || MAIN_CHAT_ID) === tabId &&
          session.busy
        ))
      : [];
    if (busySessions.length > 0 && repo) {
      const results = await Promise.allSettled(busySessions.map((session) => interruptLiveSession(session, repo.path, tabId)));
      if (results.some((result) => result.status === 'rejected')) {
        setTabCloseError('That tab is still running. I could not stop it, so I left it open.');
        return;
      }
    }
    if (tabs.length <= 1) {
      // Closing the only tab would leave Hall empty, so replace it with a
      // fresh tab. Same outcome as "wipe this chat" without losing the room.
      const replacement = createTab(closingTab.cli);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      clearStoredTab(closingTab, repo);
      markTabsClosed([closingTab.id]);
      setPendingPrompt(null);
      return;
    }
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    clearStoredTab(closingTab, repo);
    markTabsClosed([closingTab.id]);
    if (activeTabId === tabId) {
      const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      if (nextActive) setActiveTabId(nextActive.id);
    }
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
            {(['assistant', 'codex', 'banana'] as CompanionId[]).map((item) => (
              <button key={item} className={companion === item ? 'active' : ''} onClick={() => switchCompanion(item)}>
                <span className={`status-pin status-${item === 'assistant' ? 'done' : 'running'}`} />
                {companionLabel[item]}
              </button>
            ))}
          </div>
          {companion === 'banana' ? (
            <select
              aria-label="Banana engine"
              className="banana-engine-select"
              value={bananaEngine}
              onChange={(e) => changeBananaEngine(e.target.value)}
              title="Which engine the Banana companion runs"
              style={{
                fontSize: 12.5,
                border: '1px solid var(--r-line)',
                borderRadius: 7,
                background: 'var(--r-bg-card)',
                color: 'var(--r-ink)',
                padding: '5px 9px',
                cursor: 'pointer',
              }}
            >
              {BANANA_ENGINES.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          ) : null}
          {isLocalEngine ? (
            <LocalModelPicker
              onActiveChange={changeLocalModel}
              onContextChange={setLocalContextWindow}
              onThinkingSupportChange={setLocalSupportsThinking}
            />
          ) : null}
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
          <div className="chat-tab-strip" role="tablist" aria-label="Chat tabs">
            {tabs.map((tab) => (
              <div key={tab.id} className={`chat-tab ${tab.id === activeTab?.id ? 'active' : ''}`}>
                <button
                  className="chat-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTab?.id}
                  onClick={() => setActiveTabId(tab.id)}
                  title={tab.title}
                >
                  <span className={`status-pin status-${tab.cli === 'assistant' ? 'done' : 'running'}`} />
                  <span>
                    <strong>{tab.title}</strong>
                    <small>{companionLabel[tab.cli]}</small>
                  </span>
                </button>
                <button
                  className="chat-tab-close"
                  type="button"
                  onClick={() => void closeChatTab(tab.id)}
                  title={tabs.length > 1 ? 'Close chat tab' : 'Close and start a fresh tab'}
                  aria-label={`Close ${tab.title}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              className="chat-tab-add"
              type="button"
              onClick={createChatTab}
              title="New chat tab"
              aria-label="New chat tab"
            >
              <Plus size={15} />
            </button>
          </div>

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
              <McpStatusPill mcp={mcpHealth} />
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
              {tabCloseError ? (
                <div className="chat-error" role="status">
                  {tabCloseError}
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
            onReconnect={chat.reconnect}
            chatStatus={chat.status}
            commandPrefix={isCodexEngine ? '$' : '/'}
            claudeCommands={isBananaEngine ? commands.banana : commands.claude}
            codexCommands={commands.codex}
            agentName={companionLabel[companion]}
            usage={chat.usage}
            modelPicker={isOpenRouterEngine ? bananaModel : isFireworksEngine ? fireworksModel : null}
            codexPicker={isCodexEngine ? { model: codexModel, effort: codexEffort, setModel: changeCodexModel, setEffort: changeCodexEffort } : null}
            claudePicker={isClaudeEngine ? { model: claudeModel, effort: claudeEffort, setModel: changeClaudeModel, setEffort: changeClaudeEffort } : null}
            zaiPicker={isZaiEngine ? { model: zaiModel, effort: zaiEffort, setModel: changeZaiModel, setEffort: changeZaiEffort } : null}
            xaiPicker={isXaiEngine ? { model: xaiModel, effort: xaiEffort, setModel: changeXaiModel, setEffort: changeXaiEffort } : null}
            bananaEffort={
              isOpenRouterEngine || isFireworksEngine || (isLocalEngine && localSupportsThinking)
                ? bananaEffort
                : null
            }
            bananaEffortMode={isLocalEngine ? 'local-thinking' : 'reasoning'}
            onBananaEffortChange={changeBananaEffort}
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

type StagedImage = { id: string; mediaType: string; base64: string; previewUrl: string; previewDataUrl?: string };
type SendImage = { mediaType: string; base64: string; previewDataUrl?: string };

function createImageThumbnail(sourceUrl: string, mediaType: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 260;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || maxSide, image.naturalHeight || maxSide));
      const width = Math.max(1, Math.round((image.naturalWidth || maxSide) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || maxSide) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(undefined);
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL(mediaType === 'image/png' ? 'image/png' : 'image/jpeg', 0.82));
    };
    image.onerror = () => resolve(undefined);
    image.src = sourceUrl;
  });
}

function Composer({
  disabled,
  streaming,
  commandPrefix,
  onSend,
  onStop,
  onFreshStart,
  onReconnect,
  chatStatus,
  claudeCommands,
  codexCommands,
  agentName,
  usage,
  modelPicker,
  codexPicker,
  claudePicker,
  zaiPicker,
  xaiPicker,
  bananaEffort,
  bananaEffortMode,
  onBananaEffortChange,
}: {
  disabled: boolean;
  streaming: boolean;
  commandPrefix: string;
  onSend: (text: string, images?: SendImage[]) => void;
  onStop: () => void;
  onFreshStart: () => void;
  onReconnect: () => void;
  chatStatus: ChatStatus;
  claudeCommands: CommandEntry[];
  codexCommands: CommandEntry[];
  agentName: string;
  usage: ContextUsage | null;
  /** Non-null only for the Banana companion — renders the model selector. */
  modelPicker: ReturnType<typeof useBananaModel> | null;
  /** Non-null only for Codex — renders the model+effort selector. */
  codexPicker: { model: string; effort: string; setModel: (m: string) => void; setEffort: (e: string) => void } | null;
  /** Non-null only for Claude/assistant — renders the model+effort selector. */
  claudePicker: { model: string; effort: string; setModel: (m: string) => void; setEffort: (e: string) => void } | null;
  /** Non-null only for Z.ai — renders the GLM model+thinking selector. */
  zaiPicker: { model: string; effort: string; setModel: (m: string) => void; setEffort: (e: string) => void } | null;
  /** Non-null only for xAI — renders the Grok model+thinking selector. */
  xaiPicker: { model: string; effort: string; setModel: (m: string) => void; setEffort: (e: string) => void } | null;
  /** Banana-engine reasoning effort (OpenRouter, Fireworks, or local LM Studio). */
  bananaEffort: string | null;
  bananaEffortMode: 'reasoning' | 'local-thinking';
  onBananaEffortChange: (e: string) => void;
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
  const bananaEffortOptions = bananaEffortMode === 'local-thinking'
    ? LOCAL_THINKING_OPTIONS
    : BANANA_REASONING_OPTIONS;

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
      const previewDataUrl = await createImageThumbnail(previewUrl, file.type);
      next.push({
        id: `img_${Math.random().toString(36).slice(2, 10)}`,
        mediaType: file.type,
        base64,
        previewUrl,
        previewDataUrl,
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
      ? images.map((i) => ({ mediaType: i.mediaType, base64: i.base64, previewDataUrl: i.previewDataUrl }))
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
        <div className={modelPicker ? 'has-model-picker' : undefined}>
          {modelPicker ? <ModelPicker state={modelPicker} /> : null}
          {bananaEffort ? (
            <select
              aria-label={bananaEffortMode === 'local-thinking' ? 'Local thinking mode' : 'Reasoning effort'}
              value={bananaEffort}
              onChange={(e) => onBananaEffortChange(e.target.value)}
              style={{ fontSize: 12.5, border: '1px solid var(--rule, currentColor)', borderRadius: 6, background: 'transparent', color: 'inherit', padding: '2px 6px', cursor: 'pointer' }}
            >
              {bananaEffortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : null}
          {codexPicker ? (
            <CodexEnginePicker
              model={codexPicker.model}
              onModelChange={codexPicker.setModel}
              effort={codexPicker.effort}
              onEffortChange={codexPicker.setEffort}
            />
          ) : null}
          {claudePicker ? (
            <CodexEnginePicker
              model={claudePicker.model}
              onModelChange={claudePicker.setModel}
              effort={claudePicker.effort}
              onEffortChange={claudePicker.setEffort}
              models={CLAUDE_MODELS}
              efforts={CLAUDE_EFFORTS}
            />
          ) : null}
          {zaiPicker ? (
            <CodexEnginePicker
              model={zaiPicker.model}
              onModelChange={zaiPicker.setModel}
              effort={zaiPicker.effort}
              onEffortChange={zaiPicker.setEffort}
              models={ZAI_MODELS}
              efforts={ZAI_EFFORTS}
              modelAriaLabel="GLM model"
              effortAriaLabel="GLM thinking level"
              effortLabel="thinking"
            />
          ) : null}
          {xaiPicker ? (
            <CodexEnginePicker
              model={xaiPicker.model}
              onModelChange={xaiPicker.setModel}
              effort={xaiPicker.effort}
              onEffortChange={xaiPicker.setEffort}
              models={XAI_MODELS}
              efforts={XAI_EFFORTS}
              modelAriaLabel="Grok model"
              effortAriaLabel="Grok thinking level"
              effortLabel="thinking"
            />
          ) : null}
          <button type="button" onClick={onFreshStart} title="Start a fresh thread">
            <SquarePen size={14} />
            fresh
          </button>
          <button
            type="button"
            className="composer-commands-hint"
            title={`Tool command prefix, type ${commandPrefix} for ${agentName}, $ for Codex`}
            onClick={() => {
              const ta = textareaRef.current;
              if (!ta) return;
              if (!value.startsWith(commandPrefix)) {
                setValue(commandPrefix + value);
              }
              ta.focus();
              requestAnimationFrame(() => ta.setSelectionRange(commandPrefix.length, commandPrefix.length));
            }}
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
          {chatStatus === 'closed' || chatStatus === 'error' || chatStatus === 'connecting' ? (
            <button
              type="button"
              onClick={onReconnect}
              title="Force reconnect to Elrond"
              className="composer-reconnect-hint"
            >
              <Plug size={14} />
              reconnect
            </button>
          ) : null}
        </div>
        {usage ? <ContextMeter usage={usage} /> : null}
      </div>
    </footer>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage }) {
  const rawUsed = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
  const overflow = rawUsed > usage.windowTokens;
  const used = Math.min(rawUsed, usage.windowTokens);
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
      title={`${overflow ? `${rawUsed.toLocaleString()} reported, capped at ` : ''}${used.toLocaleString()} of ${usage.windowTokens.toLocaleString()} tokens used — ${hint}`}
    >
      <span className="composer-context-meter-track">
        <span
          className="composer-context-meter-fill"
          style={{ width: `${pct}%`, background: tone }}
        />
      </span>
      <span className="composer-context-meter-label">
        {formatTokens(used)}{overflow ? '+' : ''} / {formatTokens(usage.windowTokens)}
      </span>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

const mcpToneFor: Record<McpHealthStatus, 'emerald' | 'gold' | 'rose' | 'neutral'> = {
  up: 'emerald',
  slow: 'gold',
  down: 'rose',
  unknown: 'neutral',
};

const mcpLabelFor: Record<McpHealthStatus, string> = {
  up: 'mcp up',
  slow: 'mcp slow',
  down: 'mcp down',
  unknown: 'mcp checking',
};

function McpStatusPill({ mcp }: { mcp: ReturnType<typeof useMcpHealth> }) {
  const [open, setOpen] = useState(false);
  const detail = mcp.ms != null
    ? `${mcpLabelFor[mcp.status]} · ${mcp.ms}ms`
    : mcpLabelFor[mcp.status];
  const tooltip = mcp.error
    ? `${detail} — ${mcp.error}`
    : mcp.checkedAt
      ? `${detail} — checked ${timeAgo(mcp.checkedAt)}`
      : detail;

  const handleRedeploy = async () => {
    if (mcp.redeploying) return;
    if (!window.confirm('Redeploy assistant-mcp on Railway? Takes about 30 to 60 seconds.')) return;
    const result = await mcp.redeploy();
    if (!result.ok) {
      window.alert(`Redeploy failed: ${result.error || 'unknown error'}`);
    }
    setTimeout(() => { void mcp.refresh(); }, 5_000);
  };

  return (
    <span className="mcp-status-pill" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={tooltip}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, background: 'transparent', border: 0, cursor: 'pointer' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Chip tone={mcpToneFor[mcp.status]}>{detail}</Chip>
      </button>
      {open ? (
        <span
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 20,
            background: 'var(--r-card, #1a1a1a)',
            border: '1px solid var(--r-line, #333)',
            borderRadius: 8,
            padding: 10,
            minWidth: 220,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            display: 'grid',
            gap: 6,
            fontSize: 12,
          }}
        >
          <strong style={{ fontSize: 12 }}>assistant-mcp</strong>
          <span>{detail}</span>
          {mcp.error ? <span style={{ color: 'var(--r-rose, #c46a6a)' }}>{mcp.error}</span> : null}
          {mcp.checkedAt ? <span style={{ opacity: 0.7 }}>checked {timeAgo(mcp.checkedAt)}</span> : null}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="r-btn r-btn-ghost"
              onClick={() => { void mcp.refresh(); }}
              title="Re-check Railway /health"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RefreshCw size={12} />
              refresh
            </button>
            <button
              type="button"
              className="r-btn r-btn-danger"
              onClick={handleRedeploy}
              disabled={mcp.redeploying}
              title="Trigger Railway redeploy of matt-assistant"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCcw size={12} />
              {mcp.redeploying ? 'redeploying…' : 'redeploy'}
            </button>
          </div>
        </span>
      ) : null}
    </span>
  );
}

function UserImageStrip({ images, imageCount }: { images?: ChatImagePreview[]; imageCount?: number }) {
  if (images?.length) {
    return (
      <div className="user-image-strip" aria-label={`${images.length} attached image${images.length === 1 ? '' : 's'}`}>
        {images.map((image, index) => (
          <figure key={`${image.dataUrl.slice(0, 48)}-${index}`} className="user-image-thumb">
            <img src={image.dataUrl} alt={`Sent image ${index + 1}`} />
          </figure>
        ))}
      </div>
    );
  }

  if (imageCount) {
    return (
      <div className="user-image-strip user-image-strip-placeholder" aria-label={`${imageCount} attached image${imageCount === 1 ? '' : 's'}`}>
        <span>{imageCount} image{imageCount === 1 ? '' : 's'}</span>
      </div>
    );
  }

  return null;
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
          <UserImageStrip images={block.images} imageCount={block.imageCount} />
          {block.text ? <p>{block.text}</p> : null}
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

function createTab(cli: CompanionId): ChatTab {
  return {
    id: `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    cli: normalizeCompanion(cli),
    title: FRESH_TITLE,
    createdAt: Date.now(),
  };
}

function defaultTab(cli: CompanionId): ChatTab {
  return {
    id: MAIN_CHAT_ID,
    cli: normalizeCompanion(cli),
    title: FRESH_TITLE,
    createdAt: Date.now(),
  };
}

function readTabs(initialCli: CompanionId): ChatTab[] {
  try {
    const raw = localStorage.getItem(CHAT_TABS_KEY);
    if (!raw) return [defaultTab(initialCli)];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [defaultTab(initialCli)];
    const tabs = parsed
      .map((item): ChatTab | null => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        if (typeof record.id !== 'string' || !record.id.trim()) return null;
        return {
          id: record.id,
          cli: normalizeCompanion(record.cli as CompanionId | undefined),
          title: typeof record.title === 'string' && record.title.trim() ? record.title : FRESH_TITLE,
          createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        };
      })
      .filter((item): item is ChatTab => Boolean(item));
    return tabs.length ? tabs : [defaultTab(initialCli)];
  } catch {
    return [defaultTab(initialCli)];
  }
}

function readActiveTabId(tabs: ChatTab[]): string {
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw && tabs.some((tab) => tab.id === raw)) return raw;
  } catch {
    // fall through
  }
  return tabs[0]?.id ?? MAIN_CHAT_ID;
}

function writeTabs(tabs: ChatTab[]) {
  localStorage.setItem(CHAT_TABS_KEY, JSON.stringify(tabs));
}

function readClosedTabs(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CLOSED_TABS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const cutoff = Date.now() - CLOSED_TAB_TTL_MS;
    const out: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === 'number' && ts >= cutoff) out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

// Tombstone tab ids so other windows drop them on merge instead of writing them
// back. The MAIN tab is never tombstoned — it's the always-present default.
function markTabsClosed(ids: string[]): void {
  const closeable = ids.filter((id) => id && id !== MAIN_CHAT_ID);
  if (!closeable.length) return;
  const closed = readClosedTabs();
  const now = Date.now();
  for (const id of closeable) closed[id] = now;
  try {
    localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(closed));
  } catch {
    // best-effort — a missed tombstone only risks a stale-window resurrection
  }
}

async function interruptLiveSession(session: LiveSession, repoPath: string, chatId: string): Promise<void> {
  const response = await fetch('/api/chat/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cli: session.cli, repo: repoPath, chatId }),
  });
  if (!response.ok) {
    throw new Error(`interrupt failed: ${response.status}`);
  }
}

function clearStoredTab(tab: ChatTab, repo: Repo | undefined): void {
  if (!repo) return;
  const suffix = tab.id === MAIN_CHAT_ID ? '' : `|${tab.id}`;
  const allClis: CompanionId[] = ['assistant', 'claude', 'codex', 'banana', 'banana-local', 'banana-fireworks', 'zai', 'xai'];
  for (const cli of allClis) {
    const key = `rivendell:chat-blocks:${cli}|${repo.path}${suffix}`;
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:seq`);
  }
}

function readActive(): ActiveChat | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.cli === 'claude' || parsed.cli === 'codex' || parsed.cli === 'assistant' || parsed.cli === 'banana') &&
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
  if (value === 'codex') return 'codex';
  if (value === 'banana') return 'banana';
  return 'assistant';
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
