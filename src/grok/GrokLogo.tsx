// The Rivendell mark — an 8-pointed star (Star of Eärendil silhouette) for
// now; it can be restyled later. Replaces the earlier blob+eyes glyph that
// leaned too close to the Grok Bot logo. Same component API so every
// call site (rail mark, empty state, wordmark) switches in one place.

export function BotMark({ size = 28 }: { size?: number; eyes?: boolean }) {
  // Long rays at N/E/S/W, shorter diagonals — reads cleanly from 16px up.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="currentColor">
        <path d="M50 0 L57.5 42.5 L100 50 L57.5 57.5 L50 100 L42.5 57.5 L0 50 L42.5 42.5 Z" />
        <path d="M15 15 L46 39 L39 46 Z" />
        <path d="M85 15 L54 39 L61 46 Z" />
        <path d="M15 85 L46 61 L39 54 Z" />
        <path d="M85 85 L54 61 L61 54 Z" />
        <circle cx="50" cy="50" r="9" />
      </g>
    </svg>
  );
}

export function BotWordmark({ text = 'Rivendell', size = 40 }: { text?: string; size?: number }) {
  return (
    <span className="bt-landing-brand">
      <BotMark size={Math.round(size * 1.15)} />
      <span className="bt-wordmark" style={{ fontSize: size }}>{text}</span>
    </span>
  );
}
