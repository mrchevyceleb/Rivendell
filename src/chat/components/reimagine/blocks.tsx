// Shared building blocks for the reimagined chat thread, used by BOTH the
// desktop (Conversation) and mobile (Mobile) screens. These render the real
// ChatBlock stream from useChat into the LOTR "Elrond speaks on the page"
// anatomy defined in the approved prototypes (§3.3 – §3.8).

import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatBlock } from '../../data/types';
import { Markdown } from '../primitives/Markdown';
import { ArtifactCard } from '../blocks/ArtifactCard';
import { DocLinkCard } from '../blocks/DocLinkCard';
import { FolderLinkCard } from '../blocks/FolderLinkCard';
import { ChevronDown, StarSigil } from './icons';
import { isAutomationPeer, isNoopToken, shouldHideAutomationTurn } from '../../utils/routineNoise';

const PHRASES = ['Elrond ponders', 'consulting the scrolls', 'weighing the words of the Wise', 'reading the stars'];

// Grok shell passes its own quiet phrases ('Thinking', …); the Studio keeps
// the elvish defaults.

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── day mark (centered italic serif between gold hairlines) ───────────────
export function DayMark({ label }: { label: string }) {
  return (
    <div className="daymark">
      <span>{label}</span>
    </div>
  );
}

// ── thinking indicator — §3.4 (spinning star, rotating phrase, hopping dots)
export function ThinkingIndicator({ phrases = PHRASES }: { phrases?: string[] }) {
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(1);
  useEffect(() => {
    const iv = window.setInterval(() => {
      setFade(0);
      window.setTimeout(() => {
        setI((n) => (n + 1) % phrases.length);
        setFade(1);
      }, 280);
    }, 1700);
    return () => window.clearInterval(iv);
  }, [phrases.length]);
  return (
    <div className="think">
      <StarSigil className="spin" />
      <span className="ph" style={{ opacity: fade }}>
        {phrases[i]}
      </span>
      <span className="dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/** SMS-style typing bubble: three bouncing dots in an agent-colored card,
 *  shown the moment a turn is busy — covers the cold-resume silence before
 *  any stream event lands (the old indicator never rendered in that gap
 *  whenever a stale open block suppressed it). */
export function TypingBubble() {
  return (
    <div className="typing-bubble" role="status" aria-label="Agent is typing">
      <span />
      <span />
      <span />
    </div>
  );
}

export type ThreadPin = {
  pinnedBlockIds: string[];
  onToggle: (target: { blockId: string; text: string; ts: number }) => void | Promise<void>;
};

// ── actions row (copy / pin) — §3.8 ───────────────────────────────────────
export function ActionsRow({
  getText,
  pinned,
  onTogglePin,
}: {
  getText: () => string;
  pinned?: boolean;
  onTogglePin?: () => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [localPinned, setLocalPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const isPinned = onTogglePin ? Boolean(pinned) : localPinned;
  return (
    <div className="acts">
      <button
        type="button"
        className={`act${copied ? ' copied' : ''}`}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard?.writeText(getText());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard unavailable / denied */
          }
        }}
      >
        {copied ? 'copied ✓' : 'copy'}
      </button>
      <button
        type="button"
        className={`act${isPinned ? ' copied' : ''}`}
        aria-pressed={isPinned}
        title={isPinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
        onClick={async (e) => {
          e.stopPropagation();
          if (onTogglePin) {
            if (busy) return;
            setBusy(true);
            try { await onTogglePin(); } finally { setBusy(false); }
            return;
          }
          setLocalPinned((p) => !p);
        }}
      >
        {isPinned ? 'pinned ✓' : 'pin'}
      </button>
    </div>
  );
}

// ── streaming text — §3.3 (raw tail fades via .tok + caret; full markdown
//    re-renders once the block closes) ─────────────────────────────────────
function StreamText({ text, open }: { text: string; open: boolean }) {
  // Track the length seen on the previous render so only the freshly appended
  // chunk gets the .tok fade (mirrors the prototype's per-word shimmer without
  // re-rendering the whole markdown tree every token).
  const prevLenRef = useRef(0);
  useEffect(() => {
    prevLenRef.current = text.length;
  }, [text]);

  if (!open) {
    return (
      <div className="prose">
        <Markdown>{text}</Markdown>
      </div>
    );
  }
  const prev = Math.min(prevLenRef.current, text.length);
  const head = text.slice(0, prev);
  const tail = text.slice(prev);
  return (
    <div className="prose">
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {head}
        {tail && <span className="tok">{tail}</span>}
        <span className="caret" />
      </p>
    </div>
  );
}

// ── tool card (collapsible working card) — §3.5 ───────────────────────────
function toolLines(b: Extract<ChatBlock, { kind: 'tool' }>): { html: string; count: number } {
  const lines: string[] = [];
  if (b.args) {
    try {
      const parsed = JSON.parse(b.args);
      const top = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed
          ? Object.keys(parsed).slice(0, 3)
          : null;
      if (top) lines.push(`<b>${escapeHtml(b.tool)}</b> · ${escapeHtml(JSON.stringify(top))}`);
      else lines.push(`<b>${escapeHtml(b.tool)}</b>`);
    } catch {
      lines.push(`<b>${escapeHtml(b.tool)}</b> · ${escapeHtml(b.args)}`);
    }
  } else {
    lines.push(`<b>${escapeHtml(b.tool)}</b>`);
  }
  if (b.result) lines.push(escapeHtml(b.result));
  return { html: lines.map((l) => `<span class="ln">${l}</span>`).join(''), count: lines.length };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function ToolCard({ block }: { block: Extract<ChatBlock, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(block.running);
  const wasRunningRef = useRef(block.running);
  // Auto-collapse with a beat when the tool finishes, mirroring the prototype.
  useEffect(() => {
    if (wasRunningRef.current && !block.running) {
      const t = window.setTimeout(() => setOpen(false), 260);
      wasRunningRef.current = block.running;
      return () => window.clearTimeout(t);
    }
    wasRunningRef.current = block.running;
    return undefined;
  }, [block.running]);

  const { html, count } = toolLines(block);
  const meta = block.running ? <RunningMeta since={block.ts} /> : `${count} step${count === 1 ? '' : 's'} · done`;
  return (
    <div className={`tool ${block.running ? 'running' : 'done'}${open ? ' open' : ''}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)}>
        <StarSigil className="tstar" />
        <span className="tool-title">{block.tool}</span>
        <span className="tool-meta">{meta}</span>
        <ChevronDown className="tool-chev" />
      </button>
      <div className="tool-body">
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

// ── compaction marker — the forever-thread's "context rotated" line ────
function PeerBubble({ block }: { block: Extract<ChatBlock, { kind: 'peer' }> }) {
  const initial = (block.from || '?').trim().slice(0, 1).toUpperCase();
  // Strip the team-bus envelope line so the bubble shows just the words.
  const text = block.text.replace(/^\[message from teammate[^\]]*\]\n?/, '');
  return (
    <div className="bt-peer">
      <span className="bt-peer-head">
        <span className="bt-peer-disc">{initial}</span>
        <span className="bt-peer-name">{block.from}</span>
        {block.fromRole ? <span className="bt-peer-role">→ to you</span> : <span className="bt-peer-role">→ to you</span>}
      </span>
      <div className="bt-peer-body">{text}</div>
    </div>
  );
}

function CompactDivider({ block }: { block: Extract<ChatBlock, { kind: 'compact' }> }) {
  const words = block.words >= 1000 ? `${(block.words / 1000).toFixed(1)}k` : block.words;
  return (
    <div className="compact-mark" title={`Auto-compaction #${block.count}: durable memory document (${block.words} words) generated from ${block.turns} turns${block.savedToRag ? ' and saved to the RAG vault' : ''}. The thread continues losslessly.`}>
      <span className="compact-line" />
      <span className="compact-label">Memory compacted · {words} words{block.savedToRag === false ? '' : ' · saved to RAG'}</span>
      <span className="compact-line" />
    </div>
  );
}

function RestartDivider({ block }: { block: Extract<ChatBlock, { kind: 'restart' }> }) {
  return (
    <div className="compact-mark restart-mark" title="Rivendell restarted while a turn was running — the in-flight tool call's output was lost with the process. Ask the agent to re-check the work.">
      <span className="compact-line" />
      <span className="compact-label">Service restarted mid-turn</span>
      <span className="compact-line" />
    </div>
  );
}

const ENGINE_LABEL: Record<string, string> = {
  xai: 'Grok',
  zai: 'GLM',
  claude: 'Claude',
  assistant: 'Claude',
  codex: 'Codex',
  banana: 'OpenRouter',
  'banana-local': 'Local',
  'banana-fireworks': 'Fireworks',
};

function engineLabel(id: string): string {
  return ENGINE_LABEL[id] ?? id;
}

function SwitchDivider({ block }: { block: Extract<ChatBlock, { kind: 'switch' }> }) {
  const from = engineLabel(block.from);
  const to = engineLabel(block.to);
  const model = block.model ? ` · ${block.model}` : '';
  return (
    <div className="compact-mark switch-mark" title={`This thread stayed put. ${to} will answer from here on${block.model ? ` (${block.model})` : ''}.`}>
      <span className="compact-line" />
      <span className="compact-label">Switched {from} → {to}{model}</span>
      <span className="compact-line" />
    </div>
  );
}

// ── user bubble ───────────────────────────────────────────────────────────
// ── Thoughts pod (Grok anatomy) — in a multi-step turn, every assistant text
//    block except the final one is working narrative; collapse it into an
//    expandable card so the feed keeps Grok's two-level rhythm. Grok shell
//    only (ChatThread prop); the Studio keeps every step inline.
function StepsCard({ steps }: { steps: Array<Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' }>> }) {
  const [open, setOpen] = useState(false);
  const lines: string[] = [];
  for (const s of steps) {
    if (s.kind === 'text') lines.push(s.text);
    else lines.push(`⚙ ${s.tool}${s.running ? ' · working…' : ' · done'}`);
  }
  return (
    <div className={`tool steps${open ? ' open' : ''}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)}>
        <StarSigil className="tstar" />
        <span className="tool-title">Thoughts</span>
        <span className="tool-meta">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
        <ChevronDown className="tool-chev" />
      </button>
      <div className="tool-body">
        <pre>{lines.join('\n\n')}</pre>
      </div>
    </div>
  );
}

function UserBubble({ block }: { block: Extract<ChatBlock, { kind: 'user' }> }) {
  const images = block.images ?? [];
  const missing = Math.max(0, (block.imageCount ?? images.length) - images.length);
  // data: URLs can't be top-level navigated to in Chrome — clone via blob.
  // Open the tab synchronously (popup blockers kill async window.open once
  // the click's transient activation expires), then navigate when ready.
  const openImage = (e: React.MouseEvent, src: string) => {
    if (!src.startsWith('data:')) return;
    e.preventDefault();
    const win = window.open('', '_blank');
    if (!win) return;
    void fetch(src)
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        win.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch(() => win.close());
  };
  return (
    <div className="msg m-user">
      {images.length ? (
        <div className="uimg-row">
          {images.map((img, i) => (
            <a key={i} href={img.dataUrl} target="_blank" rel="noreferrer" className="uimg-link" onClick={(e) => openImage(e, img.dataUrl)}>
              <img className="uimg" src={img.dataUrl} alt={`attachment ${i + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
      {missing > 0 ? (
        <span className="uimg-missing">
          📎 {block.attachmentsLost || images.length
            ? `${missing} image${missing === 1 ? '' : 's'} not kept`
            : `${missing} image${missing === 1 ? '' : 's'} attached`}
        </span>
      ) : null}
      <div className="bubble">{block.text}</div>
      <span className="when">{timeLabel(block.ts)}</span>
    </div>
  );
}

type AssistantBlock = Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' } | { kind: 'doc-link' } | { kind: 'folder-link' } | { kind: 'artifact' }>;
type StepBlock = Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' }>;
type ToolBlock = Extract<ChatBlock, { kind: 'tool' }>;

/** Live "working · m:ss" heartbeat for running tool calls. Long subprocess
 *  waits (codex reviews, big bashes) used to render a static "working…" for
 *  minutes and read as a dead agent — a ticking counter proves it's alive. */
function RunningMeta({ since }: { since: number }) {
  // Wall clock for the initial elapsed (block.ts is Date.now-based), then
  // advance monotonically — a system-clock adjustment must not jump or zero
  // the counter mid-wait.
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - since));
  useEffect(() => {
    const base = { perf: performance.now(), elapsed: Math.max(0, Date.now() - since) };
    setElapsed(base.elapsed);
    const iv = window.setInterval(() => {
      setElapsed(Math.max(0, base.elapsed + (performance.now() - base.perf)));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [since]);
  const sec = Math.floor(elapsed / 1000);
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return <>working · {mm}:{ss}</>;
}

// ── Tools card (Grok anatomy) — a run of consecutive tool calls collapses
//    into ONE expandable card instead of N stacked pods eating the feed.
//    Collapsed: "8 tool calls · done" plus a one-line name summary. Expanded:
//    the individual ToolCards, each still expandable itself.
function ToolsCard({ blocks }: { blocks: ToolBlock[] }) {
  const [open, setOpen] = useState(false);
  const running = blocks.some((b) => b.running);
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.tool, (counts.get(b.tool) ?? 0) + 1);
  const summary = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ');
  const oldestRunning = blocks.find((b) => b.running);
  return (
    <div className={`tool tools-run${running ? ' running' : ' done'}${open ? ' open' : ''}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <StarSigil className="tstar" />
        <span className="tool-title">{blocks.length} tool calls</span>
        <span className="tool-meta">{running && oldestRunning ? <RunningMeta since={oldestRunning.ts} /> : 'done'}</span>
        <ChevronDown className="tool-chev" />
      </button>
      {open ? null : <div className="tools-summary">{summary}</div>}
      <div className="tool-body">
        {/* Mounted only while open: a zero-height overflow-hidden box still
            exposes focusable buttons to keyboard/AT when collapsed. */}
        {open ? (
          <div className="tools-list">
            {blocks.map((b) => <ToolCard key={b.id} block={b} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function hasVisibleProse(b: Extract<ChatBlock, { kind: 'text' }>): boolean {
  return b.text.trim().length > 0;
}

/** Protocol no-ops that must not steal the Grok answer slot. Broader
 *  isQuietRoutineReply ("nothing happened", …) is for automation hide, not
 *  for promoting a human turn's last sentence. */
function isProtocolNoopText(text: string): boolean {
  return isNoopToken(text);
}

function isAnswerProse(b: Extract<ChatBlock, { kind: 'text' }>): boolean {
  const t = b.text.trim();
  return t.length > 0 && !isProtocolNoopText(t);
}

function showTextCaret(b: Extract<ChatBlock, { kind: 'text' }>, streaming: boolean): boolean {
  return Boolean(b.open) && streaming;
}

/** Grok mode: last real prose is the visible reply. Empty or quiet trailing
 *  text used to steal that slot, so the feed was Thoughts-only and a completed
 *  turn looked dead. While an empty/noop last block is still open, keep it as
 *  the answer slot (caret only) so working narrative stays in the pod. */
function planCollapsedSteps(
  blocks: AssistantBlock[],
  collapseSteps: boolean,
  streaming: boolean,
): { finalTextId: string | null; stepBlocks: StepBlock[] } {
  if (!collapseSteps) return { finalTextId: null, stepBlocks: [] };
  const textBlocks = blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text');
  if (textBlocks.length === 0) return { finalTextId: null, stepBlocks: [] };

  const answerTexts = textBlocks.filter(isAnswerProse);
  const nonempty = textBlocks.filter(hasVisibleProse);
  const visible = answerTexts.length > 0 ? answerTexts : nonempty;
  const last = textBlocks[textBlocks.length - 1];
  const holdStreamingSlot = Boolean(
    streaming && last && last.open && (!hasVisibleProse(last) || isProtocolNoopText(last.text)),
  );
  const final = holdStreamingSlot ? last : (visible[visible.length - 1] ?? null);
  const finalTextId = final?.id ?? null;
  if (!finalTextId || textBlocks.length < 2) return { finalTextId: null, stepBlocks: [] };

  const finalIdx = blocks.findIndex((b) => b.id === finalTextId);
  // Only collapse work that happened BEFORE the answer. Tools after a
  // promoted earlier reply must stay after it — they are not thoughts.
  const stepBlocks = blocks.filter((b, i): b is StepBlock =>
    (b.kind === 'text' || b.kind === 'tool')
    && b.id !== finalTextId
    && i < finalIdx
    && (b.kind !== 'text' || isAnswerProse(b)),
  );
  return { finalTextId, stepBlocks };
}

// A run of consecutive assistant blocks that share a turnId render under a
// single "✦ Elrond" header (the prototype's per-turn group).
function ElrondGroup({
  blocks,
  streaming,
  mobile,
  collapseSteps = false,
  pin,
}: {
  blocks: AssistantBlock[];
  streaming: boolean;
  mobile: boolean;
  collapseSteps?: boolean;
  pin?: ThreadPin;
}) {
  const [acted, setActed] = useState(false);
  const first = blocks[0];
  const textBlocks = blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text');
  const copyText = () => {
    const src = textBlocks.filter(isAnswerProse);
    return (src.length ? src : textBlocks.filter(hasVisibleProse)).map((b) => b.text).join('\n\n');
  };
  const isPinned = Boolean(pin?.pinnedBlockIds.includes(first.id));
  // Grok mode: collapse the working narrative into a Thoughts pod rendered
  // immediately before the final answer. The pod folds in non-final text AND
  // tool blocks (in original order), so chronology is preserved inside it and
  // no tool is ever shown after a step it actually preceded.
  const { finalTextId, stepBlocks } = planCollapsedSteps(blocks, collapseSteps, streaming);
  const stepIds = new Set(stepBlocks.map((b) => b.id));
  // Grok mode: fold RUNS of consecutive tool blocks (the ones not already in
  // the Thoughts pod) into a single expandable card. One-off tools keep their
  // own card. Studio mode stays fully inline.
  const toolRuns = new Map<string, ToolBlock[]>();
  const toolRunSkip = new Set<string>();
  if (collapseSteps) {
    let run: ToolBlock[] = [];
    const flush = () => {
      if (run.length > 1) {
        toolRuns.set(run[0].id, run);
        for (const b of run.slice(1)) toolRunSkip.add(b.id);
      }
      run = [];
    };
    for (const b of blocks) {
      if (b.kind === 'tool' && !stepIds.has(b.id)) run.push(b);
      else flush();
    }
    flush();
  }
  // Anchor the pod to the last collapsed step BEFORE the final answer — if a
  // tool runs after the final text, the pod must still land ahead of the
  // answer (never after it). If every step comes after the final text
  // (degenerate order), pin the pod to the answer's own slot, rendered first.
  const indexById = new Map(blocks.map((b, i) => [b.id, i]));
  const finalIdx = finalTextId ? indexById.get(finalTextId) ?? blocks.length : blocks.length;
  const before = stepBlocks.filter((b) => (indexById.get(b.id) ?? 0) < finalIdx);
  const podAnchorId = before.length ? before[before.length - 1].id : finalTextId;
  return (
    <div
      id={`msg-pin-${first.id}`}
      data-pin-block={first.id}
      className={`msg m-elrond${acted ? ' acted' : ''}${isPinned ? ' pinned' : ''}`}
      onClick={mobile ? () => setActed((a) => !a) : undefined}
    >
      <div className="who">
        <span className="mini">✦</span> Elrond <span className="when">{timeLabel(first.ts)}</span>
      </div>
      {blocks.map((b) => {
        if (stepIds.has(b.id)) {
          if (b.id !== podAnchorId) return null;
          return <StepsCard key="steps" steps={stepBlocks} />;
        }
        // Degenerate order (all steps after the answer): pod rides first.
        if (b.id === podAnchorId && b.id === finalTextId && stepBlocks.length && b.kind === 'text') {
          const open = showTextCaret(b, streaming);
          const display = isProtocolNoopText(b.text) ? '' : b.text;
          const showAnswer = open || display.length > 0;
          if (!showAnswer) {
            return <StepsCard key="steps" steps={stepBlocks} />;
          }
          return (
            <Fragment key={`steps-plus-${b.id}`}>
              <StepsCard steps={stepBlocks} />
              <StreamText text={display} open={open} />
            </Fragment>
          );
        }
        switch (b.kind) {
          case 'tool': {
            if (toolRunSkip.has(b.id)) return null;
            const run = toolRuns.get(b.id);
            if (run) return <ToolsCard key={b.id} blocks={run} />;
            return <ToolCard key={b.id} block={b} />;
          }
          case 'text': {
            const open = showTextCaret(b, streaming);
            const display = isProtocolNoopText(b.text) ? '' : b.text;
            if (!open && !display) return null;
            if (!open && !isAnswerProse(b) && b.id !== finalTextId && textBlocks.some(isAnswerProse)) return null;
            return <StreamText key={b.id} text={display} open={open} />;
          }
          case 'doc-link':
            return <DocLinkCard key={b.id} path={b.path} title={b.title} />;
          case 'folder-link':
            return <FolderLinkCard key={b.id} path={b.path} title={b.title} />;
          case 'artifact':
            return <ArtifactCard key={b.id} artifactId={b.artifactId} artifactKind={b.artifactKind} title={b.title} />;
          default:
            return null;
        }
      })}
      {(textBlocks.some(isAnswerProse) || textBlocks.some(hasVisibleProse)) && !streaming ? (
        <ActionsRow
          getText={copyText}
          pinned={isPinned}
          onTogglePin={pin ? () => {
            const src = textBlocks.filter(isAnswerProse);
            const visible = src.length ? src : textBlocks.filter(hasVisibleProse);
            const last = visible[visible.length - 1];
            return pin.onToggle({ blockId: first.id, text: last?.text ?? copyText(), ts: first.ts });
          } : undefined}
        />
      ) : null}
    </div>
  );
}

export type ChatThreadProps = {
  blocks: ChatBlock[];
  status: string;
  contentRef?: React.Ref<HTMLDivElement>;
  bottomRef?: React.Ref<HTMLDivElement>;
  mobile?: boolean;
  noteUnread?: () => void;
  /** Grok shell overrides the elvish thinking phrases. */
  phrases?: string[];
  /** Grok shell: collapse multi-step working narrative into a Thoughts pod. */
  collapseSteps?: boolean;
  /** Grok shell: persist pin into the focused agent's right-pane pocket. */
  pin?: ThreadPin;
  /** Grok shell: SMS-style typing bubble instead of the star indicator. */
  typingBubble?: boolean;
  /** Suppress the typing indicator entirely (silent automation turn running). */
  suppressTyping?: boolean;
};

// Renders the full feed: day marks on day changes, user bubbles, per-turn
// Elrond groups (tool cards + streaming prose), and the thinking indicator
// while a turn is live but no content has landed yet.
export function ChatThread({ blocks, status, contentRef, bottomRef, mobile = false, phrases, collapseSteps = false, pin, typingBubble = false, suppressTyping = false }: ChatThreadProps) {
  const streaming = status === 'streaming';
  // The indicator lives until something VISIBLE is on screen — an open block
  // with empty text (the window between content_block_start and the first
  // token) renders as a bare caret, which reads as "the indicator vanished".
  const hasVisible = blocks.some(
    (b) =>
      (b.kind === 'text' && (b as Extract<ChatBlock, { kind: 'text' }>).open && (b as Extract<ChatBlock, { kind: 'text' }>).text.trim().length > 0) ||
      (b.kind === 'tool' && (b as Extract<ChatBlock, { kind: 'tool' }>).running),
  );

  // Group consecutive assistant blocks (same turnId) and user blocks.
  const groups: Array<
    | { type: 'user'; block: Extract<ChatBlock, { kind: 'user' }>; day: string }
    | { type: 'elrond'; blocks: Array<Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' } | { kind: 'doc-link' } | { kind: 'folder-link' } | { kind: 'artifact' }>>; day: string }
    | { type: 'compact'; block: Extract<ChatBlock, { kind: 'compact' }>; day: string }
    | { type: 'restart'; block: Extract<ChatBlock, { kind: 'restart' }>; day: string }
    | { type: 'switch'; block: Extract<ChatBlock, { kind: 'switch' }>; day: string }
    | { type: 'peer'; block: Extract<ChatBlock, { kind: 'peer' }>; day: string }
  > = [];
  let lastDay = '';
  for (const b of blocks) {
    const day = dayLabel(b.ts);
    if (b.kind === 'compact') {
      groups.push({ type: 'compact', block: b, day: lastDay || day });
      continue;
    }
    if (b.kind === 'restart') {
      groups.push({ type: 'restart', block: b, day: lastDay || day });
      continue;
    }
    if (b.kind === 'switch') {
      groups.push({ type: 'switch', block: b, day: lastDay || day });
      continue;
    }
    if (b.kind === 'user') {
      groups.push({ type: 'user', block: b, day });
    } else if (b.kind === 'peer') {
      groups.push({ type: 'peer', block: b, day });
    } else if (b.kind === 'text' || b.kind === 'tool' || b.kind === 'doc-link' || b.kind === 'folder-link' || b.kind === 'artifact') {
      const last = groups[groups.length - 1];
      const turnId = (b as { turnId?: string }).turnId;
      // Grok mode (collapseSteps): one user prompt → one assistant response.
      // Assistant turns in Rivendell exist ONLY as replies to a user send or
      // as automation narrative — so consecutive assistant blocks with no user
      // message between them are one working run by construction, and merge
      // into a single group whose narrative collapses into the Thoughts pod
      // (the final text block renders as the answer). Studio mode keeps
      // strict turnId grouping.
      const merge = last && last.type === 'elrond' && (collapseSteps
        ? true
        : turnId && last.blocks[0] && (last.blocks[0] as { turnId?: string }).turnId === turnId);
      if (merge) {
        last.blocks.push(b);
        last.day = day;
      } else {
        groups.push({ type: 'elrond', blocks: [b], day });
      }
    }
  }

  const nodes: ReactNode[] = [];
  let pendingAutomation = false;
  let hideThinking = false;
  for (const g of groups) {
    if (g.type === 'peer' && isAutomationPeer(g.block.from, g.block.fromRole, g.block.text)) {
      pendingAutomation = true;
      hideThinking = true;
      continue;
    }
    if (g.type === 'user' || g.type === 'compact' || g.type === 'restart' || g.type === 'switch' || g.type === 'peer') {
      pendingAutomation = false;
      hideThinking = false;
    }
    if (g.type === 'elrond' && pendingAutomation) {
      pendingAutomation = false;
      const hasRunningTool = g.blocks.some((b) => b.kind === 'tool' && b.running);
      const isLive = g.blocks.some(
        (b) => (b.kind === 'text' && b.open) || (b.kind === 'tool' && b.running),
      );
      const texts = g.blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text').map((b) => b.text);
      const hasNonText = g.blocks.some((b) => b.kind !== 'text');
      if (shouldHideAutomationTurn({ texts, hasRunningTool, isLive, hasNonText })) {
        hideThinking = isLive;
        continue;
      }
      hideThinking = false;
    } else if (g.type === 'elrond') {
      const hasRunningTool = g.blocks.some((b) => b.kind === 'tool' && b.running);
      const isLive = g.blocks.some(
        (b) => (b.kind === 'text' && b.open) || (b.kind === 'tool' && b.running),
      );
      const texts = g.blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text').map((b) => b.text);
      // Standalone protocol no-ops (NO_UPDATE / Quiet) stay out of the feed.
      // Broader quiet-routine phrases ("nothing happened") still show on human
      // turns — automation hide is the pendingAutomation branch above.
      const hasNonText = g.blocks.some((b) => b.kind !== 'text');
      const hasRealProse = texts.some((t) => t.trim() && !isProtocolNoopText(t));
      if (!hasRunningTool && !isLive && !hasNonText && !hasRealProse && texts.some((t) => t.trim())) {
        continue;
      }
    }
    if (g.day !== lastDay) {
      nodes.push(<DayMark key={`dm-${g.day}-${nodes.length}`} label={g.day} />);
      lastDay = g.day;
    }
    if (g.type === 'user') {
      nodes.push(<UserBubble key={g.block.id} block={g.block} />);
    } else if (g.type === 'compact') {
      nodes.push(<CompactDivider key={g.block.id} block={g.block} />);
    } else if (g.type === 'restart') {
      nodes.push(<RestartDivider key={g.block.id} block={g.block} />);
    } else if (g.type === 'switch') {
      nodes.push(<SwitchDivider key={g.block.id} block={g.block} />);
    } else if (g.type === 'peer') {
      nodes.push(<PeerBubble key={g.block.id} block={g.block} />);
    } else {
      nodes.push(<ElrondGroup key={g.blocks[0].id} blocks={g.blocks} streaming={streaming} mobile={mobile} collapseSteps={collapseSteps} pin={pin} />);
    }
  }

  if (streaming && !hasVisible && !hideThinking && !pendingAutomation && !suppressTyping) {
    nodes.push(typingBubble ? <TypingBubble key="thinking" /> : <ThinkingIndicator key="thinking" phrases={phrases} />);
  }

  return (
    <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 18 : 22 }}>
      {nodes}
      <div ref={bottomRef} />
    </div>
  );
}
