// CallOverlay — the iPhone-call screen for a full-parity teammate turn.
// LiveKit provides speech I/O while the normal bot-* Hall thread owns the
// model, tools, memory, durable transcript, and continued work after hangup.

import { useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import type { JarvisEngineSettings } from '../jarvis/protocol';
import { useThreadVoiceCall } from './useThreadVoiceCall';
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

export function CallOverlay({ agent, settings, repoPath, onClose }: { agent: Agent; settings: JarvisEngineSettings; repoPath: string; onClose: () => void }) {
  const call = useThreadVoiceCall(agent, settings, repoPath);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    call.start().catch((e: Error) => {
      call.end();
      onClose();
      console.error('[call] failed to start:', e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Remote hangup closes the overlay after a beat so "Call ended" is seen.
  useEffect(() => {
    if (call.state !== 'ended') return undefined;
    const timer = window.setTimeout(onClose, 1400);
    return () => window.clearTimeout(timer);
  }, [call.state, onClose]);

  const bars = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);
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
              style={{ animationDelay: `${i * 0.09}s`, animationPlayState: call.state === 'speaking' || call.state === 'listening' ? 'running' : 'paused', opacity: call.state === 'speaking' ? 0.9 : call.state === 'listening' ? 0.55 : 0.25 }}
            />
          ))}
        </div>

        <div className="riv-call-transcript">
          {transcript.map((t, i) => (
            <div key={i} className={`riv-call-line riv-call-line-${t.role}`}>{t.text}</div>
          ))}
          {call.liveUser ? <div className="riv-call-line riv-call-line-user">{call.liveUser}</div> : null}
          {call.tools.slice(-1).map((tool) => (
            <div key={`${tool.name}-${tool.at}`} className="riv-call-line riv-call-line-tool">{tool.phrase}</div>
          ))}
        </div>
      </div>

      {call.audioBlocked ? (
        <button type="button" className="riv-call-audio-unlock" onClick={call.unlockAudio}>
          Tap to enable voice audio
        </button>
      ) : null}
      {call.error ? <div className="riv-call-error">{call.error}</div> : null}

      <div className="riv-call-voice">
        <span className="riv-call-voicebtn" aria-label="This call uses the same durable teammate thread">
          Live thread · {settings.model ?? settings.cli}{settings.effort ? ` · ${settings.effort}` : ''}
        </span>
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
        <button className="riv-call-ctl end" onClick={call.end} aria-label="End call" title="End call">
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}
