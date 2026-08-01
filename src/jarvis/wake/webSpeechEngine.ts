// Wake word via Chrome's built-in SpeechRecognition (continuous mode).
// Used when no Picovoice key is available (their free trial now requires a
// commercial use case). Trade-off: recognition runs through the browser
// vendor's speech service rather than on-device; accuracy on a distinctive
// word like "Jarvis" is excellent. Swaps out behind WakeWordEngine like any
// other engine.

import type { WakeWordEngine } from './WakeWordEngine';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
};

function createRecognition(): SpeechRecognitionLike | null {
  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const WAKE_RE = /\bjarvis\b/i;
const RESTART_DELAY_MS = 400;

export class WebSpeechWakeEngine implements WakeWordEngine {
  running = false;
  private recognition: SpeechRecognitionLike | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  async start(onWake: () => void): Promise<void> {
    if (this.running) return;
    const recognition = createRecognition();
    if (!recognition) throw new Error('SpeechRecognition unavailable in this browser');
    this.recognition = recognition;
    this.running = true;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript: string = event.results[i]?.[0]?.transcript ?? '';
        if (WAKE_RE.test(transcript)) {
          onWake();
          return;
        }
      }
    };

    // Chrome ends continuous sessions periodically (silence, service resets).
    // Keep it alive until stop() flips `running` off.
    recognition.onend = () => {
      if (!this.running) return;
      this.restartTimer = setTimeout(() => {
        if (!this.running || !this.recognition) return;
        try {
          this.recognition.start();
        } catch {
          /* already started */
        }
      }, RESTART_DELAY_MS);
    };

    recognition.onerror = (event: any) => {
      // 'no-speech'/'aborted' are routine; onend handles the restart. A denied
      // mic is fatal — stop cleanly so the UI reflects it.
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        void this.stop();
      }
    };

    recognition.start();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
  }
}
