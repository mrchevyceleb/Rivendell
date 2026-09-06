import type { ReactNode } from 'react';
import { BotMark } from '../grok/GrokLogo';

type SvgProps = {
  size?: number;
  color?: string;
  glow?: boolean;
  className?: string;
};

/** The brand mark in ornament clothing. Kept under its old export name so the
    Studio topbar and Dashboard call sites did not have to move; `TardisMark`
    is the honest alias for new code. */
export function Evenstar({ size = 24, color = 'var(--r-tardis-lit)', glow = false, className = '' }: SvgProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        lineHeight: 0,
        color,
        filter: glow ? 'drop-shadow(0 0 6px var(--r-elf-glow))' : undefined,
      }}
      aria-hidden="true"
    >
      <BotMark size={size} />
    </span>
  );
}
export const TardisMark = Evenstar;

/** Roundel corner: three concentric quarter-arcs meeting at the corner dot. */
export function Corner({ position = 'tl', size = 28, color = 'var(--r-gold)' }: { position?: 'tl' | 'tr' | 'bl' | 'br'; size?: number; color?: string }) {
  const transforms = { tl: '', tr: 'scaleX(-1)', bl: 'scaleY(-1)', br: 'scale(-1, -1)' };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`corner corner-${position}`}
      style={{ transform: transforms[position] }}
      aria-hidden="true"
    >
      <g fill="none" stroke={color} strokeWidth="0.9" strokeLinecap="round">
        <path d="M2 18 A16 16 0 0 1 18 2" />
        <path d="M2 10 A8 8 0 0 1 10 2" strokeWidth="0.6" opacity="0.7" />
        <path d="M2 26 A24 24 0 0 1 26 2" strokeWidth="0.5" opacity="0.5" />
        <circle cx="2" cy="2" r="1.4" fill={color} stroke="none" />
      </g>
    </svg>
  );
}

export function Signet({ size = 34, color = 'var(--r-gold)', children }: { size?: number; color?: string; children: ReactNode }) {
  return (
    <div
      className="signet"
      style={{
        width: size,
        height: size,
        borderColor: color,
        color,
      }}
    >
      {children}
    </div>
  );
}

/** Roundel medallion around a capital: concentric rings, four tick marks,
    four brass dots at the cardinal points. */
export function IlluminatedCapital({ letter = 'A', size = 72 }: { letter?: string; size?: number }) {
  return (
    <div className="illuminated-capital" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
        <g fill="none" stroke="var(--r-gold)" strokeWidth="0.7" opacity="0.85">
          <circle cx="40" cy="40" r="37" />
          <circle cx="40" cy="40" r="31" strokeWidth="0.4" />
          <circle cx="40" cy="40" r="25" strokeWidth="0.4" opacity="0.6" />
          <path d="M40 3 V9 M40 71 V77 M3 40 H9 M71 40 H77" />
          <circle cx="40" cy="3" r="1.6" fill="var(--r-gold)" />
          <circle cx="40" cy="77" r="1.6" fill="var(--r-gold)" />
          <circle cx="3" cy="40" r="1.6" fill="var(--r-gold)" />
          <circle cx="77" cy="40" r="1.6" fill="var(--r-gold)" />
        </g>
      </svg>
      <span>{letter}</span>
    </div>
  );
}

/** The stars outside the doors (Studio shell only; hidden in Classic). */
export function StarField() {
  return (
    <div className="star-field" aria-hidden="true">
      {Array.from({ length: 54 }, (_, index) => {
        const x = (index * 37) % 100;
        const y = (index * 73) % 100;
        const size = ((index * 13) % 14) / 10 + 0.4;
        return (
          <i
            key={index}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              animationDelay: `${index * 0.13}s`,
              animationDuration: `${2 + (index % 5)}s`,
            }}
          />
        );
      })}
    </div>
  );
}
