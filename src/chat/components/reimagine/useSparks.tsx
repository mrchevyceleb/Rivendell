// Spark bursts for the easter eggs: the sigil tap fires a radial burst, and a
// bare trigger phrase (allons-y, geronimo, fantastic, mellon) fires one from
// the send button. Particles are vortex-coloured motes with the odd tiny
// police box mixed in. Returns the rendered sparks (fixed-position,
// self-removing) plus a `burst(x, y)` imperative trigger.

import { useCallback, useState } from 'react';
import { BotMark } from '../../../grok/GrokLogo';

type Spark = {
  id: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  dur: number;
  kind: 'mote' | 'box';
  hue: 0 | 1 | 2;
};

export function useSparks() {
  const [sparks, setSparks] = useState<Spark[]>([]);
  const seq = useState(() => ({ n: 0 }))[0];

  const burst = useCallback((x: number, y: number) => {
    const next: Spark[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
      next.push({
        id: seq.n++,
        x,
        y,
        fx: Math.cos(a) * (34 + Math.random() * 44),
        fy: Math.sin(a) * (34 + Math.random() * 44),
        dur: 0.6 + Math.random() * 0.5,
        kind: i % 4 === 3 ? 'box' : 'mote',
        hue: (i % 3) as 0 | 1 | 2,
      });
    }
    setSparks((prev) => [...prev, ...next]);
  }, [seq]);

  const node = (
    <>
      {sparks.map((s) => (
        <span
          key={s.id}
          className={`spark spark-${s.kind} spark-h${s.hue}`}
          style={{
            left: s.x,
            top: s.y,
            ['--fx' as string]: `${s.fx}px`,
            ['--fy' as string]: `${s.fy}px`,
            animation: `rc-fly ${s.dur}s ease-out forwards`,
          } as React.CSSProperties}
          onAnimationEnd={() => setSparks((prev) => prev.filter((p) => p.id !== s.id))}
        >
          {s.kind === 'box' ? <BotMark size={12} lamp={false} /> : null}
        </span>
      ))}
    </>
  );

  return { sparks: node, burst };
}
