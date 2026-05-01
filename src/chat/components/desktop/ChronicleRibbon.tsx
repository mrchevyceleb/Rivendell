import { SamPortrait } from '../primitives/atoms';
import type { ChronicleEvent, ChronicleEventKind } from '../../data/mock';
import type { CompanionId, LiveSession } from '../../data/types';

const COMPANION_LABEL: Record<CompanionId, string> = {
  claude: 'claude',
  codex: 'codex',
  assistant: 'assistant',
};

const dotColor: Record<ChronicleEventKind, string> = {
  ember: 'var(--ember)',
  gold: 'var(--gold)',
  moss: 'var(--moss)',
  ink: 'var(--ink-faint)',
};

export function ChronicleRibbon({
  events,
  activeId,
  collapsed = false,
  onSelect,
  onNew,
  theme = 'light',
  onToggleTheme,
  liveSessions = [],
  onSelectLive,
}: {
  events: ChronicleEvent[];
  activeId?: string | null;
  collapsed?: boolean;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  liveSessions?: LiveSession[];
  onSelectLive?: (s: LiveSession) => void;
}) {
  const wide = !collapsed;
  return (
    <aside
      className="sw-chronicle-ribbon"
      style={{
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        width: wide ? 220 : 64,
        height: '100dvh',
        borderRight: '1px solid var(--rule-soft)',
        backdropFilter: 'blur(6px)',
        padding: '20px 0',
        transition: 'width 0.2s',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        onClick={onNew}
        title="back to the threshold"
        style={{
          padding: wide ? '0 18px 10px' : '0 14px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
        }}
      >
        <SamPortrait size={24} />
        {wide && (
          <span className="sw-smallcaps" style={{ fontSize: 11 }}>
            The chronicle
          </span>
        )}
        {wide && (
          <span className="sw-folio" style={{ marginLeft: 'auto', fontSize: 12 }}>
            v
          </span>
        )}
      </div>
      <hr className="sw-rule-solid" style={{ margin: '0 12px 10px' }} />

      {liveSessions.length > 0 && (
        <div style={{ padding: wide ? '0 12px 8px' : '0 8px 8px' }}>
          {wide && (
            <div
              className="sw-smallcaps"
              style={{ fontSize: 10, color: 'var(--ember)', marginBottom: 4, letterSpacing: '0.18em' }}
            >
              · now ·
            </div>
          )}
          {liveSessions.map((s) => (
            <div
              key={`${s.cli}|${s.cwd}`}
              onClick={() => onSelectLive?.(s)}
              title={`${COMPANION_LABEL[s.cli]} · ${s.cwd}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: wide ? 8 : 0,
                padding: wide ? '4px 6px' : '4px 0',
                marginBottom: 2,
                borderRadius: 2,
                cursor: 'pointer',
                background: s.busy ? 'rgba(184,89,58,0.10)' : 'transparent',
              }}
            >
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--ember)',
                  flexShrink: 0,
                  animation: s.busy ? 'sw-pulse 1.4s infinite' : 'none',
                  opacity: s.busy ? 1 : 0.5,
                }}
              />
              {wide && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--serif-display)',
                      fontStyle: 'italic',
                      fontSize: 14,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.2,
                    }}
                  >
                    {s.repoName}
                  </div>
                  <div
                    className="sw-mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-faint)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {COMPANION_LABEL[s.cli]}{s.busy ? ' · tending' : ' · idle'}
                  </div>
                </div>
              )}
            </div>
          ))}
          <hr className="sw-rule-solid" style={{ margin: '8px 0 4px', opacity: 0.5 }} />
        </div>
      )}

      <div
        className="sw-scroll"
        style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
      >
        <div style={{ position: 'relative', paddingLeft: wide ? 28 : 26 }}>
          <div
            style={{
              position: 'absolute',
              left: wide ? 18 : 16,
              top: 4,
              bottom: 4,
              width: 1,
              background: 'var(--rule-soft)',
            }}
          />
          {events.map((e) => {
            const c = dotColor[e.kind];
            const active = e.id === activeId;
            const padTop = 6;
            const padBottom = wide ? 8 : 6;
            const padRight = wide ? 12 : 0;
            const padLeft = active ? (wide ? 6 : 4) : 0;
            return (
              <div
                key={e.id}
                onClick={() => onSelect?.(e.id)}
                style={{
                  position: 'relative',
                  paddingTop: padTop,
                  paddingRight: padRight,
                  paddingBottom: padBottom,
                  paddingLeft: padLeft,
                  background: active ? 'rgba(184,89,58,0.06)' : 'transparent',
                  borderLeft: active
                    ? '2px solid var(--ember)'
                    : '2px solid transparent',
                  marginLeft: active ? -2 : 0,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: wide ? -16 : -12,
                    top: 9,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: 'var(--vellum)',
                    border: `1.5px solid ${c}`,
                    animation: e.busy ? 'sw-pulse 1.4s infinite' : 'none',
                  }}
                />
                {wide ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span className="sw-folio" style={{ fontSize: 11 }}>
                        {e.t}
                      </span>
                      {e.awaits && (
                        <span
                          className="sw-smallcaps"
                          style={{ fontSize: 10, color: 'var(--gold)' }}
                        >
                          asks
                        </span>
                      )}
                      {e.busy && (
                        <span
                          className="sw-smallcaps"
                          style={{ fontSize: 10, color: 'var(--ember)' }}
                        >
                          now
                        </span>
                      )}
                      {e.running && !e.busy && (
                        <span
                          className="sw-smallcaps"
                          style={{ fontSize: 10, color: 'var(--gold)' }}
                        >
                          warm
                        </span>
                      )}
                      {e.asleep && (
                        <span
                          className="sw-smallcaps"
                          style={{ fontSize: 10, color: 'var(--ink-faint)' }}
                        >
                          asleep
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--serif-body)',
                        fontSize: 14,
                        color: active ? 'var(--ink)' : 'var(--ink-2)',
                        fontWeight: active ? 500 : 400,
                        lineHeight: 1.25,
                        marginTop: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {e.title}
                    </div>
                    <div
                      className="sw-mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-faint)',
                        marginTop: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {e.repo}
                    </div>
                  </>
                ) : (
                  <span
                    className="sw-folio"
                    style={{ fontSize: 10.5, display: 'block', textAlign: 'center' }}
                  >
                    {e.t}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          padding: wide ? '8px 12px 0' : '8px 8px 0',
          borderTop: '1px solid var(--rule-soft)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <button
          className="sw-btn"
          onClick={onNew}
          style={{
            width: '100%',
            fontSize: 13,
            padding: wide ? '8px 10px' : '8px 0',
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
          }}
        >
          {wide ? '+ a new errand' : '+'}
        </button>
        {onToggleTheme && (
          <button
            className="sw-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'switch to day' : 'switch to dusk'}
            aria-label={theme === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
            style={{
              width: '100%',
              fontSize: wide ? 13 : 14,
              padding: wide ? '8px 10px' : '8px 0',
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
              color: 'var(--ink-soft)',
            }}
          >
            {wide ? (theme === 'dark' ? 'sun ☀' : 'dusk ☾') : theme === 'dark' ? '☀' : '☾'}
          </button>
        )}
      </div>
    </aside>
  );
}
