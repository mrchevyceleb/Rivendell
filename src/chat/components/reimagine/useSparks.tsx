// Gold ✦ spark bursts for the reimagined chat easter eggs (§3.9): sigil click
// fires a radial burst, and sending exactly "mellon" fires one from the send
// button. Returns the rendered sparks (absolutely positioned, self-removing)
// plus a `burst(x, y)` imperative trigger.

import { useCallback, useState } from 'react';
import { StarSigil } from './icons';

type Spark = { id: number; x: number; y: number; fx: number; fy: number; dur: number };

export function useSparks() {
  const [sparks, setSparks] = useState<Spark[]>([]);
  const seq = useState(() => ({ n: 0 }))[0];

  const burst = useCallback((x: number, y: number) => {
    const next: Spark[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
      next.push({
        id: seq.n++,
        x,
        y,
        fx: Math.cos(a) * (34 + Math.random() * 40),
        fy: Math.sin(a) * (34 + Math.random() * 40),
        dur: 0.6 + Math.random() * 0.5,
      });
    }
    setSparks((prev) => [...prev, ...next]);
  }, [seq]);

  const node = (
    <>
      {sparks.map((s) => (
        <span
          key={s.id}
          className="spark"
          style={{
            left: s.x,
            top: s.y,
            ['--fx' as string]: `${s.fx}px`,
            ['--fy' as string]: `${s.fy}px`,
            animation: `rc-fly ${s.dur}s ease-out forwards`,
          } as React.CSSProperties}
          onAnimationEnd={() => setSparks((prev) => prev.filter((p) => p.id !== s.id))}
        >
          <StarSigil />
        </span>
      ))}
    </>
  );

  return { sparks: node, burst };
}
