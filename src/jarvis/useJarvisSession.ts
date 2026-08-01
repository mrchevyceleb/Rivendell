// LiveKit session hook for Jarvis: token fetch, room join, mic publish (AEC
// on), remote audio playback + analyser tap for the orb, data-channel wiring.

import { useCallback, useRef, useState } from 'react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';
import {
  JARVIS_TOPIC,
  decodeAgentMessage,
  encodeMessage,
  type JarvisAgentState,
  type JarvisEngineSettings,
} from './protocol';

export type JarvisPhase = 'idle' | 'connecting' | JarvisAgentState | 'error';

export type JarvisCaption = { role: 'user' | 'jarvis'; text: string; final: boolean };
export type JarvisToolEvent = { name: string; phrase: string; at: number };

function deviceId(): string {
  const KEY = 'rivendell:jarvis:device';
  let stored = localStorage.getItem(KEY);
  if (!stored) {
    stored = `dev${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, stored);
  }
  return stored;
}

export function useJarvisSession(opts: {
  onActivity: () => void;
  onClosed: (reason: string) => void;
}) {
  const [phase, setPhase] = useState<JarvisPhase>('idle');
  const [caption, setCaption] = useState<JarvisCaption | null>(null);
  const [tools, setTools] = useState<JarvisToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentSettings, setAgentSettings] = useState<JarvisEngineSettings | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioElsRef = useRef<HTMLMediaElement[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Kept in refs so stale closures inside room listeners never bite.
  const onActivityRef = useRef(opts.onActivity);
  const onClosedRef = useRef(opts.onClosed);
  onActivityRef.current = opts.onActivity;
  onClosedRef.current = opts.onClosed;

  const teardown = useCallback((reason: string, opts2?: { keepError?: boolean }) => {
    const room = roomRef.current;
    roomRef.current = null;
    for (const el of audioElsRef.current) {
      try {
        el.remove();
      } catch {
        /* detached */
      }
    }
    audioElsRef.current = [];
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (room) {
      void room.disconnect().catch(() => {});
    }
    setCaption(null);
    setTools([]);
    setAgentSettings(null);
    setMuted(false);
    if (!opts2?.keepError) {
      setError(null);
      setPhase('idle');
    }
    if (room) onClosedRef.current(reason);
  }, []);

  const start = useCallback(
    async (settings: JarvisEngineSettings) => {
      if (roomRef.current) return;
      setError(null);
      setPhase('connecting');
      try {
        const params = new URLSearchParams({ identity: deviceId(), cli: settings.cli });
        if (settings.model) params.set('model', settings.model);
        if (settings.effort) params.set('effort', settings.effort);
        const resp = await fetch(`/api/jarvis/token?${params.toString()}`);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error || `token endpoint returned ${resp.status}`);
        }
        const { url, token } = (await resp.json()) as { url: string; token: string };

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return;
          const el = track.attach();
          el.style.display = 'none';
          document.body.appendChild(el);
          audioElsRef.current.push(el);
          try {
            const ctx = audioCtxRef.current ?? new AudioContext();
            audioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;
            source.connect(analyser);
            analyserRef.current = analyser;
          } catch {
            /* orb falls back to phase-only animation */
          }
        });

        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setAudioBlocked(!room.canPlaybackAudio);
          if (!room.canPlaybackAudio) void room.startAudio().catch(() => {});
        });

        room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
          if (topic !== JARVIS_TOPIC) return;
          const msg = decodeAgentMessage(payload);
          if (!msg) return;
          onActivityRef.current();
          if (msg.type === 'state') {
            setPhase(msg.agentState);
          } else if (msg.type === 'caption') {
            setCaption({ role: msg.role, text: msg.text, final: msg.final });
          } else if (msg.type === 'tool') {
            setTools((prev) => [...prev.slice(-4), { name: msg.name, phrase: msg.phrase, at: Date.now() }]);
          } else if (msg.type === 'settings') {
            setAgentSettings({ cli: msg.cli, model: msg.model, effort: msg.effort });
          } else if (msg.type === 'closing') {
            teardown(msg.reason);
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          if (roomRef.current === room) teardown('disconnected');
        });

        await room.connect(url, token);
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
        });
        if (room.state === ConnectionState.Connected) setPhase('listening');
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
        teardown('start failed', { keepError: true });
      }
    },
    [teardown],
  );

  /** Retry audio playback after a user gesture: browser autoplay policy can
   *  leave attached <audio> elements paused while the agent "speaks" silently. */
  const unlockAudio = useCallback(() => {
    const room = roomRef.current;
    if (room) void room.startAudio().then(() => setAudioBlocked(!room.canPlaybackAudio)).catch(() => {});
    for (const el of audioElsRef.current) {
      void (el as HTMLAudioElement).play?.().catch(() => {});
    }
    if (audioCtxRef.current?.state === 'suspended') void audioCtxRef.current.resume().catch(() => {});
  }, []);

  const setMicMuted = useCallback((on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    setMuted(on);
    void room.localParticipant.setMicrophoneEnabled(!on).catch(() => {});
  }, []);

  const sendSettings = useCallback((settings: Partial<JarvisEngineSettings>) => {
    const room = roomRef.current;
    if (!room) return;
    void room.localParticipant
      .publishData(encodeMessage({ type: 'settings', ...settings }), { reliable: true, topic: JARVIS_TOPIC })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setPhase('idle');
      setError(null);
      return;
    }
    void room.localParticipant
      .publishData(encodeMessage({ type: 'dismiss' }), { reliable: true, topic: JARVIS_TOPIC })
      .catch(() => {});
    // Give the dismissal a beat to reach the agent, then drop the room.
    setTimeout(() => teardown('dismissed'), 250);
  }, [teardown]);

  return {
    phase,
    caption,
    tools,
    error,
    agentSettings,
    analyserRef,
    active: phase !== 'idle' && phase !== 'error',
    muted,
    audioBlocked,
    unlockAudio,
    setMicMuted,
    start,
    dismiss,
    sendSettings,
  };
}

export type JarvisSession = ReturnType<typeof useJarvisSession>;
