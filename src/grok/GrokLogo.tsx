// The TARDIS mark — a police-box silhouette in currentColor with an amber
// lamp on top. Stepped roof, "POLICE BOX" sign slot, 2×2 window panes and the
// door split are cut out with evenodd so it reads from 16px (favicon) up to
// 64px (empty state). Same component API as before so every call site (rail
// mark, empty state, wordmark, ornaments) switches in one place.

export function BotMark({ size = 28, lamp = true, className }: { size?: number; lamp?: boolean; className?: string; eyes?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M24 97 H76 V93 H73 V28 H75 V24 H69 V19 H62 V14 H54 V11 H46 V14 H38 V19 H31 V24 H25 V28 H27 V93 H24 Z M31 31 H69 V33.5 H31 Z M33 40 H47 V50 H33 Z M53 40 H67 V50 H53 Z M33 54 H47 V64 H33 Z M53 54 H67 V64 H53 Z M49.2 68 H50.8 V90 H49.2 Z"
      />
      {lamp ? (
        <g className="bt-mark-lamp">
          <circle cx="50" cy="7.5" r="7" fill="currentColor" opacity="0.18" />
          <circle cx="50" cy="7.5" r="3.6" fill="currentColor" />
        </g>
      ) : null}
    </svg>
  );
}

export function BotWordmark({ text = 'TARDIS', size = 40 }: { text?: string; size?: number }) {
  return (
    <span className="bt-landing-brand">
      <BotMark size={Math.round(size * 1.15)} />
      <span className="bt-wordmark" style={{ fontSize: size }}>{text}</span>
    </span>
  );
}
