import type { CSSProperties, ReactNode } from 'react';

// ─────────────────────────────────────────────
// SamPortrait — the gardener himself.
// ─────────────────────────────────────────────
export function SamPortrait({
  size = 32,
  glow = false,
  ring = true,
}: { size?: number; glow?: boolean; ring?: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        boxShadow: ring
          ? `0 0 0 1px var(--rule), 0 1px 0 var(--shadow-warm)${glow ? ', 0 0 24px rgba(184,89,58,0.18)' : ''}`
          : glow
            ? '0 0 24px rgba(184,89,58,0.18)'
            : 'none',
        background: 'var(--vellum)',
      }}
    >
      <img
        src="/sam.png"
        alt="Samwise"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Lantern — the Samwise sigil.
// ─────────────────────────────────────────────
export function Lantern({
  size = 24,
  lit = true,
  color = 'var(--ink)',
  flame = 'var(--ember)',
}: { size?: number; lit?: boolean; color?: string; flame?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2 L16 5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 5 L19 5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M16 6 L25 11 L25 22 L16 27 L7 22 L7 11 Z"
        stroke={color}
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M16 9 L22 12.5 L22 20.5 L16 24 L10 20.5 L10 12.5 Z"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        strokeLinejoin="round"
        opacity="0.5"
      />
      {lit ? (
        <g className="sw-flame">
          <ellipse cx="16" cy="17" rx="2.4" ry="3.4" fill={flame} opacity="0.9" />
          <ellipse cx="16" cy="17.5" rx="1.2" ry="2" fill="#f3c07a" />
        </g>
      ) : (
        <ellipse cx="16" cy="17" rx="2" ry="2.8" fill={color} opacity="0.15" />
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────
// Dinkus — chapter ornament
// ─────────────────────────────────────────────
export function Dinkus({
  color = 'var(--ink-faint)',
  size = 10,
}: { color?: string; size?: number }) {
  return (
    <svg width={size * 4} height={size} viewBox="0 0 40 10" fill="none">
      <path d="M0 5 L14 5" stroke={color} strokeWidth="0.6" />
      <circle cx="20" cy="5" r="1.4" fill={color} />
      <path d="M16.5 5 L23.5 5" stroke={color} strokeWidth="0.6" />
      <path d="M26 5 L40 5" stroke={color} strokeWidth="0.6" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Chip — small status pill
// ─────────────────────────────────────────────
type ChipTone = 'neutral' | 'ember' | 'moss' | 'gold';
const chipTones: Record<ChipTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: 'var(--vellum)', fg: 'var(--ink-2)', dot: 'var(--ink-faint)' },
  ember: { bg: 'rgba(184,89,58,0.08)', fg: 'var(--ember)', dot: 'var(--ember)' },
  moss: { bg: 'rgba(111,128,84,0.1)', fg: 'var(--moss)', dot: 'var(--moss)' },
  gold: { bg: 'rgba(164,129,66,0.1)', fg: 'var(--gold)', dot: 'var(--gold)' },
};

export function Chip({
  children,
  dot,
  tone = 'neutral',
  style,
}: { children: ReactNode; dot?: boolean; tone?: ChipTone; style?: CSSProperties }) {
  const t = chipTones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '4px 10px',
        borderRadius: 2,
        background: t.bg,
        color: t.fg,
        fontFamily: 'var(--serif-body)',
        fontSize: 13.5,
        border: '1px solid ' + (tone === 'neutral' ? 'var(--rule-soft)' : 'transparent'),
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot }} />
      )}
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────
// Search glyph used in command palette
// ─────────────────────────────────────────────
export function SearchGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="var(--ink-soft)" strokeWidth="1.2" />
      <path d="M9 9 L12 12" stroke="var(--ink-soft)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
