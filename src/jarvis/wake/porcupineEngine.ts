// Porcupine wake word: on-device WASM, "Jarvis" built-in keyword. Runs ONLY
// while Jarvis is idle — during a conversation the engine is fully stopped so
// LiveKit owns the mic (and Jarvis can't wake himself from his own voice).

import { BuiltInKeyword, PorcupineWorker } from '@picovoice/porcupine-web';
import { WebVoiceProcessor } from '@picovoice/web-voice-processor';
import type { WakeWordEngine } from './WakeWordEngine';

export class PorcupineWakeEngine implements WakeWordEngine {
  running = false;
  private worker: PorcupineWorker | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly accessKey: string) {}

  async start(onWake: () => void): Promise<void> {
    if (this.running || this.starting) return this.starting ?? undefined;
    this.starting = (async () => {
      const worker = await PorcupineWorker.create(
        this.accessKey,
        [BuiltInKeyword.Jarvis],
        () => onWake(),
        { publicPath: '/porcupine_params.pv' },
      );
      this.worker = worker;
      await WebVoiceProcessor.subscribe(worker);
      this.running = true;
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        /* failed start; nothing held */
      }
    }
    const worker = this.worker;
    this.worker = null;
    this.running = false;
    if (!worker) return;
    try {
      await WebVoiceProcessor.unsubscribe(worker);
    } catch {
      /* already unsubscribed */
    }
    try {
      worker.release();
      worker.terminate();
    } catch {
      /* already gone */
    }
  }
}
