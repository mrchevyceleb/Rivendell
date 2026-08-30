// Voice call audio primitives (adapted from Operly's audio-utils): PCM
// conversion, the 16 kHz mic worklet, and a streaming playback queue for
// the 24 kHz PCM Grok streams back.

export function int16ToFloat32(int16Array: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) out[i] = int16Array[i] / 32768;
  return out;
}

export function base64ToInt16Array(base64: string): Int16Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function int16ArrayToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export const micProcessorCode = `
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = []
    this.bufferSize = 2048
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const samples = input[0]
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff)
    }
    if (this.buffer.length >= this.bufferSize) {
      const chunk = new Int16Array(this.buffer.slice(0, this.bufferSize))
      this.port.postMessage({ pcmData: chunk.buffer }, [chunk.buffer])
      this.buffer = this.buffer.slice(this.bufferSize)
    }
    return true
  }
}
registerProcessor('riv-call-mic', MicProcessor)
`;

export function createMicProcessorUrl(): string {
  return URL.createObjectURL(new Blob([micProcessorCode], { type: 'application/javascript' }));
}

/** Streaming playback queue for 24 kHz PCM deltas, with level metering. */
export class CallPlayback {
  private ctx: AudioContext;
  private gain: GainNode;
  private analyser: AnalyserNode;
  private nextStart = 0;
  private pending = 0;
  private onComplete?: () => void;
  private armed = false;
  private generation = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.65;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(muted ? 0 : this.gain.gain.value, now);
    if (!muted) this.gain.gain.linearRampToValueAtTime(1, now + 0.05);
  }

  setOnComplete(cb: () => void): void { this.onComplete = cb; }
  armComplete(): void {
    this.armed = true;
    if (this.pending === 0 && this.onComplete) { this.armed = false; this.onComplete(); }
  }

  async play(pcm: Int16Array): Promise<void> {
    this.pending++;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { this.pending--; return; }
    }
    const buffer = this.ctx.createBuffer(1, pcm.length, 24000);
    buffer.copyToChannel(int16ToFloat32(pcm), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.nextStart < now) this.nextStart = now;
    src.start(this.nextStart);
    this.nextStart += buffer.duration;
    const gen = this.generation;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (gen !== this.generation) return;
      this.pending--;
      if (this.pending === 0 && this.armed && this.onComplete) {
        this.armed = false;
        this.onComplete();
      }
    };
  }

  /** Output level 0..1 for the waveform. */
  level(): number {
    const arr = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / arr.length) * 3);
  }

  clear(): void {
    this.generation++;
    for (const s of this.sources) { try { s.onended = null; s.stop(); } catch { /* stopped */ } try { s.disconnect(); } catch { /* gone */ } }
    this.sources.clear();
    this.nextStart = 0;
    this.pending = 0;
    this.armed = false;
  }

  async close(): Promise<void> {
    this.clear();
    try { await this.ctx.close(); } catch { /* already closed */ }
  }
}
