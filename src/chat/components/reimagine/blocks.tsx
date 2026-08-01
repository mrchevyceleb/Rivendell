// Shared building blocks for the reimagined chat thread, used by BOTH the
// desktop (Conversation) and mobile (Mobile) screens. These render the real
// ChatBlock stream from useChat into the LOTR "Elrond speaks on the page"
// anatomy defined in the approved prototypes (§3.3 – §3.8).

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatBlock } from '../../data/types';
import { Markdown } from '../primitives/Markdown';
import { ArtifactCard } from '../blocks/ArtifactCard';
import { DocLinkCard } from '../blocks/DocLinkCard';
import { FolderLinkCard } from '../blocks/FolderLinkCard';
import { ChevronDown, StarSigil } from './icons';

const PHRASES = ['Elrond ponders', 'consulting the scrolls', 'weighing the words of the Wise', 'reading the stars'];

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
export function ThinkingIndicator() {
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(1);
  useEffect(() => {
    const iv = window.setInterval(() => {
      setFade(0);
      window.setTimeout(() => {
        setI((n) => (n + 1) % PHRASES.length);
        setFade(1);
      }, 280);
    }, 1700);
    return () => window.clearInterval(iv);
  }, []);
  return (
    <div className="think">
      <StarSigil className="spin" />
      <span className="ph" style={{ opacity: fade }}>
        {PHRASES[i]}
      </span>
      <span className="dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

// ── actions row (copy / pin) — §3.8 ───────────────────────────────────────
export function ActionsRow({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <div className="acts">
      <button
        type="button"
        className={`act${copied ? ' copied' : ''}`}
        onClick={async () => {
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
        className={`act${pinned ? ' copied' : ''}`}
        onClick={() => setPinned(true)}
      >
        {pinned ? 'pinned ✓' : 'pin'}
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
  const meta = block.running ? 'working…' : `${count} step${count === 1 ? '' : 's'} · done`;
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

// ── user bubble ───────────────────────────────────────────────────────────
function UserBubble({ block }: { block: Extract<ChatBlock, { kind: 'user' }> }) {
  return (
    <div className="msg m-user">
      <div className="bubble">{block.text}</div>
      <span className="when">{timeLabel(block.ts)}</span>
    </div>
  );
}

// A run of consecutive assistant blocks that share a turnId render under a
// single "✦ Elrond" header (the prototype's per-turn group).
function ElrondGroup({
  blocks,
  streaming,
  mobile,
}: {
  blocks: Array<Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' } | { kind: 'doc-link' } | { kind: 'folder-link' } | { kind: 'artifact' }>>;
  streaming: boolean;
  mobile: boolean;
}) {
  const [acted, setActed] = useState(false);
  const first = blocks[0];
  const textBlocks = blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text');
  const copyText = () => textBlocks.map((b) => b.text).join('\n\n');
  return (
    <div className={`msg m-elrond${acted ? ' acted' : ''}`} onClick={mobile ? () => setActed((a) => !a) : undefined}>
      <div className="who">
        <span className="mini">✦</span> Elrond <span className="when">{timeLabel(first.ts)}</span>
      </div>
      {blocks.map((b) => {
        switch (b.kind) {
          case 'tool':
            return <ToolCard key={b.id} block={b} />;
          case 'text':
            return <StreamText key={b.id} text={b.text} open={Boolean(b.open) && streaming} />;
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
      {textBlocks.length > 0 && !streaming ? <ActionsRow getText={copyText} /> : null}
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
};

// Renders the full feed: day marks on day changes, user bubbles, per-turn
// Elrond groups (tool cards + streaming prose), and the thinking indicator
// while a turn is live but no content has landed yet.
export function ChatThread({ blocks, status, contentRef, bottomRef, mobile = false }: ChatThreadProps) {
  const streaming = status === 'streaming';
  const hasOpen = blocks.some(
    (b) =>
      (b.kind === 'text' && (b as Extract<ChatBlock, { kind: 'text' }>).open) ||
      (b.kind === 'tool' && (b as Extract<ChatBlock, { kind: 'tool' }>).running),
  );

  // Group consecutive assistant blocks (same turnId) and user blocks.
  const groups: Array<
    | { type: 'user'; block: Extract<ChatBlock, { kind: 'user' }>; day: string }
    | { type: 'elrond'; blocks: Array<Extract<ChatBlock, { kind: 'text' } | { kind: 'tool' } | { kind: 'doc-link' } | { kind: 'folder-link' } | { kind: 'artifact' }>>; day: string }
  > = [];
  let lastDay = '';
  for (const b of blocks) {
    const day = dayLabel(b.ts);
    if (b.kind === 'user') {
      groups.push({ type: 'user', block: b, day });
    } else if (b.kind === 'text' || b.kind === 'tool' || b.kind === 'doc-link' || b.kind === 'folder-link' || b.kind === 'artifact') {
      const last = groups[groups.length - 1];
      const turnId = (b as { turnId?: string }).turnId;
      if (last && last.type === 'elrond' && turnId && last.blocks[0] && (last.blocks[0] as { turnId?: string }).turnId === turnId) {
        last.blocks.push(b);
        last.day = day;
      } else {
        groups.push({ type: 'elrond', blocks: [b], day });
      }
    }
  }

  const nodes: ReactNode[] = [];
  for (const g of groups) {
    if (g.day !== lastDay) {
      nodes.push(<DayMark key={`dm-${g.day}-${nodes.length}`} label={g.day} />);
      lastDay = g.day;
    }
    if (g.type === 'user') {
      nodes.push(<UserBubble key={g.block.id} block={g.block} />);
    } else {
      nodes.push(<ElrondGroup key={g.blocks[0].id} blocks={g.blocks} streaming={streaming} mobile={mobile} />);
    }
  }

  if (streaming && !hasOpen) {
    nodes.push(<ThinkingIndicator key="thinking" />);
  }

  return (
    <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 18 : 22 }}>
      {nodes}
      <div ref={bottomRef} />
    </div>
  );
}
