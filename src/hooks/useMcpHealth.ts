import { useEffect, useRef, useState } from 'react';

export type McpHealthStatus = 'unknown' | 'up' | 'slow' | 'down';

export type McpHealth = {
  status: McpHealthStatus;
  ms: number | null;
  checkedAt: number | null;
  error: string | null;
  refresh: () => Promise<void>;
  redeploy: () => Promise<{ ok: boolean; error?: string }>;
  redeploying: boolean;
};

const POLL_MS = 30_000;
const SLOW_MS = 1500;

export function useMcpHealth(): McpHealth {
  const [status, setStatus] = useState<McpHealthStatus>('unknown');
  const [ms, setMs] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const aliveRef = useRef(true);

  const refresh = async () => {
    try {
      const response = await fetch('/api/mcp/health', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!body) {
        setStatus('down');
        setError('no response');
        setMs(null);
        setCheckedAt(Date.now());
        return;
      }
      setMs(typeof body.ms === 'number' ? body.ms : null);
      setCheckedAt(typeof body.checkedAt === 'number' ? body.checkedAt : Date.now());
      if (body.ok) {
        setStatus(body.ms != null && body.ms > SLOW_MS ? 'slow' : 'up');
        setError(null);
      } else {
        setStatus('down');
        setError(body.error || `HTTP ${body.status ?? '?'}`);
      }
    } catch (err: any) {
      if (!aliveRef.current) return;
      setStatus('down');
      setError(err?.message || 'unreachable');
      setMs(null);
      setCheckedAt(Date.now());
    }
  };

  const redeploy = async (): Promise<{ ok: boolean; error?: string }> => {
    setRedeploying(true);
    try {
      const response = await fetch('/api/mcp/redeploy', {
        method: 'POST',
        headers: { 'X-Rivendell-Action': 'redeploy' },
      });
      const body = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        return { ok: false, error: body?.error || `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'unknown error' };
    } finally {
      if (aliveRef.current) setRedeploying(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { status, ms, checkedAt, error, refresh, redeploy, redeploying };
}
