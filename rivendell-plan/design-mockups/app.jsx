/* global React, ReactDOM, AppShell, HallView, RoomViews, MobileShell */
const { useState: useStateApp, useEffect: useEffectApp } = React;
const { Sidebar } = AppShell;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "view": "desktop",
  "agent": "claude"
}/*EDITMODE-END*/;

const App = () => {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = useStateApp('/');
  const [collapsed, setCollapsed] = useStateApp(false);

  // Apply theme to <html> so CSS vars cascade everywhere
  useEffectApp(() => {
    document.documentElement.dataset.theme = tweaks.theme || 'dark';
  }, [tweaks.theme]);

  // Wire up the desktop/mobile pill in the corner
  useEffectApp(() => {
    window.__setView = (v) => setTweak('view', v);
    // sync pill button states
    document.querySelectorAll('.view-switch button').forEach(b => {
      const label = b.textContent.trim().toLowerCase();
      b.classList.toggle('active', label === (tweaks.view || 'desktop'));
    });
  }, [tweaks.view, setTweak]);

  // Mobile branch — render the iPhone frame, no sidebar
  if (tweaks.view === 'mobile') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', width: '100vw',
        background: tweaks.theme === 'light'
          ? 'radial-gradient(ellipse at center, #ebe1cf 0%, #d8c9aa 100%)'
          : 'radial-gradient(ellipse at center, #07090f 0%, #02030a 100%)',
        position: 'relative',
      }}>
        {/* faint vignette stars on dark bg only */}
        {tweaks.theme !== 'light' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.3 }}>
            {Array.from({ length: 60 }, (_, i) => {
              const x = (i * 37) % 100, y = (i * 73) % 100;
              const s = ((i * 13) % 14) / 10 + 0.3;
              return (
                <div key={i} style={{
                  position: 'absolute', left: x + '%', top: y + '%',
                  width: s, height: s, borderRadius: '50%',
                  background: '#e6f2ff',
                  boxShadow: `0 0 ${s * 3}px rgba(230,242,255,0.6)`,
                }}/>
              );
            })}
          </div>
        )}
        <MobileShell dark={tweaks.theme !== 'light'}/>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Light or dark"/>
          <TweakRadio label="Theme" value={tweaks.theme}
            options={['dark', 'light']} onChange={(v) => setTweak('theme', v)}/>
          <TweakSection label="View"/>
          <TweakRadio label="Form factor" value={tweaks.view}
            options={['desktop', 'mobile']} onChange={(v) => setTweak('view', v)}/>
        </TweaksPanel>
      </div>
    );
  }

  const Page = (() => {
    switch (active) {
      case '/':          return <HallView/>;
      case '/tidings':   return <RoomViews.TidingsView/>;
      case '/scribe':    return <ScribeFullView/>;
      case '/council':   return <RoomViews.CouncilView/>;
      case '/reckoning': return <RoomViews.ReckoningView/>;
      case '/ravens':    return <RoomViews.RavensView/>;
      case '/hearth':    return <RoomViews.HearthView/>;
      case '/library':   return <RoomViews.LibraryView/>;
      case '/annals':    return <RoomViews.AnnalsView/>;
      case '/weavings':  return <RoomViews.WeavingsView/>;
      case '/forge':     return <RoomViews.ForgeView/>;
      default:           return <HallView/>;
    }
  })();

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {/* Subtle starfield over whole app — fades out in light theme */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 'calc(0.5 * var(--r-star-show))' }}>
        {Array.from({ length: 50 }, (_, i) => {
          const x = (i * 37) % 100;
          const y = (i * 73) % 100;
          const s = ((i * 13) % 14) / 10 + 0.4;
          return (
            <div key={i} style={{
              position: 'absolute', left: x + '%', top: y + '%',
              width: s, height: s, borderRadius: '50%',
              background: 'var(--r-star-color)',
              boxShadow: `0 0 ${s * 3}px var(--r-star-color)`,
              animation: `r-twinkle ${2 + (i % 5)}s ease-in-out infinite`,
              animationDelay: (i * 0.13) + 's',
            }}/>
          );
        })}
      </div>

      <Sidebar active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed}/>
      <main style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }} data-screen-label={active}>
        {Page}
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Light or dark"/>
        <TweakRadio
          label="Theme"
          value={tweaks.theme}
          options={['dark', 'light']}
          onChange={(v) => setTweak('theme', v)}
        />
        <div style={{
          fontSize: 10.5, lineHeight: 1.5,
          color: 'var(--r-ink-mute)', padding: '4px 0 8px', fontStyle: 'italic',
        }}>
          {tweaks.theme === 'dark'
            ? 'Imladris by night — starlight, mithril, gold.'
            : 'Imladris at dawn — parchment, ink, gilt.'}
        </div>
        <TweakSection label="View"/>
        <TweakRadio
          label="Form factor"
          value={tweaks.view}
          options={['desktop', 'mobile']}
          onChange={(v) => setTweak('view', v)}
        />
      </TweaksPanel>
    </div>
  );
};

