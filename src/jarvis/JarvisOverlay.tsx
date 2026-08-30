// Full-screen Jarvis surface (ProxyViewer overlay pattern): orb front and
// center, live captions, tool ticker, preset chips, auto-dismiss countdown.
// Phase 2 swaps the orb for the Anam face video when a face session is live.

import { useEffect } from 'react';
import { Mic, MicOff, Volume2, X, Zap, BrainCircuit } from 'lucide-react';
import { useJarvis } from './JarvisProvider';
import { OrbCanvas } from './orb/OrbCanvas';
import './jarvis.css';

export function JarvisOverlay() {
  const jarvis = useJarvis();
  const { session, overlayOpen } = jarvis;

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') jarvis.dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen, jarvis]);

  if (!overlayOpen) return null;

  const phaseLabel =
    session.phase === 'connecting' || session.phase === 'initializing'
      ? 'summoning'
      : session.phase === 'error'
        ? 'unavailable'
        : session.phase;

  return (
    <div
      className="jarvis-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Jarvis"
      onClick={session.unlockAudio}
    >
      <button className="jarvis-close" onClick={jarvis.dismiss} title="Dismiss (Esc)" aria-label="Dismiss Jarvis">
        <X size={18} />
      </button>

      {session.audioBlocked && (
        <button className="jarvis-chip jarvis-audio-unlock" onClick={session.unlockAudio}>
          <Volume2 size={14} /> Tap to enable Jarvis's voice
        </button>
      )}

      <div className="jarvis-stage">
        <OrbCanvas phase={session.phase} analyserRef={session.analyserRef} />
        <div className={`jarvis-phase jarvis-phase-${session.phase}`}>{phaseLabel}</div>

        {session.error ? (
          <div className="jarvis-error">
            {jarvis.configured
              ? `Jarvis hit a snag: ${session.error}`
              : 'Jarvis is not configured yet. LiveKit keys are missing on the server.'}
          </div>
        ) : (
          <div className="jarvis-caption" aria-live="polite">
            {session.caption ? (
              <span className={session.caption.role === 'user' ? 'jarvis-caption-user' : 'jarvis-caption-jarvis'}>
                {session.caption.text}
              </span>
            ) : (
              <span className="jarvis-caption-hint">Speak, sir. I'm listening.</span>
            )}
          </div>
        )}

        {session.tools.length > 0 && (
          <div className="jarvis-ticker">
            {session.tools.map((tool) => (
              <span key={`${tool.name}-${tool.at}`} className="jarvis-ticker-item">
                {tool.phrase}
              </span>
            ))}
          </div>
        )}
      </div>

      <footer className="jarvis-controls">
        <div className="jarvis-presets" role="radiogroup" aria-label="Engine preset">
          <button
            className={`jarvis-chip ${jarvis.preset === 'snappy' ? 'active' : ''}`}
            onClick={() => jarvis.setPreset('snappy')}
            title="Grok 4.6, high effort - faster spoken turns"
          >
            <Zap size={13} /> Swift
          </button>
          <button
            className={`jarvis-chip ${jarvis.preset === 'deep' ? 'active' : ''}`}
            onClick={() => jarvis.setPreset('deep')}
            title="Grok 4.6, max effort - the default"
          >
            <BrainCircuit size={13} /> Max
          </button>
        </div>

        <button
          className={`jarvis-chip ${session.muted ? 'active' : ''}`}
          onClick={() => session.setMicMuted(!session.muted)}
          title={session.muted ? 'Unmute: Jarvis can hear you again' : 'Mute: Jarvis stops hearing you (great during calls)'}
        >
          {session.muted ? <MicOff size={13} /> : <Mic size={13} />}
          {session.muted ? 'Muted' : 'Mute'}
        </button>

        <button
          className={`jarvis-chip jarvis-wake-toggle ${jarvis.wakeEnabled ? 'active' : ''}`}
          onClick={() => jarvis.setWakeEnabled(!jarvis.wakeEnabled)}
          title={jarvis.wakeEnabled ? 'Wake word on: say "Jarvis" anytime' : 'Wake word off'}
        >
          {jarvis.wakeEnabled ? <Mic size={13} /> : <MicOff size={13} />}
          {jarvis.wakeEnabled ? 'Wake word on' : 'Wake word off'}
        </button>

        {jarvis.dismissCountdownMs !== null && (
          <span className="jarvis-countdown">
            dismissing in {Math.max(1, Math.ceil(jarvis.dismissCountdownMs / 1000))}s
          </span>
        )}

        {session.agentSettings && (
          <span className="jarvis-engine-note">
            {session.agentSettings.model ?? session.agentSettings.cli}
            {session.agentSettings.effort ? ` · ${session.agentSettings.effort}` : ''}
          </span>
        )}
      </footer>
    </div>
  );
}
