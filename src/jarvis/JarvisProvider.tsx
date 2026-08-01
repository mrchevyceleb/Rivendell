// Jarvis context: owns the wake-word lifecycle, engine preset prefs, the
// LiveKit session, the Ctrl+J hotkey, and the 45-second silence auto-dismiss.
// Mounted in App.tsx around the Studio shell; the overlay renders on top.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { JARVIS_PRESETS, type JarvisEngineSettings } from './protocol';
import { useJarvisSession, type JarvisSession } from './useJarvisSession';
import { NullWakeEngine, type WakeWordEngine } from './wake/WakeWordEngine';
import { PorcupineWakeEngine } from './wake/porcupineEngine';
import { WebSpeechWakeEngine } from './wake/webSpeechEngine';

const WAKE_PREF_KEY = 'rivendell:jarvis:wake';
const PRESET_KEY = 'rivendell:jarvis:preset';
const AUTO_DISMISS_MS = 120_000;
const COUNTDOWN_VISIBLE_MS = 12_000;

export type JarvisPreset = 'snappy' | 'deep';

type JarvisConfig = { enabled: boolean; picovoiceKey: string | null };

export type JarvisContextValue = {
  session: JarvisSession;
  configured: boolean;
  configError: string | null;
  wakeEnabled: boolean;
  setWakeEnabled: (on: boolean) => void;
  wakeActive: boolean;
  preset: JarvisPreset;
  setPreset: (preset: JarvisPreset) => void;
  settings: JarvisEngineSettings;
  overlayOpen: boolean;
  summon: () => void;
  dismiss: () => void;
  dismissCountdownMs: number | null;
};

const JarvisContext = createContext<JarvisContextValue | null>(null);

export function useJarvis(): JarvisContextValue {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error('useJarvis outside JarvisProvider');
  return ctx;
}

export function JarvisProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<JarvisConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [wakeEnabled, setWakeEnabledState] = useState(() => localStorage.getItem(WAKE_PREF_KEY) === 'on');
  const [wakeActive, setWakeActive] = useState(false);
  const [preset, setPresetState] = useState<JarvisPreset>(() =>
    localStorage.getItem(PRESET_KEY) === 'snappy' ? 'snappy' : 'deep',
  );
  const [dismissCountdownMs, setDismissCountdownMs] = useState<number | null>(null);

  const lastActivityRef = useRef(Date.now());
  const engineRef = useRef<WakeWordEngine | null>(null);

  const settings = JARVIS_PRESETS[preset];

  const onActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const session = useJarvisSession({
    onActivity,
    onClosed: () => setOverlayOpen(false),
  });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Bootstrap config (LiveKit availability + Picovoice key).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/jarvis/config')
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`config endpoint ${resp.status}`);
        const body = (await resp.json()) as JarvisConfig;
        if (!cancelled) setConfig(body);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setConfig({ enabled: false, picovoiceKey: null });
          setConfigError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summon = useCallback(() => {
    if (sessionRef.current.active) {
      setOverlayOpen(true);
      return;
    }
    lastActivityRef.current = Date.now();
    setOverlayOpen(true);
    // Wake engine must fully release the mic before LiveKit captures it.
    const engine = engineRef.current;
    const stopFirst = engine ? engine.stop() : Promise.resolve();
    void stopFirst.then(() => sessionRef.current.start(JARVIS_PRESETS[preset]));
  }, [preset]);
  const summonRef = useRef(summon);
  summonRef.current = summon;

  const dismiss = useCallback(() => {
    sessionRef.current.dismiss();
    setOverlayOpen(false);
  }, []);

  // Wake-word engine lifecycle: run only when enabled and idle. Porcupine when
  // a key exists (on-device), else Chrome's built-in speech recognition.
  const shouldListen = wakeEnabled && !session.active && config !== null;
  useEffect(() => {
    if (!shouldListen) {
      const engine = engineRef.current;
      if (engine) {
        void engine.stop().then(() => setWakeActive(false));
      }
      return;
    }
    let cancelled = false;
    const engine: WakeWordEngine = config?.picovoiceKey
      ? new PorcupineWakeEngine(config.picovoiceKey)
      : 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
        ? new WebSpeechWakeEngine()
        : new NullWakeEngine();
    engineRef.current = engine;
    engine
      .start(() => summonRef.current())
      .then(() => {
        if (!cancelled) setWakeActive(engine.running);
      })
      .catch((err: Error) => {
        console.warn('[jarvis] wake engine failed:', err.message);
        if (!cancelled) {
          setWakeActive(false);
          setConfigError(`wake word: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
      void engine.stop().then(() => {
        if (engineRef.current === engine) {
          engineRef.current = null;
          setWakeActive(false);
        }
      });
    };
  }, [shouldListen, config?.picovoiceKey]);

  // Ctrl+J summons / dismisses from anywhere in the Studio.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'j' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (sessionRef.current.active) dismiss();
        else summonRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Silence auto-dismiss with a visible countdown tail. Only ticks while the
  // conversation is quiet — thinking/speaking resets via onActivity messages.
  useEffect(() => {
    if (!session.active) {
      setDismissCountdownMs(null);
      return;
    }
    const interval = setInterval(() => {
      const current = sessionRef.current;
      if (current.phase === 'thinking' || current.phase === 'speaking' || current.phase === 'connecting') {
        lastActivityRef.current = Date.now();
        setDismissCountdownMs(null);
        return;
      }
      const idleFor = Date.now() - lastActivityRef.current;
      const remaining = AUTO_DISMISS_MS - idleFor;
      if (remaining <= 0) {
        setDismissCountdownMs(null);
        current.dismiss();
        setOverlayOpen(false);
      } else {
        setDismissCountdownMs(remaining <= COUNTDOWN_VISIBLE_MS ? remaining : null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [session.active]);

  const setWakeEnabled = useCallback((on: boolean) => {
    localStorage.setItem(WAKE_PREF_KEY, on ? 'on' : 'off');
    setWakeEnabledState(on);
  }, []);

  const setPreset = useCallback(
    (next: JarvisPreset) => {
      localStorage.setItem(PRESET_KEY, next);
      setPresetState(next);
      // Mid-conversation preset flips apply to the next utterance.
      if (sessionRef.current.active) sessionRef.current.sendSettings(JARVIS_PRESETS[next]);
    },
    [],
  );

  const value = useMemo<JarvisContextValue>(
    () => ({
      session,
      configured: config?.enabled ?? false,
      configError,
      wakeEnabled,
      setWakeEnabled,
      wakeActive,
      preset,
      setPreset,
      settings,
      overlayOpen,
      summon,
      dismiss,
      dismissCountdownMs,
    }),
    [session, config?.enabled, configError, wakeEnabled, setWakeEnabled, wakeActive, preset, setPreset, settings, overlayOpen, summon, dismiss, dismissCountdownMs],
  );

  return <JarvisContext.Provider value={value}>{children}</JarvisContext.Provider>;
}
