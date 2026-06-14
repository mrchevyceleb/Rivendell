import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SamPortrait } from './atoms';
import type { CommandEntry } from '../../data/types';
import { commandText, getCommandSuggestion, getCommandSuggestionMulti, type CommandSet } from '../../utils/commandAutocomplete';

// ─────────────────────────────────────────────
// Sam's message bubble — vellum, left-aligned, with avatar
// ─────────────────────────────────────────────
export function SamMessage({
  children,
  time,
  folio,
  name = 'Elrond',
}: { children: ReactNode; time?: string; folio?: string; name?: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 22 }}>
      <SamPortrait size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'baseline',
            marginBottom: 5,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              fontSize: 16,
              color: 'var(--ink-2)',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          {time && (
            <span className="sw-folio" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
              {time}
            </span>
          )}
          {folio && (
            <span
              className="sw-folio"
              style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 12 }}
            >
              {folio}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--serif-body)',
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--ink)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// User's message — ink-toned, right-aligned, no avatar
// ─────────────────────────────────────────────
export function UserMessage({
  children,
  time,
}: { children: ReactNode; time?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 22 }}>
      <div style={{ maxWidth: '85%' }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'baseline',
            marginBottom: 5,
            justifyContent: 'flex-end',
          }}
        >
          {time && (
            <span className="sw-folio" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
              {time}
            </span>
          )}
          <span className="sw-smallcaps" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            You
          </span>
        </div>
        <div
          style={{
            background: 'color-mix(in srgb, var(--r-elf-blue) 16%, var(--r-bg-raised))',
            color: 'var(--r-ink)',
            border: '1px solid color-mix(in srgb, var(--r-elf-blue) 30%, transparent)',
            padding: '9px 14px',
            borderRadius: 12,
            fontFamily: 'var(--serif-body)',
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ToolCall — quoted ledger excerpt
// ─────────────────────────────────────────────
function useElapsedSeconds(active: boolean, startedAt: number | undefined): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  if (!active || !startedAt) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

export function ToolCall({
  tool,
  args,
  result,
  status = 'done',
  running = false,
  startedAt,
}: {
  tool: string;
  args?: string;
  result?: string;
  status?: 'done' | string;
  running?: boolean;
  /** ms epoch when the tool call opened. Used to render a ticking elapsed
   *  counter while the call is in flight so long-running tools (Agent
   *  subagents, big greps) visibly show they're still working. */
  startedAt?: number;
}) {
  const elapsed = useElapsedSeconds(running, startedAt);
  const isSlow = elapsed !== null && elapsed >= 8;
  return (
    <div
      style={{
        borderLeft: running ? '3px solid var(--ember)' : '2px solid var(--rule)',
        paddingLeft: 14,
        marginTop: 10,
        marginBottom: 10,
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        background: running ? 'color-mix(in srgb, var(--ember) 6%, transparent)' : undefined,
        borderRadius: running ? 2 : 0,
        paddingTop: running ? 6 : 0,
        paddingBottom: running ? 6 : 0,
        transition: 'background 200ms ease, border-color 200ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
          marginBottom: 4,
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <span
          className="sw-smallcaps"
          style={{
            fontSize: 11,
            color: running ? 'var(--ember)' : 'var(--ink-soft)',
            whiteSpace: 'nowrap',
            fontWeight: running ? 600 : 400,
            letterSpacing: '0.08em',
          }}
        >
          {running ? 'Running' : status === 'done' ? 'Ran' : status}
        </span>
        <span
          className="sw-mono"
          style={{
            color: running ? 'var(--ink)' : 'var(--ink-2)',
            fontSize: 13.5,
            whiteSpace: 'nowrap',
            fontWeight: running ? 600 : 400,
          }}
        >
          {tool}
        </span>
        {elapsed !== null && (
          <span
            className="sw-mono"
            style={{
              fontSize: 12,
              color: isSlow ? 'var(--ember)' : 'var(--ink-faint)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: isSlow ? 600 : 400,
            }}
            title={isSlow ? 'Still working — long-running tool calls (Agent, big greps) can take minutes.' : undefined}
          >
            · {formatElapsed(elapsed)}
          </span>
        )}
        {args && (
          <span
            className="sw-mono"
            style={{
              color: 'var(--ink-faint)',
              fontSize: 13.5,
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              minWidth: 0,
              flex: '1 1 100%',
            }}
          >
            ({args})
          </span>
        )}
        {running && (
          <span className="sw-thinking" style={{ marginLeft: 'auto' }}>
            <span></span>
            <span></span>
            <span></span>
          </span>
        )}
      </div>
      {result && (
        <div
          className="sw-mono"
          style={{
            color: 'var(--ink-soft)',
            fontSize: 13.5,
            paddingLeft: 0,
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
          }}
        >
          {result}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// CodeBlock — ledger-line gutter
// ─────────────────────────────────────────────
export function CodeBlock({
  children,
  lang,
}: { children: string; lang?: string }) {
  const lines = children.split('\n');
  return (
    <div
      style={{
        background: 'var(--vellum)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 2,
        margin: '10px 0',
        overflow: 'hidden',
      }}
    >
      {lang && (
        <div
          style={{
            padding: '4px 12px',
            borderBottom: '1px solid var(--rule-soft)',
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            color: 'var(--ink-faint)',
            letterSpacing: '0.06em',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{lang}</span>
          <span
            style={{
              fontStyle: 'italic',
              fontFamily: 'var(--serif-display)',
              fontSize: 12,
            }}
          >
            {lines.length} lines
          </span>
        </div>
      )}
      <div style={{ padding: '8px 0', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.65 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex' }}>
            <span
              style={{
                minWidth: 36,
                textAlign: 'right',
                paddingRight: 12,
                color: 'var(--ink-faint)',
                userSelect: 'none',
                fontStyle: 'italic',
                fontFamily: 'var(--serif-display)',
                fontSize: 11,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                flex: 1,
                paddingRight: 12,
                whiteSpace: 'pre',
                color: 'var(--ink)',
              }}
            >
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DiffBlock
// ─────────────────────────────────────────────
export type DiffHunk = { t?: '+' | '-' | ' '; n?: number | string; l: string };

export function DiffBlock({
  filename,
  additions,
  deletions,
  hunks,
}: {
  filename: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}) {
  return (
    <div
      style={{
        background: 'var(--vellum)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 2,
        margin: '10px 0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--rule-soft)',
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ color: 'var(--ink-2)' }}>{filename}</span>
        <span style={{ color: 'var(--moss)' }}>+{additions}</span>
        <span style={{ color: 'var(--ember)' }}>−{deletions}</span>
      </div>
      <div style={{ padding: '6px 0', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}>
        {hunks.map((h, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              background:
                h.t === '+'
                  ? 'rgba(111,128,84,0.08)'
                  : h.t === '-'
                    ? 'rgba(184,89,58,0.07)'
                    : 'transparent',
            }}
          >
            <span
              style={{
                minWidth: 28,
                textAlign: 'right',
                paddingRight: 8,
                color: 'var(--ink-faint)',
                userSelect: 'none',
                fontSize: 11,
              }}
            >
              {h.n || ''}
            </span>
            <span
              style={{
                minWidth: 14,
                textAlign: 'center',
                color:
                  h.t === '+' ? 'var(--moss)' : h.t === '-' ? 'var(--ember)' : 'var(--ink-faint)',
              }}
            >
              {h.t || ' '}
            </span>
            <span style={{ flex: 1, paddingRight: 12, whiteSpace: 'pre', color: 'var(--ink)' }}>
              {h.l}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ChatInput — quill-and-paper composer
// ─────────────────────────────────────────────
export type ChatImage = { id: string; mediaType: string; base64: string; previewUrl: string };

export function ChatInput({
  value,
  onChange,
  onSend,
  onSteer,
  onBack,
  commands = [],
  commandPrefix = '/',
  commandSets,
  busy = false,
  placeholder = 'Speak, master.',
  agent = 'Claude Code',
  repo = '',
  acceptImages = true,
  compact = false,
}: {
  value?: string;
  onChange?: (v: string) => void;
  onSend?: (v: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onSteer?: (v: string, images?: Array<{ mediaType: string; base64: string }>) => void;
  onBack?: () => void;
  // Legacy single-prefix props (kept for compatibility).
  commands?: CommandEntry[];
  commandPrefix?: string;
  // Multi-prefix autocomplete: e.g. [{prefix:'/',commands:claude},{prefix:'$',commands:codex}].
  // When provided, takes precedence over commands/commandPrefix.
  commandSets?: CommandSet[];
  busy?: boolean;
  placeholder?: string;
  agent?: string;
  repo?: string;
  acceptImages?: boolean;
  /** Slim composer for the embedded Studio chat: no companion header, tighter
   *  padding, smaller text. The CompanionControls bar above already shows the agent. */
  compact?: boolean;
}) {
  const [internal, setInternal] = useState(value ?? '');
  const isControlled = value !== undefined;
  const v = isControlled ? value : internal;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ChatImage[]>([]);
  const suggestion = commandSets && commandSets.length
    ? getCommandSuggestionMulti(v, commandSets)
    : getCommandSuggestion(v, commandPrefix, commands);

  // Auto-grow with content. Reset to auto so scrollHeight reflects natural
  // content size, then size to that, capped by computed max-height. Toggle
  // overflow-y so the scrollbar only appears once we actually hit the cap —
  // otherwise subpixel rounding leaves a faint scrollbar on wrapped content.
  // useLayoutEffect (not useEffect) so the resize lands before paint.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const needed = el.scrollHeight;
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    el.style.height = `${Math.min(needed, max)}px`;
    el.style.overflowY = needed > max ? 'auto' : 'hidden';
  }, [v]);

  const setV = (next: string) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  const submit = () => {
    if (!v.trim() && images.length === 0) return;
    const imgs = images.length
      ? images.map((i) => ({ mediaType: i.mediaType, base64: i.base64 }))
      : undefined;
    if (busy && onSteer) {
      onSteer(v, imgs);
    } else {
      onSend?.(v, imgs);
    }
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.previewUrl);
      return [];
    });
    if (!isControlled) setInternal('');
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    setV(suggestion.fullText);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(suggestion.fullText.length, suggestion.fullText.length);
    });
  };

  const sendCommand = (name: string) => {
    const text = commandText(commandPrefix, name);
    if (busy && onSteer) onSteer(text);
    else onSend?.(text);
  };

  const ingestFiles = async (files: FileList | File[]) => {
    if (!acceptImages) return;
    const next: ChatImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      // chunked btoa to avoid call-stack overflow on large files
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const base64 = btoa(bin);
      const previewUrl = URL.createObjectURL(f);
      next.push({
        id: `img${Math.random().toString(36).slice(2, 8)}`,
        mediaType: f.type,
        base64,
        previewUrl,
      });
    }
    if (next.length) setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  return (
    <div
      style={{
        background: 'var(--vellum)',
        border: '1px solid var(--rule)',
        borderRadius: 2,
        padding: compact ? '8px 12px 10px' : '16px 18px 14px',
        boxShadow: '0 1px 0 var(--shadow-warm)',
      }}
    >
      <div
        style={{
          display: compact ? 'none' : 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: '1px dashed var(--rule-soft)',
        }}
      >
        <span className="sw-smallcaps" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
          Companion
        </span>
        <span
          style={{
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            fontSize: 15,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
          }}
        >
          {agent}
        </span>
        {repo && (
          <>
            <span style={{ color: 'var(--ink-faint)' }}>·</span>
            <span
              className="sw-mono"
              style={{
                fontSize: 13,
                color: 'var(--ink-soft)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {repo}
            </span>
          </>
        )}
        <span
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
          className="sw-folio"
        >
          ⌘K to switch
        </span>
        {onBack && (
          <button
            className="sw-btn"
            onClick={onBack}
            style={{
              fontSize: 13,
              padding: '6px 12px',
              minHeight: 0,
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              color: 'var(--ember)',
              flexShrink: 0,
            }}
          >
            threshold
          </button>
        )}
      </div>
      {images.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          {images.map((img) => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: 56,
                height: 56,
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid var(--rule-soft)',
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
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 0,
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 11,
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
      <div style={{ position: 'relative' }}>
        {suggestion && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              fontFamily: 'var(--serif-body)',
              fontSize: compact ? 15 : 19,
              lineHeight: 1.55,
              fontStyle: v ? 'normal' : 'italic',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'transparent',
              minHeight: compact ? 38 : 64,
              overflow: 'hidden',
            }}
          >
            <span>{v}</span>
            <span style={{ color: 'var(--ink-faint)' }}>{suggestion.tail}</span>
          </div>
        )}
        <textarea
          ref={taRef}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (suggestion && (e.key === 'Tab' || e.key === 'ArrowRight')) {
              e.preventDefault();
              acceptSuggestion();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
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
          placeholder={placeholder}
          rows={2}
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            resize: 'none',
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--serif-body)',
            fontSize: compact ? 15 : 19,
            lineHeight: 1.55,
            color: 'var(--ink)',
            fontStyle: v ? 'normal' : 'italic',
            minHeight: compact ? 38 : 64,
            maxHeight: compact ? '30dvh' : '40dvh',
            overflowY: 'hidden',
          }}
        />
      </div>
      {suggestion && (
        <button
          className="sw-btn"
          onClick={acceptSuggestion}
          style={{
            marginTop: 6,
            fontSize: 12.5,
            padding: '5px 10px',
            minHeight: 0,
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            color: 'var(--ink-soft)',
          }}
        >
          {commandText(suggestion.prefix, suggestion.command.name)}
        </button>
      )}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: compact ? 6 : 8 }}>
        <span className="sw-folio" style={{ fontStyle: 'italic', fontSize: 12, display: compact ? 'none' : undefined }}>
          ↵ to send · ⇧↵ for new line
        </span>
        <button
          className="sw-btn"
          style={{ fontSize: 13, padding: '7px 12px' }}
          onClick={() => sendCommand('match')}
          title={`send ${commandText(commandPrefix, 'match')}`}
        >
          {commandText(commandPrefix, 'match')}
        </button>
        <button
          className="sw-btn"
          style={{ fontSize: 13, padding: '7px 12px' }}
          onClick={() => sendCommand('push')}
          title={`send ${commandText(commandPrefix, 'push')}`}
        >
          {commandText(commandPrefix, 'push')}
        </button>
        <span style={{ marginLeft: 'auto' }}></span>
        {acceptImages && (
          <button
            className="sw-btn"
            style={{ fontSize: 14, padding: '8px 14px' }}
            onClick={() => fileInputRef.current?.click()}
          >
            Attach
          </button>
        )}
        <button
          className="sw-btn sw-btn-primary"
          style={{ fontSize: 14, padding: '8px 18px' }}
          onClick={submit}
          title={busy ? 'stop the current turn and redirect Sam with this prompt' : undefined}
        >
          {busy && onSteer ? 'Steer ↪' : 'Send'}
        </button>
      </div>
    </div>
  );
}
