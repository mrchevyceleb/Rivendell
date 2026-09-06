// CallOverlay — the iPhone-call screen for talking to a companion over the
// Grok realtime voice line (grok-voice-think-fast-2.0 via /ws/voice): full
// screen, the agent's disc, name, state, duration, live waveform bars, a
// transcript ticker, mute/end circles, and a voice picker that swaps the
// Grok voice mid-call.

import { useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, PhoneOff, ChevronUp, ChevronDown } from 'lucide-react';
import { useGrokCall, GROK_VOICES, type VoiceId } from './useGrokCall';
import { agentColor, agentAvatarUrl, type Agent } from '../grok/agents';
import './call.css';

const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  connecting: 'Calling…',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Call ended',
  error: 'Lost the line',
};

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallOverlay({ agent, initialVoice, onClose }: { agent: Agent; initialVoice: string; onClose: () => void }) {
  const call = useGrokCall();
  const [voice, setVoiceState] = useState<VoiceId>((GROK_VOICES.find((v) => v.id === initialVoice)?.id) ?? 'ara');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    call.start(agent.id, voice).catch((e: Error) => {
      call.end();
      onClose();
      console.error('[call] failed to start:', e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // A remote hang-up closes the overlay after a beat so "Call ended" is seen.
  useEffect(() => {
    if (call.state !== 'ended') return undefined;
    const timer = window.setTimeout(onClose, 1400);
    return () => window.clearTimeout(timer);
  }, [call.state, onClose]);

  const bars = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);
  const voiceLabel = GROK_VOICES.find((v) => v.id === voice)?.label ?? voice;
  const transcript = [...call.turns].slice(-3);

  return (
    <div className="riv-call" role="dialog" aria-modal="true" aria-label={`Voice call with ${agent.name}`}>
      <div className="riv-call-top">
        <span className="riv-call-chip">
          <span className={`riv-call-dot riv-call-dot-${call.state}`} />
          {STATE_LABEL[call.state] ?? call.state} · {fmt(call.durationSec)}
        </span>
      </div>

      <div className="riv-call-hero">
        <div className={`riv-call-disc${call.state === 'speaking' ? ' speaking' : ''}`} style={{ background: agentColor(agent.name) }}>
          {agentAvatarUrl(agent) ? <img src={agentAvatarUrl(agent) ?? undefined} alt={agent.name} /> : agent.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="riv-call-name">{agent.name}</div>
        <div className="riv-call-sub">{agent.role}</div>

        <div className="riv-call-wave" aria-hidden="true">
          {bars.map((i) => (
            <span
              key={i}
              className="riv-call-bar"
              style={{
                animationDelay: `${i * 0.09}s`,
                animationPlayState: call.state === 'speaking' || call.state === 'listening' ? 'running' : 'paused',
                opacity: call.state === 'speaking' ? 0.55 + call.level * 0.45 : 0.25 + call.micLevel * 0.75,
              }}
            />
          ))}
        </div>

        <div className="riv-call-transcript">
          {transcript.map((t, i) => (
            <div key={i} className={`riv-call-line riv-call-line-${t.role}`}>{t.text}</div>
          ))}
          {call.liveUser ? <div className="riv-call-line riv-call-line-user">{call.liveUser}</div> : null}
        </div>
      </div>

      {call.error ? <div className="riv-call-error">{call.error}</div> : null}

      <div className="riv-call-voice">
        <button className="riv-call-voicebtn" onClick={() => setVoiceOpen((o) => !o)} aria-expanded={voiceOpen}>
          Voice · {voiceLabel} {voiceOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {voiceOpen ? (
          <div className="riv-call-voicegrid bt-fade">
            {GROK_VOICES.map((v) => (
              <button
                key={v.id}
                className={`riv-call-voicechip${v.id === voice ? ' on' : ''}`}
                onClick={() => { setVoiceState(v.id); call.setVoice(v.id); setVoiceOpen(false); }}
              >
                {v.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="riv-call-controls">
        <button
          className={`riv-call-ctl${call.muted ? ' muted' : ''}`}
          onClick={call.toggleMute}
          aria-label={call.muted ? 'Unmute' : 'Mute'}
          title={call.muted ? 'Unmute' : 'Mute'}
        >
          {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button className="riv-call-ctl end" onClick={() => { call.end(); onClose(); }} aria-label="End call" title="End call">
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}
