import { useState } from 'react';
import { SamPortrait, SearchGlyph } from '../primitives/atoms';
import {
  COMPANIONS,
  SPECIAL_REPOS,
  HUBS,
  STATS,
  ASSISTANT_HUB,
  type CompanionId,
  type Repo,
  type Hub,
} from '../../data/mock';

type ThresholdProps = {
  repos: Repo[];
  reposLoading?: boolean;
  onSetForth: (params: {
    companion: CompanionId;
    repo?: Repo;
    initialMessage?: string;
  }) => void;
};

export function Threshold({ repos, reposLoading, onSetForth }: ThresholdProps) {
  const [companion, setCompanion] = useState<CompanionId>('claude');
  // The Assistant Hub from the live repo list, if discovered. Falls back to the constant.
  const liveAssistantHub = repos.find((r) => r.isAssistantHub) ?? ASSISTANT_HUB;
  const regularRepos = repos.filter((r) => !r.isAssistantHub);
  const [selectedRepo, setSelectedRepo] = useState<Repo | undefined>(undefined);
  const [query, setQuery] = useState('');
  const defaultRepo = regularRepos[0];

  const filteredRepos = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return regularRepos;
    return regularRepos.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      (r.hub ?? '').toLowerCase().includes(q) ||
      (r.branch ?? '').toLowerCase().includes(q),
    );
  })();

  const pickCompanion = (id: CompanionId) => {
    setCompanion(id);
    if (id === 'assistant') setSelectedRepo(liveAssistantHub);
  };

  const effectiveRepo = companion === 'assistant' ? liveAssistantHub : selectedRepo ?? defaultRepo;
  const selectedRepoPath = effectiveRepo?.path;

  const setForth = (initialMessage?: string) => {
    onSetForth({ companion, repo: effectiveRepo, initialMessage });
  };

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query.trim()) return;
    e.preventDefault();
    // If exactly one repo matches, treat the typed text as a repo selector and
    // just set forth without a message. Otherwise treat it as the first message.
    if (filteredRepos.length === 1 && query.trim() === filteredRepos[0].name) {
      setSelectedRepo(filteredRepos[0]);
      setQuery('');
      onSetForth({ companion, repo: filteredRepos[0] });
      return;
    }
    setForth(query.trim());
    setQuery('');
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '72px 48px 48px',
        overflowY: 'auto',
      }}
    >
      {/* Sam himself + title block */}
      <div
        style={{
          padding: 7,
          background: 'var(--vellum)',
          border: '1px solid var(--rule)',
          borderRadius: '50%',
          boxShadow:
            '0 1px 0 var(--shadow-warm), 0 0 36px rgba(184,89,58,0.10)',
          marginBottom: 22,
        }}
      >
        <SamPortrait size={128} ring={false} />
      </div>
      <div className="sw-folio" style={{ marginBottom: 8, letterSpacing: '0.18em', fontSize: 12 }}>
        · vol. ii ·
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: 'var(--serif-display)',
          fontSize: 84,
          fontWeight: 500,
          lineHeight: 0.95,
          color: 'var(--ink)',
          letterSpacing: 0,
        }}
      >
        Samwise
      </h1>
      <p
        style={{
          margin: '20px 0 0',
          fontFamily: 'var(--serif-display)',
          fontStyle: 'italic',
          fontSize: 28,
          color: 'var(--ink-soft)',
          textAlign: 'center',
          maxWidth: 620,
        }}
      >
        At your service, master.
        <span style={{ color: 'var(--ink-faint)' }}>
          {' '}
          Whither shall we go this morning?
        </span>
      </p>

      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 24, marginTop: 40, alignItems: 'center' }}>
        <ThresholdStat n={STATS.underway} l="underway" tone="ember" />
        <Divider />
        <ThresholdStat n={STATS.awaits} l="awaits" tone="gold" />
        <Divider />
        <ThresholdStat n={STATS.finished} l="finished today" tone="moss" />
      </div>

      {/* Command palette */}
      <div
        style={{
          width: 760,
          maxWidth: '100%',
          marginTop: 44,
          background: 'var(--vellum)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          boxShadow:
            '0 1px 0 var(--shadow-warm), 0 12px 40px rgba(74,50,24,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--rule-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <SearchGlyph size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="type to begin, or pick from below"
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--serif-display)',
              fontStyle: query ? 'normal' : 'italic',
              fontSize: 26,
              color: query ? 'var(--ink)' : 'var(--ink-faint)',
            }}
          />
          <span className="sw-folio">⌘K</span>
        </div>

        <div style={{ padding: '18px 24px 8px' }}>
          <SectionLabel folio="i" label="choose your companion" />
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            {COMPANIONS.map((c) => (
              <CompanionPick
                key={c.id}
                name={c.name}
                sub={c.sub}
                selected={c.id === companion}
                onSelect={() => pickCompanion(c.id)}
              />
            ))}
          </div>
        </div>

        <hr style={{ border: 0, height: 1, background: 'var(--rule-soft)', margin: 0 }} />

        <div style={{ padding: '18px 24px' }}>
          <SectionLabel
            folio="ii"
            label={
              companion === 'assistant'
                ? 'tending the hub'
                : 'where shall we work?'
            }
          />
          {companion === 'assistant' ? (
            <div
              style={{
                padding: '11px 14px',
                borderLeft: '2px solid var(--ember)',
                background: 'rgba(184,89,58,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <svg width="11" height="14" viewBox="0 0 11 14" fill="none" style={{ flexShrink: 0 }}>
                <path d="M1 2 H10 V12 H1 Z" stroke="var(--ink-soft)" strokeWidth="0.8" />
                <path d="M3 5 H8 M3 7 H8 M3 9 H6" stroke="var(--ink-soft)" strokeWidth="0.6" />
              </svg>
              <span
                className="sw-mono"
                style={{
                  fontSize: 14,
                  color: 'var(--ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                ASSISTANT-HUB
              </span>
              <span
                className="sw-mono"
                style={{ fontSize: 12.5, color: 'var(--ember)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                · master
              </span>
              <span
                className="sw-folio"
                style={{ whiteSpace: 'nowrap', flexShrink: 0, fontStyle: 'italic' }}
              >
                always at hand
              </span>
            </div>
          ) : reposLoading && regularRepos.length === 0 ? (
            <div
              className="sw-folio"
              style={{ padding: '8px 4px', fontStyle: 'italic' }}
            >
              scanning the shelves…
            </div>
          ) : (
            <>
              {filteredRepos.length === 0 ? (
                <div
                  className="sw-folio"
                  style={{ padding: '8px 4px', fontStyle: 'italic' }}
                >
                  no repo matches "{query}"
                </div>
              ) : (
                groupByHub(filteredRepos).map(({ hub, repos: hubRepos }) => (
                  <div key={hub} style={{ marginBottom: 8 }}>
                    {hub && (
                      <div
                        className="sw-folio"
                        style={{
                          fontSize: 10.5,
                          fontStyle: 'italic',
                          color: 'var(--ink-faint)',
                          padding: '4px 12px 2px',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {hub}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {hubRepos.map((r) => (
                        <RepoPick
                          key={r.path}
                          repo={r}
                          selected={r.path === selectedRepoPath}
                          onClick={() => setSelectedRepo(r)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
              {!query && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  {SPECIAL_REPOS.map((r) => (
                    <RepoPick
                      key={r.path}
                      repo={r}
                      selected={false}
                      onClick={() => setSelectedRepo(undefined)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--rule-soft)',
            background: 'var(--parchment-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span className="sw-folio" style={{ fontStyle: 'italic' }}>
            ↵ to set forth · ⌘ + ↑/↓ to walk through
          </span>
          <span style={{ marginLeft: 'auto' }}></span>
          <button
            className="sw-btn sw-btn-primary"
            style={{ fontSize: 16, padding: '10px 24px' }}
            onClick={() => {
              setForth(query.trim() || undefined);
              setQuery('');
            }}
          >
            Set forth
          </button>
        </div>
      </div>

      {/* Hubs strip */}
      <div
        style={{
          width: 760,
          maxWidth: '100%',
          marginTop: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span className="sw-smallcaps" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          or, an established hub
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--rule-soft)' }} />
        <span className="sw-folio" style={{ fontStyle: 'italic' }}>
          iii
        </span>
      </div>
      <div
        style={{
          width: 760,
          maxWidth: '100%',
          marginTop: 14,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {HUBS.map((h) => (
          <PillHub key={h.name} hub={h} />
        ))}
      </div>
    </div>
  );
}

// ─── Atoms ───
function Divider() {
  return <span style={{ width: 1, height: 52, background: 'var(--rule-soft)' }} />;
}

function ThresholdStat({
  n,
  l,
  tone,
}: { n: number | string; l: string; tone: 'ember' | 'moss' | 'gold' }) {
  const colors = {
    ember: 'var(--ember)',
    moss: 'var(--moss)',
    gold: 'var(--gold)',
  } as const;
  return (
    <div style={{ textAlign: 'center', minWidth: 88 }}>
      <div
        style={{
          fontFamily: 'var(--serif-display)',
          fontSize: 48,
          fontWeight: 500,
          lineHeight: 1,
          color: colors[tone],
        }}
      >
        {n}
      </div>
      <div
        className="sw-smallcaps"
        style={{ fontSize: 12, marginTop: 6, whiteSpace: 'nowrap' }}
      >
        {l}
      </div>
    </div>
  );
}

function SectionLabel({ folio, label }: { folio: string; label: string }) {
  return (
    <div
      className="sw-smallcaps"
      style={{ fontSize: 12, marginBottom: 12, whiteSpace: 'nowrap' }}
    >
      <span className="sw-folio" style={{ marginRight: 8, fontSize: 12 }}>
        {folio}
      </span>
      {label}
    </div>
  );
}

function CompanionPick({
  name,
  sub,
  selected,
  onSelect,
}: { name: string; sub: string; selected?: boolean; onSelect?: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        flex: 1,
        padding: '16px 18px',
        background: selected ? 'var(--ink)' : 'var(--vellum)',
        color: selected ? 'var(--vellum)' : 'var(--ink)',
        border: '1px solid ' + (selected ? 'var(--ink)' : 'var(--rule)'),
        borderRadius: 12,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            flexShrink: 0,
            border: '1.2px solid ' + (selected ? 'var(--vellum)' : 'var(--rule)'),
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--vellum)',
              }}
            />
          )}
        </span>
        <span
          style={{
            fontFamily: 'var(--serif-display)',
            fontSize: 19,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--serif-display)',
          fontStyle: 'italic',
          fontSize: 14.5,
          color: selected ? 'rgba(241,232,214,0.7)' : 'var(--ink-soft)',
          paddingLeft: 26,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

// Bucket repos by hub, preserving the order in which hubs were first seen.
function groupByHub(repos: Repo[]): Array<{ hub: string; repos: Repo[] }> {
  const order: string[] = [];
  const buckets = new Map<string, Repo[]>();
  for (const r of repos) {
    const key = r.hub ?? '';
    if (!buckets.has(key)) {
      order.push(key);
      buckets.set(key, []);
    }
    buckets.get(key)!.push(r);
  }
  return order.map((hub) => ({ hub, repos: buckets.get(hub)! }));
}

function RepoPick({
  repo,
  selected,
  onClick,
}: { repo: Repo; selected: boolean; onClick: () => void }) {
  const { branch, pinned, italic, awaits } = repo;
  return (
    <div
      onClick={onClick}
      title={repo.path}
      style={{
        padding: '11px 14px',
        borderRadius: 2,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: selected ? 'rgba(184,89,58,0.08)' : 'transparent',
        borderLeft: pinned
          ? '2px solid var(--ember)'
          : awaits
            ? '2px solid var(--gold)'
            : '2px solid transparent',
        minWidth: 0,
      }}
    >
      {!italic && (
        <svg width="13" height="16" viewBox="0 0 11 14" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 2 H10 V12 H1 Z" stroke="var(--ink-soft)" strokeWidth="0.8" />
          <path
            d="M3 5 H8 M3 7 H8 M3 9 H6"
            stroke="var(--ink-soft)"
            strokeWidth="0.6"
          />
        </svg>
      )}
      <span
        style={{
          fontSize: 14,
          color: italic ? 'var(--ink-soft)' : 'var(--ink)',
          fontStyle: italic ? 'italic' : 'normal',
          fontFamily: italic ? 'var(--serif-display)' : 'var(--mono)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flex: '1 1 0',
        }}
      >
        {repo.name}
      </span>
      {branch && (
        <span
          className="sw-mono"
          style={{
            fontSize: 12.5,
            color: 'var(--ember)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {branch}
        </span>
      )}
    </div>
  );
}

function PillHub({ hub }: { hub: Hub }) {
  return (
    <div
      style={{
        padding: '10px 18px',
        background: hub.cozy ? 'var(--parchment-3)' : 'var(--vellum)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--serif-display)',
          fontSize: 16,
          fontStyle: 'italic',
          whiteSpace: 'nowrap',
        }}
      >
        {hub.name}
      </span>
      <span
        className="sw-mono"
        style={{ fontSize: 12, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}
      >
        {hub.count}
      </span>
    </div>
  );
}
