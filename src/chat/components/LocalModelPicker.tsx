import { useEffect, useRef, useState } from 'react';

// Swap / download local vLLM models straight from the UI — no terminal. Picking
// a model that isn't loaded POSTs /api/local/serve (vLLM downloads from HF if
// needed), then we poll /api/local/status until it's live. The backend reloads
// the banana serve automatically once the model is up, so it re-registers.

type Catalog = {
  loaded: string | null;
  ready: boolean;
  cached: string[];
  curated: { id: string; label: string; note: string }[];
};

const selStyle: React.CSSProperties = {
  fontSize: 12.5,
  border: '1px solid var(--r-line)',
  borderRadius: 7,
  background: 'var(--r-bg-card)',
  color: 'var(--r-ink)',
  padding: '5px 9px',
  cursor: 'pointer',
};

export function LocalModelPicker({ onActiveChange }: { onActiveChange: (modelId: string | null) => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const activeCbRef = useRef(onActiveChange);
  activeCbRef.current = onActiveChange;

  const refresh = async () => {
    try {
      const r = await fetch('/api/local/catalog');
      const d: Catalog = await r.json();
      setCat(d);
      activeCbRef.current(d.loaded ? `local/${d.loaded}` : null);
    } catch {
      /* leave prior catalog */
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a swap/download is in flight, poll status until the target is live.
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch('/api/local/status');
        const s: { loaded: string | null; ready: boolean } = await r.json();
        if (cancelled) return;
        if (s.ready && s.loaded === busy) {
          setBusy(null);
          void refresh();
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const load = async (model: string) => {
    if (!model || busy) return;
    setErr(null);
    if (cat?.loaded === model) {
      activeCbRef.current(`local/${model}`);
      return;
    }
    try {
      const r = await fetch('/api/local/serve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        setErr(d.error || 'failed to start');
        return;
      }
      setBusy(model);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Build the option list: loaded first, then curated, then any other cached.
  const seen = new Set<string>();
  const options: { id: string; label: string }[] = [];
  if (cat?.loaded) {
    seen.add(cat.loaded);
    options.push({ id: cat.loaded, label: `● ${cat.loaded.split('/').pop()} (loaded)` });
  }
  for (const c of cat?.curated ?? []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    options.push({ id: c.id, label: `${c.label} — ${c.note}` });
  }
  for (const id of cat?.cached ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label: `${id.split('/').pop()} (cached)` });
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        aria-label="Local model"
        title="Pick a vLLM model — loads/downloads it if it isn't running"
        style={selStyle}
        value={cat?.loaded ?? ''}
        disabled={!!busy}
        onChange={(e) => void load(e.target.value)}
      >
        {options.length ? (
          options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))
        ) : (
          <option value="">vLLM unreachable</option>
        )}
      </select>
      <input
        placeholder="HF id…"
        title="Paste any Hugging Face FP8 model id and press Enter to load it"
        value={custom}
        disabled={!!busy}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && custom.trim()) void load(custom.trim());
        }}
        style={{ ...selStyle, width: 130 }}
      />
      {busy ? (
        <span style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--r-ink-faint)' }}>
          loading {busy.split('/').pop()}… downloading + compiling, ~2–5 min (keep this open)
        </span>
      ) : null}
      {err ? <span style={{ fontSize: 11.5, color: 'var(--r-gold)' }}>{err}</span> : null}
    </span>
  );
}
