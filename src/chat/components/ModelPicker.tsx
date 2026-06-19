import { Check, ChevronDown, Cpu, Search, Star } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useBananaModel } from '../hooks/useBananaModel';

// Model selector for the Banana companions (OpenRouter / Fireworks). Renders a
// trigger button + a dropdown with the provider's quick-pick tiers and a
// searchable catalogue. The picked model id is owned by useBananaModel
// (localStorage-backed, per provider); this component only surfaces it and is
// provider-agnostic — all provider specifics ride on the passed-in state.

type ModelPickerState = ReturnType<typeof useBananaModel>;

export function ModelPicker({ state }: { state: ModelPickerState }) {
  const {
    model,
    setModel,
    models,
    favorites,
    toggleFavorite,
    loading,
    error,
    loadOpenRouter,
    triggerLabel,
    tiers,
    tiersHeading,
    listHeading,
    searchPlaceholder,
  } = state;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const countId = useId();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Fetch the provider catalogue lazily, only when the picker opens.
    setQuery('');
    loadOpenRouter();
    setOpen(true);
  };

  // Filter the catalogue as the user types — match id or label.
  const modelMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models
      .filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [query, models]);
  const filtered = useMemo(() => modelMatches.slice(0, 60), [modelMatches]);
  const countLabel = useMemo(() => {
    if (loading) return 'loading';
    if (models.length === 0) return 'none loaded';
    if (!query.trim()) return `${models.length} loaded`;
    return modelMatches.length > 0
      ? `${filtered.length} shown / ${modelMatches.length} matches`
      : '0 matches';
  }, [filtered.length, loading, modelMatches.length, models.length, query]);

  // Resolve favorited ids to full model options. Favorites whose model is not
  // in the catalogue yet (e.g. still loading) are kept, falling back to a
  // bare-id label so the row still renders and stays selectable.
  const favoriteModels = useMemo(() => {
    return favorites.map((id) => {
      const match = models.find((m) => m.id === id);
      if (match) return match;
      const slash = id.indexOf('/');
      return { id, label: slash >= 0 ? id.slice(slash + 1) : id };
    });
  }, [favorites, models]);

  const pick = (id: string) => {
    setModel(id);
    setOpen(false);
    setQuery('');
  };

  // Toggle a model's favorite state without selecting it. Stops propagation so
  // the click does not bubble to the row's select handler.
  const onStarClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    toggleFavorite(id);
  };

  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        type="button"
        className="model-picker-trigger"
        onClick={toggle}
        title={`Banana model: ${model}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu size={14} />
        <span className="model-picker-trigger-label">{triggerLabel}</span>
        <ChevronDown size={13} />
      </button>

      {open ? (
        <div className="model-picker-menu" role="listbox" aria-label="Choose a Banana model">
          {tiers.length > 0 ? (
            <div className="model-picker-section">
              <p className="model-picker-heading">{tiersHeading}</p>
              <div className="model-picker-tiers">
                {tiers.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    role="option"
                    aria-selected={model === tier.id}
                    className={`model-picker-tier ${model === tier.id ? 'is-active' : ''}`}
                    onClick={() => pick(tier.id)}
                  >
                    <span className="model-picker-tier-label">{tier.label}</span>
                    {tier.detail ? <span className="model-picker-tier-detail">{tier.detail}</span> : null}
                    {model === tier.id ? <Check size={13} className="model-picker-tier-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {favoriteModels.length > 0 ? (
            <div className="model-picker-section">
              <p className="model-picker-heading">Favorites</p>
              <div className="model-picker-list">
                {favoriteModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={model === m.id}
                    className={`model-picker-row has-star ${model === m.id ? 'is-active' : ''}`}
                    onClick={() => pick(m.id)}
                    title={m.id}
                  >
                    <span className="model-picker-row-label">{m.label}</span>
                    {m.detail ? <span className="model-picker-row-detail">{m.detail}</span> : null}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Unfavorite ${m.label}`}
                      className="model-picker-star is-favorite"
                      onClick={(e) => onStarClick(e, m.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(m.id);
                        }
                      }}
                    >
                      <Star size={13} fill="currentColor" />
                    </span>
                    {model === m.id ? <Check size={13} className="model-picker-row-check" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="model-picker-section">
            <div className="model-picker-heading-row">
              <p className="model-picker-heading">{listHeading}</p>
              <span id={countId} className="model-picker-count" role="status" aria-live="polite">
                {countLabel}
              </span>
            </div>
            <div className="model-picker-search">
              <Search size={13} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-describedby={countId}
                autoFocus
              />
            </div>
            <div className="model-picker-list r-scroll">
              {loading ? (
                <p className="model-picker-empty">Loading OpenRouter models...</p>
              ) : error ? (
                <p className="model-picker-empty model-picker-error">{error}</p>
              ) : filtered.length === 0 ? (
                <p className="model-picker-empty">
                  {query.trim() ? 'No models match that search.' : 'No models available.'}
                </p>
              ) : (
                filtered.map((m) => {
                  const isFavorite = favorites.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={model === m.id}
                      className={`model-picker-row has-star ${model === m.id ? 'is-active' : ''}`}
                      onClick={() => pick(m.id)}
                      title={m.id}
                    >
                      <span className="model-picker-row-label">{m.label}</span>
                      {m.detail ? <span className="model-picker-row-detail">{m.detail}</span> : null}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${m.label}`}
                        aria-pressed={isFavorite}
                        className={`model-picker-star ${isFavorite ? 'is-favorite' : ''}`}
                        onClick={(e) => onStarClick(e, m.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFavorite(m.id);
                          }
                        }}
                      >
                        <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                      </span>
                      {model === m.id ? <Check size={13} className="model-picker-row-check" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