// Full Scribe page — uses same data, fuller layout
const ScribeFullView = () => {
  const { RoomHeader } = window.SharedRoom || {};
  return (
    <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '28px 36px 18px', borderBottom: '1px solid var(--r-line)' }}>
        <div className="r-eyebrow-gold">The Scribe</div>
        <div className="r-display" style={{ fontSize: 36, color: 'var(--r-star)', lineHeight: 1, marginTop: 6 }}>Every act, recorded</div>
        <div className="r-display-i" style={{ fontSize: 15, color: 'var(--r-ink-mute)', marginTop: 8 }}>
          Elrond does nothing in shadow. Every tool call, every decision, kept here.
        </div>
      </div>
      <div style={{ padding: '24px 36px', maxWidth: 900 }}>
        <div style={{
          background: 'var(--r-bg-card)', border: '1px solid var(--r-line)', borderRadius: 14,
          fontFamily: 'var(--r-mono)', fontSize: 12.5, padding: 22, lineHeight: 1.7,
        }}>
          <div style={{ color: 'var(--r-ink-mute)' }}>● live · streaming from elrond.tail-scale.ts.net</div>
          <div style={{ height: 12 }}/>
          {[
            { t: '08:21:14', lvl: 'thinking', text: 'watching for threefold-export-v3.csv to land in /inbox' },
            { t: '08:14:02', lvl: 'tool', text: 'web.search("YPP competitor pricing 2026") → 4 results' },
            { t: '08:14:08', lvl: 'tool', text: 'fs.write("/docs/ypp-q2-research.md", 1.4kb)' },
            { t: '08:14:09', lvl: 'note', text: 'wrote ypp-q2-research.md — 4 datapoints captured' },
            { t: '08:03:11', lvl: 'tool', text: 'stripe.list({status:"paid", since:"24h"}) → 3 invoices' },
            { t: '08:03:12', lvl: 'tool', text: 'tasks.close(ids=[KG-Q1, ET-retainer, mjio-host])' },
            { t: '08:03:13', lvl: 'note', text: 'closed 3 tasks confirmed paid by stripe' },
            { t: '07:48:41', lvl: 'tool', text: 'gcal.read({day:"today"}) → 6 events, 1 conflict at 13:00' },
            { t: '07:48:50', lvl: 'tool', text: 'gcal.draft({move:"EliteTeam standup", to:"14:00"}) → draft id=A1B2' },
            { t: '07:48:51', lvl: 'note', text: 'drafted move for 13:00 conflict — not yet confirmed' },
            { t: '07:42:08', lvl: 'tool', text: 'gmail.list({account:"all", since:"6h", category:"newsletter"}) → 14' },
            { t: '07:42:32', lvl: 'tool', text: 'gmail.label({ids:[14], label:"Reading"})' },
            { t: '07:42:33', lvl: 'note', text: 'sorted 14 newsletters → Reading queue' },
            { t: '07:14:00', lvl: 'system', text: 'awakened · 47 tools loaded · ts-mac-mini reachable' },
          ].map((line, i) => {
            const colors = { thinking: 'var(--r-ink-mute)', tool: 'var(--r-elf-glow)', note: 'var(--r-gold)', system: 'var(--r-emerald)' };
            return (
              <div key={i} style={{ display: 'flex', gap: 14, padding: '3px 0', color: 'var(--r-ink-soft)' }}>
                <span style={{ color: 'var(--r-ink-faint)' }}>{line.t}</span>
                <span style={{ color: colors[line.lvl], minWidth: 70, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10.5, alignSelf: 'center' }}>{line.lvl}</span>
                <span style={{ flex: 1 }}>{line.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
