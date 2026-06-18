import { useCallback, useEffect, useMemo, useState } from 'react';

// Model picker state for the Banana companions. One hook drives BOTH the
// OpenRouter and Fireworks engines — pass the matching provider config. The
// quick-pick "tiers" + searchable catalogue are provider-specific; the last
// pick is persisted in localStorage (per provider) and reused as the default.

export type BananaModelOption = {
  /** The id sent to the runner, e.g. `openrouter/anthropic/claude-sonnet-4.6`
   *  or `fireworks/accounts/fireworks/models/glm-5p2`. */
  id: string;
  /** Human-friendly label for the picker UI. */
  label: string;
  /** Optional second line (provider, context length, etc.). */
  detail?: string;
};

// A provider config wires the hook to one engine's catalogue endpoint, id
// prefix, storage keys, quick-pick tiers, and default.
export type ModelProviderConfig = {
  /** API route returning `{ data: [{ id, name, context_length }] }` (bare ids). */
  endpoint: string;
  /** Provider prefix prepended to bare catalogue ids (e.g. `openrouter`). */
  idPrefix: string;
  storageKey: string;
  favoritesKey: string;
  /** Fallback/default model id (already prefixed). */
  defaultModel: string;
  /** Always-offered quick-picks (already prefixed). May be empty. */
  tiers: BananaModelOption[];
  tiersHeading: string;
  listHeading: string;
  searchPlaceholder: string;
};

// OpenRouter quick-picks — real model ids routed DIRECT through OpenRouter
// (the old `monkey/*` tiers died with the monkey-models proxy). Verified
// present in the live OpenRouter catalogue.
const OPENROUTER_TIERS: BananaModelOption[] = [
  { id: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', detail: 'top tier' },
  { id: 'openrouter/anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', detail: 'balanced' },
  { id: 'openrouter/openai/gpt-5', label: 'GPT-5', detail: 'OpenAI' },
  { id: 'openrouter/z-ai/glm-5.2', label: 'GLM 5.2', detail: 'long context' },
];

export const OPENROUTER_PROVIDER: ModelProviderConfig = {
  endpoint: '/api/banana/models',
  idPrefix: 'openrouter',
  storageKey: 'rivendell:banana-model',
  favoritesKey: 'banana-model-favorites',
  defaultModel: 'openrouter/anthropic/claude-sonnet-4.6',
  tiers: OPENROUTER_TIERS,
  tiersHeading: 'Quick picks',
  listHeading: 'OpenRouter',
  searchPlaceholder: 'Search OpenRouter models...',
};

export const FIREWORKS_PROVIDER: ModelProviderConfig = {
  endpoint: '/api/fireworks/models',
  idPrefix: 'fireworks',
  storageKey: 'rivendell:fireworks-model',
  favoritesKey: 'fireworks-model-favorites',
  defaultModel: 'fireworks/accounts/fireworks/models/glm-5p2',
  tiers: [],
  tiersHeading: '',
  listHeading: 'Fireworks',
  searchPlaceholder: 'Search Fireworks models...',
};

// Back-compat: some callers still import MONKEY_TIERS / DEFAULT_BANANA_MODEL.
export const MONKEY_TIERS = OPENROUTER_TIERS;
export const DEFAULT_BANANA_MODEL = OPENROUTER_PROVIDER.defaultModel;

const CACHE_TTL_MS = 60 * 1000;

// Cache briefly, PER endpoint, so long-lived Rivendell tabs notice catalogue
// adds, removals, and metadata changes without a browser refresh.
type CacheEntry = { models: BananaModelOption[] | null; at: number; inflight: Promise<BananaModelOption[]> | null };
const caches = new Map<string, CacheEntry>();
function cacheFor(endpoint: string): CacheEntry {
  let entry = caches.get(endpoint);
  if (!entry) {
    entry = { models: null, at: 0, inflight: null };
    caches.set(endpoint, entry);
  }
  return entry;
}

type RawModel = { id?: unknown; name?: unknown; context_length?: unknown };

async function fetchModels(config: ModelProviderConfig): Promise<BananaModelOption[]> {
  const cache = cacheFor(config.endpoint);
  const fresh = cache.models !== null && Date.now() - cache.at < CACHE_TTL_MS;
  if (fresh) return cache.models as BananaModelOption[];
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const res = await fetch(config.endpoint);
      if (!res.ok) throw new Error(`${config.listHeading} responded ${res.status}`);
      const body = (await res.json()) as { data?: RawModel[] };
      const list = Array.isArray(body.data) ? body.data : [];
      const mapped: BananaModelOption[] = list
        .filter((m): m is RawModel & { id: string } => typeof m.id === 'string' && m.id.length > 0)
        .map((m) => {
          const ctx = typeof m.context_length === 'number' ? m.context_length : undefined;
          return {
            id: `${config.idPrefix}/${m.id}`,
            label: typeof m.name === 'string' && m.name ? m.name : m.id,
            detail: ctx ? `${m.id} · ${formatContext(ctx)} ctx` : m.id,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      if (mapped.length > 0) {
        cache.models = mapped;
        cache.at = Date.now();
      }
      return mapped.length > 0 ? mapped : cache.models ?? [];
    } catch (error) {
      if (cache.models) return cache.models;
      throw error;
    }
  })();
  try {
    return await cache.inflight;
  } finally {
    cache.inflight = null;
  }
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function readStoredModel(config: ModelProviderConfig): string {
  if (typeof window === 'undefined') return config.defaultModel;
  try {
    const stored = localStorage.getItem(config.storageKey)?.trim();
    if (stored) {
      // The stored id must belong to THIS provider. A stale id from another
      // provider — or a retired `monkey/*` tier whose proxy is gone — would
      // dead-end at the runner, so migrate it to the default.
      const prefix = stored.split('/')[0];
      if (prefix !== config.idPrefix) {
        try {
          localStorage.setItem(config.storageKey, config.defaultModel);
        } catch {}
        return config.defaultModel;
      }
      return stored;
    }
  } catch {}
  return config.defaultModel;
}

/** Read the persisted set of favorited model ids for a provider. */
function readStoredFavorites(config: ModelProviderConfig): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(config.favoritesKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }
  } catch {}
  return [];
}

