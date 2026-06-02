import { useEffect, useRef, useState } from 'react';

// Swap / download local vLLM models straight from the UI — no terminal. Picking
// a model that isn't loaded POSTs /api/local/serve (vLLM downloads from HF if
// needed), then we poll /api/local/status until it's live. The backend reloads
// the banana serve automatically once the model is up, so it re-registers.

type Catalog = {
  loaded: string | null;
  ready: boolean;
  contextLen: number | null;
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

// ── Forgiving Hugging Face id entry ────────────────────────────────────────
// You shouldn't have to type a repo id perfectly. These resolve a sloppy entry
// (bare name, wrong/missing org, a pasted URL) against the HF API, and with a
// quant preference they surface that quant's build: NVFP4 is the Blackwell-
// native 4-bit path on this box, FP8 is the other Spark-optimized one. The HF
// API allows browser GETs (CORS), so this runs client-side.
const HF_API = 'https://huggingface.co/api/models';
const QUANTS = ['Auto', 'NVFP4', 'FP8', 'MXFP4', 'BF16'];
const QUANT_MATCH: Record<string, string[]> = {
  NVFP4: ['NVFP4', 'FP4'],
  FP8: ['FP8'],
  MXFP4: ['MXFP4'],
  BF16: ['BF16', '?'],
};

function detectQuant(id: string): string {
  const s = id.toLowerCase();
  if (s.includes('nvfp4')) return 'NVFP4';
  if (s.includes('mxfp4')) return 'MXFP4';
  if (s.includes('fp4')) return 'FP4';
  if (s.includes('fp8')) return 'FP8';
  if (s.includes('awq')) return 'AWQ';
  if (s.includes('gptq')) return 'GPTQ';
  if (s.includes('w4a16') || s.includes('int4') || s.includes('4bit')) return 'INT4';
  if (s.includes('w8a8') || s.includes('int8') || s.includes('8bit')) return 'INT8';
  if (s.includes('bf16') || s.includes('fp16')) return 'BF16';
  return '?';
}

function normalizeHfUrl(text: string): string {
  let t = text.trim().replace(/^@+/, '').trim();
  if (!t.includes('huggingface.co/')) return t;
  t = t.split('huggingface.co/')[1] ?? '';
  t = t.split('?')[0].split('#')[0];
  t = t.split('/tree/')[0].split('/blob/')[0].split('/resolve/')[0];
  if (t.startsWith('models/')) t = t.slice('models/'.length);
  return t.replace(/^\/+|\/+$/g, '');
}

async function hfModelExists(id: string): Promise<boolean | null> {
  try {
    const r = await fetch(`${HF_API}/${encodeURIComponent(id)}`);
    if (r.ok) return true;
    if (r.status === 401 || r.status === 403 || r.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

async function hfSearchRaw(query: string, limit = 25): Promise<string[] | null> {
  try {
    const r = await fetch(
      `${HF_API}?search=${encodeURIComponent(query.trim())}&sort=downloads&direction=-1&limit=${limit}`,
    );
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((m) => (m && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id : ''))
      .filter(Boolean);
  } catch {
    return null;
  }
}

async function hfSearch(query: string, quant?: string | null, limit = 25): Promise<string[] | null> {
  const ids = await hfSearchRaw(query, limit);
  if (ids === null) return null;
  if (quant && quant !== 'Auto') {
    const extra = (await hfSearchRaw(`${query} ${quant}`, limit)) ?? [];
    const seen = new Set(ids);
    for (const e of extra) if (!seen.has(e)) { ids.push(e); seen.add(e); }
    const want = QUANT_MATCH[quant] ?? [quant];
    const filtered = ids.filter((i) => want.includes(detectQuant(i)));
    if (filtered.length) return filtered;
  }
  return ids;
}

async function resolveModelId(raw: string): Promise<{ exact: string | null; candidates: string[] | null }> {
  const q = normalizeHfUrl(raw);
  if (!q) return { exact: null, candidates: [] };
  if (q.includes('/')) {
    const ok = await hfModelExists(q);
    if (ok === true) return { exact: q, candidates: [] };
    if (ok === null) return { exact: q, candidates: null }; // can't verify; caller loads as-is
  }
  const results = await hfSearch(q);
  if (results === null) return { exact: q.includes('/') ? q : null, candidates: null };
  const name = (q.split('/').pop() ?? '').toLowerCase();
  const exactMatches = results.filter((r) => (r.split('/').pop() ?? '').toLowerCase() === name);
  if (exactMatches.length === 1) return { exact: exactMatches[0], candidates: [] };
  return { exact: null, candidates: exactMatches.length ? exactMatches : results };
}

export function LocalModelPicker({ onActiveChange }: { onActiveChange: (modelId: string | null) => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [ctx, setCtx] = useState(''); // '' = auto (model's native context, capped)
  const [util, setUtil] = useState('0.85'); // GPU memory fraction (LM-Studio-style knob)
  const [err, setErr] = useState<string | null>(null);
  const [quant, setQuant] = useState('Auto'); // preferred quantization for entry/search
  const [results, setResults] = useState<string[] | null>(null); // HF matches to pick from
  const [searching, setSearching] = useState(false);
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

  // A model can be loaded out-of-band — the desktop vLLM Manager GUI, a
  // terminal, or the other app. Re-fetch the catalog whenever this tab regains
  // focus / becomes visible so an externally-loaded model shows up without a
  // manual page reload. (Skip while a swap we started is mid-flight; the busy
  // poll below owns that window.)
  useEffect(() => {
    const onActive = () => {
      if (!busy && document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onActive);
    document.addEventListener('visibilitychange', onActive);
    return () => {
      window.removeEventListener('focus', onActive);
      document.removeEventListener('visibilitychange', onActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // While a swap/download is in flight, poll status until the target is live.
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const DEADLINE_MS = 22 * 60 * 1000; // just past the backend's ~20-min load budget
    const tick = async () => {
      if (Date.now() - startedAt > DEADLINE_MS) {
        // Don't disable the controls forever on a failed/slow load — clear busy
        // and surface a recoverable error so the user can retry.
        setBusy(null);
        setErr(`Loading ${busy.split('/').pop()} timed out — check vLLM (download/compile may have failed). Try again.`);
        return;
      }
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
        body: JSON.stringify({ model, maxLen: ctx.trim() || undefined, util: util.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        setErr(d.error || 'failed to start');
        return;
      }
      setBusy(model);
      setResults(null); // pick made — drop the matches list
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Forgiving entry for the free-text box: a bare name, a wrong/missing org, or a
  // pasted HF URL all work. With a quant chosen it finds that build; otherwise it
  // resolves to the real id, or offers matches to pick from.
  const submitHf = async (raw: string) => {
    if (!raw || busy) return;
    setErr(null);
    setResults(null);
    const base = normalizeHfUrl(raw);
    setCustom(base);
    const pref = quant === 'Auto' ? null : quant;
    setSearching(true);
    try {
      if (pref) {
        const r = await hfSearch(base, pref);
        if (r === null) setErr('Hugging Face unreachable — try again');
        else if (r.length === 0) setErr(`no ${pref} build found for "${base}"`);
        else if (r.length === 1) await load(r[0]);
        else setResults(r);
      } else {
        const { exact, candidates } = await resolveModelId(base);
        if (exact) await load(exact);
        else if (candidates === null) {
          setErr('HF unreachable — loading as typed');
          await load(base);
        } else if (candidates.length) setResults(candidates);
        else setErr(`no Hugging Face model matches "${base}"`);
      }
    } finally {
      setSearching(false);
    }
  };

  // Build the option list: loaded first, then curated, then any other cached.
  const seen = new Set<string>();
  const options: { id: string; label: string }[] = [];
  if (cat?.loaded) {
    seen.add(cat.loaded);
    const ctxLabel = cat.contextLen ? ` · ${Math.round(cat.contextLen / 1024)}k ctx` : '';
    options.push({ id: cat.loaded, label: `● ${cat.loaded.split('/').pop()} (loaded${ctxLabel})` });
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
      <select
        aria-label="Quant"
        title="Preferred quantization. NVFP4 = Blackwell-native 4-bit (great on this box); FP8 also Spark-optimized. Auto = use the checkpoint as-is."
        style={selStyle}
        value={quant}
        disabled={!!busy}
        onChange={(e) => setQuant(e.target.value)}
      >
        {QUANTS.map((q) => (
          <option key={q} value={q}>{q === 'Auto' ? 'quant: auto' : q}</option>
        ))}
      </select>
      <input
        placeholder="name, id, or HF URL…"
        title="Type a model name (e.g. gpt-oss-120b), paste any HF id or URL, and press Enter. It fixes typos and finds the chosen quant — no need to type it perfectly."
        value={custom}
        disabled={!!busy}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={() => setCustom((c) => normalizeHfUrl(c))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && custom.trim()) void submitHf(custom.trim());
        }}
        style={{ ...selStyle, width: 170 }}
      />
      {results && results.length > 0 ? (
        <select
          aria-label="Matches"
          title="Search matches — pick one to load (quant in brackets)"
          style={selStyle}
          defaultValue=""
          disabled={!!busy}
          onChange={(e) => {
            if (e.target.value) void load(e.target.value);
          }}
        >
          <option value="" disabled>
            pick a match ({results.length})…
          </option>
          {results.map((id) => (
            <option key={id} value={id}>{`[${detectQuant(id)}] ${id}`}</option>
          ))}
        </select>
      ) : null}
      <input
        placeholder="ctx: auto"
        title="Context length in tokens. Blank = the model's native max (capped ~131k for memory). Set before picking a model — like LM Studio's context slider."
        value={ctx}
        disabled={!!busy}
        onChange={(e) => setCtx(e.target.value.replace(/[^0-9]/g, ''))}
        style={{ ...selStyle, width: 80 }}
      />
      <input
        placeholder="gpu 0.6"
        title="GPU memory fraction vLLM may use (0–1). Raise for bigger models / longer context."
        value={util}
        disabled={!!busy}
        onChange={(e) => setUtil(e.target.value.replace(/[^0-9.]/g, ''))}
        style={{ ...selStyle, width: 66 }}
      />
      {searching ? (
        <span style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--r-ink-faint)' }}>searching HF…</span>
      ) : null}
      {busy ? (
        <span style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--r-ink-faint)' }}>
          loading {busy.split('/').pop()}… downloading + compiling, ~2–5 min (keep this open)
        </span>
      ) : null}
      {err ? <span style={{ fontSize: 11.5, color: 'var(--r-gold)' }}>{err}</span> : null}
    </span>
  );
}
