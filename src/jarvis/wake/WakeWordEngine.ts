// Swappable wake-word seam. The Porcupine engine is the v1 implementation
// (free personal tier); consumer builds swap this interface for openWakeWord,
// a platform hotword, or push-to-talk without touching the rest of Jarvis.

export interface WakeWordEngine {
  /** Begin listening for the wake word. Resolves once the mic is live. */
  start(onWake: () => void): Promise<void>;
  /** Fully release the mic and all resources. Safe to call repeatedly. */
  stop(): Promise<void>;
  readonly running: boolean;
}

export class NullWakeEngine implements WakeWordEngine {
  running = false;
  async start(): Promise<void> {
    /* no wake word available; manual/hotkey activation only */
  }
  async stop(): Promise<void> {
    /* nothing to release */
  }
}