/** Resolve a model id to a friendly label for the trigger button. Falls back
 *  to the bare id when the model is not one of the known options. */
export function labelForModel(id: string, options: BananaModelOption[]): string {
  const match = options.find((m) => m.id === id);
  if (match) return match.label;
  // <provider>/<vendor>/<model> -> show the trailing model name.
  const slash = id.indexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

export function useBananaModel(config: ModelProviderConfig = OPENROUTER_PROVIDER) {
  const [model, setModelState] = useState<string>(() => readStoredModel(config));
  const [models, setModels] = useState<BananaModelOption[]>(() => cacheFor(config.endpoint).models ?? []);
  const [favorites, setFavorites] = useState<string[]>(() => readStoredFavorites(config));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setModel = useCallback(
    (next: string) => {
      setModelState(next);
      try {
        localStorage.setItem(config.storageKey, next);
      } catch {}
    },
    [config.storageKey],
  );

  // Toggle a model id in/out of the favorites set and persist it.
  const toggleFavorite = useCallback(
    (id: string) => {
      setFavorites((current) => {
        const next = current.includes(id)
          ? current.filter((favId) => favId !== id)
          : [...current, id];
        try {
          localStorage.setItem(config.favoritesKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [config.favoritesKey],
  );

  // Lazily load the catalogue — called when the picker opens so we don't pay
  // the network cost unless the user actually wants to browse.
  const loadOpenRouter = useCallback(() => {
    const cache = cacheFor(config.endpoint);
    const fresh = cache.models !== null && Date.now() - cache.at < CACHE_TTL_MS;
    if (fresh) {
      setModels(cache.models as BananaModelOption[]);
      return;
    }
    if (cache.models) setModels(cache.models);
    setLoading(true);
    setError(null);
    fetchModels(config)
      .then((list) => {
        setModels(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : `failed to load ${config.listHeading} models`);
        setLoading(false);
      });
  }, [config]);

  useEffect(() => {
    const cache = cacheFor(config.endpoint);
    if (cache.models) setModels(cache.models);
  }, [config.endpoint]);

  const triggerLabel = useMemo(
    () => labelForModel(model, [...config.tiers, ...models]),
    [model, models, config.tiers],
  );

  return {
    model,
    setModel,
    // `openRouter` kept as an alias of `models` for any legacy reader.
    models,
    openRouter: models,
    favorites,
    toggleFavorite,
    loading,
    error,
    loadOpenRouter,
    triggerLabel,
    tiers: config.tiers,
    tiersHeading: config.tiersHeading,
    listHeading: config.listHeading,
    searchPlaceholder: config.searchPlaceholder,
  };
}

/** Fireworks-engine model picker state. */
export function useFireworksModel() {
  return useBananaModel(FIREWORKS_PROVIDER);
}
