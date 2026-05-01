import type { ReactNode } from 'react';

type SvgProps = {
  size?: number;
  color?: string;
  glow?: boolean;
  className?: string;
};

export function Evenstar({ size = 24, color = 'var(--r-silver)', glow = false, className = '' }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={glow ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
      aria-hidden="true"
    >
      <g fill="none" stroke={color} strokeWidth="1" strokeLinecap="round">
        <path d="M16 2 L18 14 L30 16 L18 18 L16 30 L14 18 L2 16 L14 14 Z" fill={color} fillOpacity="0.15" />
        <path d="M16 5 L17 15 L27 16 L17 17 L16 27 L15 17 L5 16 L15 15 Z" />
        <circle cx="16" cy="16" r="1.4" fill={color} />
      </g>
    </svg>
  );
}

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
      <g fill="none" stroke={color} strokeWidth="0.8" strokeLinecap="round">
        <path d="M2 14 V2 H14" />
        <path d="M2 8 H8 V2" />
        <circle cx="8" cy="8" r="1.4" fill={color} stroke="none" />
        <path d="M14 4 Q19 6 16 10 Q12 8 14 4 Z" />
        <path d="M4 14 Q6 19 10 16 Q8 12 4 14 Z" />
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

export function IlluminatedCapital({ letter = 'A', size = 72 }: { letter?: string; size?: number }) {
  return (
    <div className="illuminated-capital" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
        <g fill="none" stroke="var(--r-gold)" strokeWidth="0.7" opacity="0.85">
          <rect x="2" y="2" width="76" height="76" rx="2" />
          <rect x="6" y="6" width="68" height="68" rx="1" strokeWidth="0.4" />
          <path d="M2 14 Q14 8 14 2 M2 22 Q22 14 22 2 M78 14 Q66 8 66 2 M78 22 Q58 14 58 2" />
          <path d="M2 66 Q14 72 14 78 M2 58 Q22 66 22 78 M78 66 Q66 72 66 78 M78 58 Q58 66 58 78" />
          <circle cx="14" cy="14" r="1.6" fill="var(--r-gold)" />
          <circle cx="66" cy="14" r="1.6" fill="var(--r-gold)" />
          <circle cx="14" cy="66" r="1.6" fill="var(--r-gold)" />
          <circle cx="66" cy="66" r="1.6" fill="var(--r-gold)" />
        </g>
      </svg>
      <span>{letter}</span>
    </div>
  );
}

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
