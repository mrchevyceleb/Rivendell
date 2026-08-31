// GET /api/voice-preview?voice=ara → audio/wav sample of a Grok call voice.
// Opens a one-shot realtime session, asks the model to say a fixed line in
// that voice, collects the 24 kHz PCM deltas, wraps them in a WAV header,
// and caches the file to ~/.rivendell/voice-previews/<voice>.wav forever —
// voices don't change, so every play after the first is a static file serve.

import { Router } from 'express';
import { WebSocket as WsClient } from 'ws';
import { createReadStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';
import { GROK_REALTIME_URL, GROK_VOICE_IDS, grokApiKey } from './grokCall.ts';

export const voicePreviewRouter = Router();

const CACHE_DIR = join(STATE_DIR, 'voice-previews');
const PREVIEW_LINE = (label: string) =>
  `Hey, I'm ${label}. This is what I sound like on a call.`;
// 24 kHz 16-bit mono = 48 KB/s. Cap raw PCM at 8 MB (~170s, wildly generous
// for a 3s line) so a pathological upstream can't balloon process memory.
const MAX_PCM_BYTES = 8 * 1024 * 1024;

/** 24 kHz 16-bit mono PCM → WAV container. */
function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);  // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function generatePreview(voice: string, label: string): Promise<Buffer> {
  const key = grokApiKey();
  if (!key) return Promise.reject(new Error('No xAI API key configured'));
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let totalBytes = 0;
    const chunks: Buffer[] = [];
    const ws = new WsClient(GROK_REALTIME_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const done = (err: Error | null, pcm?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Failure paths terminate (no graceful close handshake): drop late audio.
      try { err ? ws.terminate() : ws.close(); } catch { /* already gone */ }
      if (err) reject(err);
      else resolve(pcm ?? Buffer.concat(chunks));
    };
    const timer = setTimeout(() => done(new Error('voice preview timed out')), 25_000);
    timer.unref?.();

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: 'You are a one-line voice preview. Speak the requested line exactly once, naturally, and stop.',
          voice,
          reasoning: { effort: 'none' },
          audio: {
            input: { format: { type: 'audio/pcm', rate: 24000 } },
            output: { format: { type: 'audio/pcm', rate: 24000 } },
          },
          turn_detection: null, // no mic on this session — response.create drives it
        },
      }));
      ws.send(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: `Say exactly: ${PREVIEW_LINE(label)}`,
        },
      }));
    });
    ws.on('message', (data) => {
      if (settled) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const type = String(msg.type || '');
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        if (typeof msg.delta === 'string' && msg.delta) {
          const buf = Buffer.from(msg.delta, 'base64');
          // Hard cap: check BEFORE appending; overflow kills the socket.
          if (totalBytes + buf.length > MAX_PCM_BYTES) {
            done(new Error('preview audio exceeded size cap'));
            return;
          }
          chunks.push(buf);
          totalBytes += buf.length;
        }
        return;
      }
      if (type === 'response.done') {
        // Only a completed take may be cached — cancelled/failed/incomplete
        // responses can still carry partial audio.
        const status = (msg.response as { status?: string } | undefined)?.status;
        if (status && status !== 'completed') {
          done(new Error(`preview response ${status}`));
          return;
        }
        if (chunks.length === 0) {
          done(new Error('preview produced no audio'));
          return;
        }
        done(null);
        return;
      }
      if (type === 'error') {
        const detail = (msg.error as { message?: string } | undefined)?.message ?? 'Grok realtime error';
        done(new Error(detail));
      }
    });
    ws.on('error', (err) => done(err));
    ws.on('close', () => {
      // Only response.done marks a complete take — a premature close must
      // never cache truncated audio.
      if (!settled) done(new Error('line closed before preview finished'));
    });
  });
}

const inFlight = new Map<string, Promise<string>>();

voicePreviewRouter.get('/', async (req, res) => {
  const voice = String(req.query.voice ?? '').trim().toLowerCase();
  if (!(GROK_VOICE_IDS as readonly string[]).includes(voice)) {
    res.status(400).json({ error: 'unknown voice' });
    return;
  }
  const label = voice.slice(0, 1).toUpperCase() + voice.slice(1);
  const file = join(CACHE_DIR, `${voice}.wav`);
  try {
    if (!existsSync(file)) {
      let pending = inFlight.get(voice);
      if (!pending) {
        pending = (async () => {
          const pcm = await generatePreview(voice, label);
          mkdirSync(CACHE_DIR, { recursive: true });
          // Atomic publish: a partial write must never become the cached file.
          const tmp = `${file}.tmp-${process.pid}`;
          writeFileSync(tmp, pcmToWav(pcm));
          renameSync(tmp, file);
          return file;
        })().finally(() => inFlight.delete(voice));
        inFlight.set(voice, pending);
      }
      await pending;
    }
    res.setHeader('Content-Type', 'audio/wav');
    // Revalidate daily instead of immutable: deleting the cache dir to pick up
    // a changed xAI voice must actually refresh clients.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'preview file unreadable' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || 'preview failed' });
  }
});
