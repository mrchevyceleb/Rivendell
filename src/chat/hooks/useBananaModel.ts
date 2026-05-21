import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Model picker state for the Banana companion. Quick-picks are the four
// monkey tiers; the searchable list is every OpenRouter model. The last pick
// is persisted in localStorage and reused as the default.

export type BananaModelOption = {
  /** The id sent to the runner, e.g. `monkey/silverback` or
   *  `openrouter/anthropic/claude-3.7-sonnet`. */
  id: string;
  /** Human-friendly label for the picker UI. */
  label: string;
  /** Optional second line (provider, context length, etc.). */
  detail?: string;
};

// The four monkey tiers, biggest to smallest. These are always offered as
// quick-picks regardless of network state.
export const MONKEY_TIERS: BananaModelOption[] = [
  { id: 'monkey/silverback', label: 'Silverback', detail: 'top tier' },
  { id: 'monkey/mandrill', label: 'Mandrill', detail: 'balanced' },
  { id: 'monkey/gibbon', label: 'Gibbon', detail: 'fast' },
  { id: 'monkey/tamarin', label: 'Tamarin', detail: 'lightweight' },
];

export const DEFAULT_BANANA_MODEL = 'monkey/silverback';
const STORAGE_KEY = 'rivendell:banana-model';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

// Cache the OpenRouter model list for the lifetime of the page so opening the
// picker repeatedly does not refetch.
let openRouterCache: BananaModelOption[] | null = null;
let openRouterInflight: Promise<BananaModelOption[]> | null = null;

type RawModel = { id?: unknown; name?: unknown; context_length?: unknown };

async function fetchOpenRouterModels(): Promise<BananaModelOption[]> {
  if (openRouterCache) return openRouterCache;
  if (openRouterInflight) return openRouterInflight;
  openRouterInflight = (async () => {
    const res = await fetch(OPENROUTER_URL);
    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
    const body = (await res.json()) as { data?: RawModel[] };
    const list = Array.isArray(body.data) ? body.data : [];
    const mapped: BananaModelOption[] = list
      .filter((m): m is RawModel & { id: string } => typeof m.id === 'string' && m.id.length > 0)
      .map((m) => {
        const ctx = typeof m.context_length === 'number' ? m.context_length : undefined;
        return {
          id: `openrouter/${m.id}`,
          label: typeof m.name === 'string' && m.name ? m.name : m.id,
          detail: ctx ? `${m.id} · ${formatContext(ctx)} ctx` : m.id,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    openRouterCache = mapped;
    return mapped;
  })();
  try {
    return await openRouterInflight;
  } finally {
    openRouterInflight = null;
  }
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function readStoredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_BANANA_MODEL;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.trim()) return raw.trim();
  } catch {}
  return DEFAULT_BANANA_MODEL;
}

/** Resolve a model id to a friendly label for the trigger button. Falls back
 *  to the bare id when the model is not one of the known options. */
export function labelForModel(id: string, openRouter: BananaModelOption[]): string {
  const monkey = MONKEY_TIERS.find((m) => m.id === id);
  if (monkey) return monkey.label;
  const or = openRouter.find((m) => m.id === id);
  if (or) return or.label;
  // openrouter/<vendor>/<model> -> show the trailing model name.
  const slash = id.indexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

export function useBananaModel() {
  const [model, setModelState] = useState<string>(() => readStoredModel());
  const [openRouter, setOpenRouter] = useState<BananaModelOption[]>(() => openRouterCache ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether we have already kicked off a fetch this mount.
  const fetchedRef = useRef(false);

  const setModel = useCallback((next: string) => {
    setModelState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  // Lazily load the OpenRouter list — called when the picker opens so we do
  // not pay the network cost unless the user actually wants to browse.
  const loadOpenRouter = useCallback(() => {
    if (fetchedRef.current || openRouterCache) {
      if (openRouterCache) setOpenRouter(openRouterCache);
      return;
    }
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    fetchOpenRouterModels()
      .then((list) => {
        setOpenRouter(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'failed to load OpenRouter models');
        setLoading(false);
        // Allow a retry on the next open.
        fetchedRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (openRouterCache) setOpenRouter(openRouterCache);
  }, []);

  const triggerLabel = useMemo(() => labelForModel(model, openRouter), [model, openRouter]);

  return { model, setModel, openRouter, loading, error, loadOpenRouter, triggerLabel };
}
