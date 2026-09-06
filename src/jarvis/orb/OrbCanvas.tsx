// The Jarvis orb: Canvas-2D, audio-reactive, in the TARDIS palette (brass
// core, vortex-teal aura). States: breathe (idle/listening), ripple (listening),
// swirl (thinking/connecting), waveform pulse (speaking, analyser-driven).

import { useEffect, useRef } from 'react';
import type { JarvisPhase } from '../useJarvisSession';

const GOLD = '217, 168, 90'; // --r-gold (brass)
const BLUE = '58, 160, 166'; // vortex teal, lifted for canvas
const STAR = '245, 239, 226'; // --r-star

export function OrbCanvas(props: {
  phase: JarvisPhase;
  analyserRef: React.RefObject<AnalyserNode | null>;
  size?: number;
}) {
  const { phase, analyserRef } = props;
  const size = props.size ?? 320;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<JarvisPhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const center = size / 2;
    const freqData = new Uint8Array(128);
    let raf = 0;
    let level = 0;
    const ripples: Array<{ r: number; alpha: number }> = [];
    let lastRippleAt = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const t = now / 1000;
      const p = phaseRef.current;

      // Audio level (speaking) with smooth decay.
      let target = 0;
      const analyser = analyserRef.current;
      if (analyser && p === 'speaking') {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i]!;
        target = Math.min(1, sum / freqData.length / 140);
      }
      level += (target - level) * 0.25;

      ctx.clearRect(0, 0, size, size);

      const breathe = Math.sin(t * (p === 'thinking' ? 2.4 : 1.4)) * 0.04;
      const coreR = size * 0.16 * (1 + breathe + level * 0.55);

      // Outer aura
      const aura = ctx.createRadialGradient(center, center, coreR * 0.4, center, center, size * 0.48);
      aura.addColorStop(0, `rgba(${BLUE}, ${0.28 + level * 0.25})`);
      aura.addColorStop(0.55, `rgba(${BLUE}, 0.10)`);
      aura.addColorStop(1, `rgba(${BLUE}, 0)`);
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, size, size);

      // Listening ripples
      if (p === 'listening' && now - lastRippleAt > 1400) {
        ripples.push({ r: coreR * 1.2, alpha: 0.5 });
        lastRippleAt = now;
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]!;
        ripple.r += 0.9;
        ripple.alpha *= 0.985;
        if (ripple.alpha < 0.02 || ripple.r > size * 0.48) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(center, center, ripple.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${STAR}, ${ripple.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Thinking swirl: orbiting sparks
      if (p === 'thinking' || p === 'connecting' || p === 'initializing') {
        for (let i = 0; i < 5; i++) {
          const angle = t * 1.8 + (i * Math.PI * 2) / 5;
          const orbitR = coreR * 1.9 + Math.sin(t * 3 + i) * 4;
          const x = center + Math.cos(angle) * orbitR;
          const y = center + Math.sin(angle) * orbitR * 0.92;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${STAR}, ${0.55 + Math.sin(t * 4 + i) * 0.3})`;
          ctx.fill();
        }
      }

      // Speaking bars: radial waveform ring
      if (p === 'speaking' && analyser) {
        const bars = 48;
        for (let i = 0; i < bars; i++) {
          const v = (freqData[Math.floor((i / bars) * freqData.length)] ?? 0) / 255;
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const inner = coreR * 1.45;
          const outer = inner + 4 + v * size * 0.09;
          ctx.beginPath();
          ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
          ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
          ctx.strokeStyle = `rgba(${GOLD}, ${0.25 + v * 0.6})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Gold core
      const core = ctx.createRadialGradient(center, center, 1, center, center, coreR);
      core.addColorStop(0, `rgba(255, 244, 214, ${0.95})`);
      core.addColorStop(0.45, `rgba(${GOLD}, 0.9)`);
      core.addColorStop(1, `rgba(${GOLD}, 0.06)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(center, center, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Core ring
      ctx.beginPath();
      ctx.arc(center, center, coreR * 1.18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${GOLD}, ${0.4 + level * 0.4})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, analyserRef]);

  return (
    <canvas
      ref={canvasRef}
      className="jarvis-orb-canvas"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
