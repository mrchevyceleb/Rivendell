import { Check, ChevronDown, Cpu, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MONKEY_TIERS, useBananaModel } from '../hooks/useBananaModel';

// Model selector for the Banana companion. Renders a trigger button + a
// dropdown with the four monkey quick-picks and a searchable OpenRouter list.
// The picked model id is owned by useBananaModel (localStorage-backed); this
// component only surfaces it.

type ModelPickerState = ReturnType<typeof useBananaModel>;

export function ModelPicker({ state }: { state: ModelPickerState }) {
  const { model, setModel, openRouter, loading, error, loadOpenRouter, triggerLabel } = state;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
    setOpen((value) => {
      const next = !value;
      // Fetch the OpenRouter catalogue lazily, only when the picker opens.
      if (next) loadOpenRouter();
      return next;
    });
  };

  // Filter the OpenRouter list as the user types — match id or label.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return openRouter.slice(0, 60);
    return openRouter
      .filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      .slice(0, 60);
  }, [query, openRouter]);

  const pick = (id: string) => {
    setModel(id);
    setOpen(false);
    setQuery('');
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
          <div className="model-picker-section">
            <p className="model-picker-heading">Monkey tiers</p>
            <div className="model-picker-tiers">
              {MONKEY_TIERS.map((tier) => (
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

          <div className="model-picker-section">
            <p className="model-picker-heading">OpenRouter</p>
            <div className="model-picker-search">
              <Search size={13} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search OpenRouter models..."
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
                filtered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={model === m.id}
                    className={`model-picker-row ${model === m.id ? 'is-active' : ''}`}
                    onClick={() => pick(m.id)}
                    title={m.id}
                  >
                    <span className="model-picker-row-label">{m.label}</span>
                    {m.detail ? <span className="model-picker-row-detail">{m.detail}</span> : null}
                    {model === m.id ? <Check size={13} className="model-picker-row-check" /> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
