/* global React */
// Rivendell — ornaments, runes, sigils, illumination

const Ornaments = (() => {
  const C = { gold: '#d4af63', goldSoft: '#b69447', silver: '#c5cee0', elf: '#6aa3ff', ink: '#7c849a' };

  // Evenstar / 8-point Elven star
  const Evenstar = ({ size = 24, color = C.silver, glow = false, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className}
         style={glow ? { filter: `drop-shadow(0 0 6px ${color})` } : {}}>
      <g fill="none" stroke={color} strokeWidth="1" strokeLinecap="round">
        <path d="M16 2 L18 14 L30 16 L18 18 L16 30 L14 18 L2 16 L14 14 Z" fill={color} fillOpacity="0.15"/>
        <path d="M16 5 L17 15 L27 16 L17 17 L16 27 L15 17 L5 16 L15 15 Z"/>
        <circle cx="16" cy="16" r="1.4" fill={color}/>
      </g>
    </svg>
  );

  // White Tree of Gondor-ish single sapling (tweak: more elven willow)
  const ElvenLeaf = ({ size = 20, color = C.gold, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <g fill="none" stroke={color} strokeWidth="0.9" strokeLinecap="round">
        <path d="M12 22 V8 Q12 3 16 2 Q14 6 12 8" />
        <path d="M12 14 Q8 12 6 8 Q10 10 12 14" />
        <path d="M12 16 Q16 14 18 10 Q14 12 12 16" />
        <circle cx="12" cy="22" r="0.8" fill={color}/>
      </g>
    </svg>
  );

  // Knotwork divider (full width)
  const KnotDivider = ({ color = C.gold, opacity = 0.55, className = '' }) => (
    <svg viewBox="0 0 400 16" preserveAspectRatio="none" className={className} style={{ width: '100%', height: 16, opacity }}>
      <g fill="none" stroke={color} strokeWidth="0.7" strokeLinecap="round">
        <line x1="0" y1="8" x2="160" y2="8"/>
        <line x1="240" y1="8" x2="400" y2="8"/>
        <circle cx="200" cy="8" r="3.5"/>
        <circle cx="200" cy="8" r="1" fill={color}/>
        <path d="M170 8 Q180 2 192 5 Q200 7 208 5 Q220 2 230 8"/>
        <path d="M170 8 Q180 14 192 11 Q200 9 208 11 Q220 14 230 8"/>
        <circle cx="172" cy="8" r="1.6"/>
        <circle cx="228" cy="8" r="1.6"/>
      </g>
    </svg>
  );

  // Vertical knotwork (for sidebar)
  const VineDivider = ({ color = C.gold, height = 200, opacity = 0.4 }) => (
    <svg viewBox="0 0 16 200" preserveAspectRatio="none" style={{ width: 16, height, opacity }}>
      <g fill="none" stroke={color} strokeWidth="0.7">
        <path d="M8 0 Q4 30 8 60 Q12 90 8 120 Q4 150 8 180 L8 200"/>
        <circle cx="6" cy="20" r="1.5"/>
        <circle cx="10" cy="50" r="1.5"/>
        <circle cx="6" cy="80" r="1.5"/>
        <circle cx="10" cy="110" r="1.5"/>
        <circle cx="6" cy="140" r="1.5"/>
        <circle cx="10" cy="170" r="1.5"/>
      </g>
    </svg>
  );

  // Corner flourish — for cards
  const Corner = ({ size = 28, color = C.gold, position = 'tl', opacity = 0.7 }) => {
    const transforms = { tl: '', tr: 'scaleX(-1)', bl: 'scaleY(-1)', br: 'scale(-1, -1)' };
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ transform: transforms[position], opacity, position: 'absolute',
        ...(position.includes('t') ? { top: 6 } : { bottom: 6 }),
        ...(position.includes('l') ? { left: 6 } : { right: 6 }),
        pointerEvents: 'none' }}>
        <g fill="none" stroke={color} strokeWidth="0.8" strokeLinecap="round">
          <path d="M2 14 V2 H14"/>
          <path d="M2 8 H8 V2"/>
          <circle cx="8" cy="8" r="1.4" fill={color} stroke="none"/>
          <path d="M14 4 Q19 6 16 10 Q12 8 14 4 Z"/>
          <path d="M4 14 Q6 19 10 16 Q8 12 4 14 Z"/>
        </g>
      </svg>
    );
  };

  // Ring symbol (very subtle nod)
  const Ring = ({ size = 18, color = C.gold, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="7" fill="none" stroke={color} strokeWidth="1.4"/>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke={color} strokeWidth="0.4" strokeDasharray="1 2"/>
    </svg>
  );

  // Signet — circular illuminated container
  const Signet = ({ size = 56, color = C.gold, children }) => (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      border: `1px solid ${color}`,
      background: `radial-gradient(circle, rgba(212,175,99,0.16), transparent 65%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 4, borderRadius: '50%',
        border: `0.5px solid ${color}`, opacity: 0.5,
      }}/>
      {children}
    </div>
  );

  // Tengwar-ish decorative line (visual only, not real tengwar)
  const TengwarLine = ({ color = C.silver, opacity = 0.45, width = 220, className = '' }) => (
    <svg viewBox="0 0 220 14" width={width} height="14" className={className} style={{ opacity }}>
      <g fill="none" stroke={color} strokeWidth="0.7" strokeLinecap="round">
        <path d="M2 7 Q6 2 10 7 Q14 12 18 7 L24 7 M28 4 Q32 7 28 10 M34 7 L40 7 Q44 4 44 7 Q44 10 40 10
                 M50 3 V11 M48 7 H52 M58 7 Q62 3 66 7 Q70 11 74 7 L80 7
                 M86 4 V10 M84 4 H88 M84 10 H88 M94 7 Q98 3 102 7 L108 7 Q112 4 112 7 Q112 10 108 10
                 M118 7 H126 M122 4 V10 M132 7 Q136 2 140 7 Q144 12 148 7
                 M154 4 V11 M152 7 H156 M162 7 Q166 4 170 7 Q174 10 178 7 L184 7
                 M190 3 V11 M188 7 H192 M198 7 Q202 4 206 7 Q210 10 214 7"/>
      </g>
    </svg>
  );

  // Tiny twinkle stars layer
  const StarField = ({ count = 30, opacity = 0.6 }) => {
    const stars = React.useMemo(() =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 1.4 + 0.4,
        delay: Math.random() * 4,
        duration: 2 + Math.random() * 3,
      })), [count]);
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', opacity }}>
        {stars.map((s, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: s.x + '%', top: s.y + '%',
            width: s.size, height: s.size,
            borderRadius: '50%',
            background: '#e6f2ff',
            boxShadow: `0 0 ${s.size * 3}px rgba(230, 242, 255, 0.9)`,
            animation: `r-twinkle ${s.duration}s ease-in-out infinite`,
            animationDelay: s.delay + 's',
          }}/>
        ))}
      </div>
    );
  };

  // Illuminated capital — wraps a single letter
  const IlluminatedCapital = ({ letter = 'A', size = 80, color = C.gold }) => (
    <div style={{
      position: 'relative',
      width: size, height: size,
      flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width={size} height={size} viewBox="0 0 80 80" style={{ position: 'absolute', inset: 0 }}>
        <g fill="none" stroke={color} strokeWidth="0.7" opacity="0.85">
          <rect x="2" y="2" width="76" height="76" rx="2"/>
          <rect x="6" y="6" width="68" height="68" rx="1" strokeWidth="0.4"/>
          <path d="M2 14 Q14 8 14 2 M2 22 Q22 14 22 2 M78 14 Q66 8 66 2 M78 22 Q58 14 58 2"/>
          <path d="M2 66 Q14 72 14 78 M2 58 Q22 66 22 78 M78 66 Q66 72 66 78 M78 58 Q58 66 58 78"/>
          <circle cx="14" cy="14" r="1.6" fill={color}/>
          <circle cx="66" cy="14" r="1.6" fill={color}/>
          <circle cx="14" cy="66" r="1.6" fill={color}/>
          <circle cx="66" cy="66" r="1.6" fill={color}/>
        </g>
      </svg>
      <span style={{
        fontFamily: 'Cormorant Garamond, serif',
        fontStyle: 'italic',
        fontWeight: 500,
        fontSize: size * 0.6,
        background: `linear-gradient(135deg, ${color} 0%, #f0d699 50%, ${color} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        position: 'relative',
        zIndex: 1,
        lineHeight: 1,
      }}>{letter}</span>
    </div>
  );

  return { Evenstar, ElvenLeaf, KnotDivider, VineDivider, Corner, Ring, Signet, TengwarLine, StarField, IlluminatedCapital };
})();

window.Ornaments = Ornaments;
