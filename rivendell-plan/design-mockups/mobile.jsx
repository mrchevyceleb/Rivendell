/* global React, Ornaments, AppShell, IOSDevice */
const { useState: useStateMob, useRef: useRefMob, useEffect: useEffectMob } = React;
const { Evenstar: EvM, KnotDivider: KnotM, Corner: CornerM, Signet: SignM, ElvenLeaf: LeafM } = Ornaments;
const MOCK_M = AppShell.MOCK;
const { RoomGlyph: RoomGlyphM, ROOMS: ROOMS_M } = AppShell;

// =================================================================
// Mobile — iPhone-sized Rivendell
// Three frames: Hall (chat), Tidings (brief), Council (tasks)
// All within a custom shell — uses our CSS variables for theme parity
// =================================================================

const MOBILE_W = 402, MOBILE_H = 874;

// ---- Shared bottom tab bar (5 tabs) ----
const MOBILE_TABS = [
  { key: 'hall',     name: 'Hall',     icon: 'hall' },
  { key: 'tidings',  name: 'Tidings',  icon: 'tidings' },
  { key: 'council',  name: 'Tasks',    icon: 'council' },
  { key: 'ravens',   name: 'Ravens',   icon: 'ravens' },
  { key: 'more',     name: 'More',     icon: 'forge' },
];

const MobileTabBar = ({ active, setActive }) => (
  <div style={{
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 88,
    paddingBottom: 30,
    background: 'linear-gradient(180deg, transparent, var(--r-bg) 24%)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    display: 'flex',
    borderTop: '1px solid var(--r-line)',
    zIndex: 50,
  }}>
    {MOBILE_TABS.map(tab => {
      const isActive = active === tab.key;
      return (
        <button key={tab.key} onClick={() => setActive(tab.key)} style={{
          flex: 1,
          background: 'transparent', border: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, cursor: 'pointer',
          color: isActive ? 'var(--r-gold)' : 'var(--r-ink-mute)',
          padding: '10px 0',
        }}>
          <RoomGlyphM kind={tab.icon} color={isActive ? '#d4af63' : 'var(--r-ink-mute)'} size={20}/>
          <span style={{ fontSize: 10, letterSpacing: '0.04em', fontWeight: isActive ? 500 : 400 }}>{tab.name}</span>
        </button>
      );
    })}
  </div>
);

// ---- Top "navbar" with elven trim ----
const MobileNav = ({ title, eyebrow, right, leading }) => (
  <div style={{
    paddingTop: 56,
    paddingBottom: 14,
    paddingLeft: 22, paddingRight: 22,
    background: 'var(--r-bg)',
    borderBottom: '1px solid var(--r-line)',
    position: 'relative',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      {leading || <div style={{ width: 28, height: 28 }}/>}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="r-eyebrow-gold" style={{ fontSize: 9 }}>{eyebrow}</div>
        <div className="r-display" style={{ fontSize: 19, color: 'var(--r-star)', lineHeight: 1.1, marginTop: 2 }}>{title}</div>
      </div>
      {right || <div style={{ width: 28, height: 28 }}/>}
    </div>
    {/* tiny knotwork accent */}
    <div style={{ position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)' }}>
      <svg width="56" height="6" viewBox="0 0 56 6" fill="none">
        <path d="M0 3 H22" stroke="var(--r-line-gold)" strokeWidth="0.6"/>
        <path d="M34 3 H56" stroke="var(--r-line-gold)" strokeWidth="0.6"/>
        <circle cx="28" cy="3" r="1.5" fill="var(--r-gold)" opacity="0.5"/>
      </svg>
    </div>
  </div>
);

// =================== Hall (chat, mobile) ===================
const MobileHall = () => {
  const [thread, setThread] = useStateMob([
    { role: 'assistant', t: '7:24 AM', content: 'Good morning, Matt. While you slept I closed three tasks Stripe confirmed paid and sorted fourteen newsletters into Reading. Kim replied late last night — my draft response sits in your inbox.' },
    { role: 'assistant', t: '7:24 AM', content: 'One thing for your eye: the EliteTeam standup at 9 collides with a Threefold dial-in. I left both flagged.' },
    { role: 'user', t: '7:26 AM', content: 'show me kim\'s draft' },
    { role: 'assistant', t: '7:26 AM', toolBlock: true, toolName: 'gmail.draft.read', toolPreview: 'Kim — happy to make the change. Two thoughts before we ship: (1) the headline test is still inconclusive at 1,400 visits; I\'d give it through Friday. (2) The opt-in copy reads stronger if we move "free" to the second line.' },
    { role: 'assistant', t: '7:26 AM', content: 'Read it twice. Want me to soften the "Friday" line or send as-is?' },
  ]);
  const scrollRef = useRefMob(null);
  useEffectMob(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length]);

  const [val, setVal] = useStateMob('');
  const send = () => {
    if (!val.trim()) return;
    setThread(t => [...t, { role: 'user', t: 'now', content: val }]);
    setVal('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <MobileNav
        eyebrow="THE HALL"
        title="Elrond"
        leading={<button style={{ background: 'transparent', border: 'none', color: 'var(--r-ink-mute)', cursor: 'pointer', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>}
        right={<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="r-pulse-dot green" style={{ width: 6, height: 6 }}/>
          <span style={{ fontSize: 10, color: 'var(--r-ink-mute)' }}>live</span>
        </div>}
      />

      {/* chat scroll */}
      <div ref={scrollRef} className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 200px' }}>
        {/* Date stamp */}
        <div style={{ textAlign: 'center', padding: '4px 0 16px' }}>
          <div className="r-display-i" style={{ fontSize: 12, color: 'var(--r-ink-mute)' }}>Thursday · 7:42 AM</div>
        </div>

        {thread.map((m, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            {m.role === 'assistant' ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flexShrink: 0, marginTop: 2 }}>
                  <SignM size={26} color="#d4af63"><EvM size={13} color="#d4af63"/></SignM>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                    <span className="r-display-i" style={{ fontSize: 14, color: 'var(--r-gold)' }}>Elrond</span>
                    <span style={{ fontSize: 10, color: 'var(--r-ink-faint)' }}>{m.t}</span>
                  </div>
                  {m.toolBlock && (
                    <div style={{
                      background: 'var(--r-bg-deep)',
                      border: '1px solid var(--r-line)',
                      borderRadius: 10, padding: '8px 10px',
                      fontFamily: 'var(--r-mono)', fontSize: 11,
                      marginBottom: 6,
                    }}>
                      <div style={{ color: 'var(--r-elf-glow)', marginBottom: 4 }}>⌖ {m.toolName}</div>
                      <div style={{
                        fontFamily: 'var(--r-body)', fontSize: 12, color: 'var(--r-ink-soft)',
                        lineHeight: 1.5, paddingTop: 5, borderTop: '1px dashed var(--r-line)',
                      }}>{m.toolPreview}</div>
                    </div>
                  )}
                  {m.content && <div style={{ fontSize: 14, color: 'var(--r-ink)', lineHeight: 1.5 }}>{m.content}</div>}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '78%',
                  background: 'rgba(106,163,255,0.12)',
                  border: '1px solid rgba(106,163,255,0.28)',
                  borderRadius: '14px 14px 4px 14px',
                  padding: '8px 12px',
                  fontSize: 14, color: 'var(--r-ink)',
                  lineHeight: 1.45,
                }}>{m.content}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer floating above tabbar */}
      <div style={{
        position: 'absolute', bottom: 88, left: 12, right: 12,
        background: 'var(--r-bg-card)',
        border: '1px solid var(--r-line-gold)',
        borderRadius: 22,
        padding: '8px 8px 8px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
        zIndex: 40,
      }}>
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="speak…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 14, color: 'var(--r-ink)', fontStyle: 'italic',
          }}/>
        <button onClick={send} style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(212,175,99,0.18)',
          border: '1px solid var(--r-gold-soft)',
          color: 'var(--r-gold)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>↑</button>
      </div>
    </div>
  );
};

// =================== Tidings (mobile) ===================
const MobileTidings = () => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <MobileNav eyebrow="TIDINGS · APRIL 30" title="Whilst you slept"/>

    <div className="r-scroll" style={{ flex: 1, overflowY: 'auto', paddingBottom: 120 }}>
      {/* Lead — illuminated */}
      <div style={{ padding: '16px 16px 0' }}>
        <div className="r-illuminated" style={{ padding: 16, position: 'relative' }}>
          <CornerM position="tl"/><CornerM position="tr"/><CornerM position="bl"/><CornerM position="br"/>
          <div className="r-dropcap" style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--r-ink)' }}>
            Whilst you slept, three Stripe payments cleared and tasks closed. Fourteen newsletters
            sorted to Reading. The EliteTeam Q2 memo is in from Legal — redline awaits. Kim replied;
            my draft sits in your inbox. — <span style={{ color: 'var(--r-gold)', fontStyle: 'italic' }}>Elrond</span>
          </div>
        </div>
      </div>

      {/* Knotwork divider */}
      <div className="r-divider-knot" style={{ margin: '20px 24px' }}/>

      {/* Demands you today */}
      <Section eyebrow="TODAY" title="What demands you">
        {[
          { title: 'Sign Q2 partnership memo — EliteTeam', proj: 'EliteTeam', state: 'DUE TODAY', color: 'var(--r-amber)' },
          { title: "Review Kim's funnel copy", proj: 'KG-KimGarst', state: 'DUE TODAY', color: 'var(--r-amber)' },
          { title: 'Renew domain — mattjohnston.io', proj: 'Personal', state: 'OVERDUE', color: 'var(--r-rose)' },
        ].map((t, i) => <MobileRow key={i} {...t}/>)}
      </Section>

      <Section eyebrow="AWAITING YOUR EYE" title="Drafts to read">
        <MobileRow title="Reply to Kim Garst — funnel V3" proj="email · 3min read" cta="open"/>
        <MobileRow title="EliteTeam Q2 memo — redline" proj="document · 8min read" cta="open"/>
        <MobileRow title="Calendar move — 13:00 conflict" proj="calendar · 1 decision" cta="decide"/>
      </Section>

      <Section eyebrow="THE DAY AHEAD" title="Eight chimes">
        <div style={{ padding: '0 16px' }}>
          {MOCK_M.events.map((e, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, padding: '10px 0',
              borderBottom: i < MOCK_M.events.length - 1 ? '1px solid var(--r-line)' : 'none',
            }}>
              <div className="r-mono" style={{ fontSize: 11, color: 'var(--r-ink-mute)', minWidth: 50 }}>{e.time}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--r-ink)' }}>{e.title}</div>
                <div style={{ fontSize: 11, color: 'var(--r-ink-mute)', marginTop: 2 }}>{e.dur} · {e.loc || e.cal}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  </div>
);

const Section = ({ eyebrow, title, children }) => (
  <div style={{ padding: '20px 16px 4px' }}>
    <div className="r-eyebrow-gold" style={{ fontSize: 9, paddingLeft: 4 }}>{eyebrow}</div>
    <div className="r-display" style={{ fontSize: 18, color: 'var(--r-star)', margin: '4px 0 10px', paddingLeft: 4 }}>{title}</div>
    <div className="r-card" style={{ overflow: 'hidden' }}>{children}</div>
  </div>
);

const MobileRow = ({ title, proj, state, color, cta }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 14px',
    borderBottom: '1px solid var(--r-line)',
  }}>
    {state && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }}/>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: 'var(--r-ink)', lineHeight: 1.35 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--r-ink-mute)' }}>{proj}</span>
        {state && <span style={{ fontSize: 9, color, fontWeight: 600, letterSpacing: '0.1em' }}>{state}</span>}
      </div>
    </div>
    {cta && <span style={{ fontSize: 11, color: 'var(--r-elf-glow)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{cta} ›</span>}
  </div>
);

// =================== Council (mobile) ===================
const MobileCouncil = () => {
  const [filter, setFilter] = useStateMob('all');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <MobileNav eyebrow="THE COUNCIL" title="23 open · 3 today"
        right={<button style={{ background: 'rgba(212,175,99,0.14)', border: '1px solid var(--r-gold-soft)', color: 'var(--r-gold)', borderRadius: 999, width: 32, height: 32, cursor: 'pointer', fontSize: 16 }}>+</button>}/>

      {/* Filter chips */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {[
          { k: 'all',     l: 'All' },
          { k: 'today',   l: 'Today · 3' },
          { k: 'horizon', l: 'Horizon · 11' },
          { k: 'elrond',  l: '✦ Elrond · 7' },
        ].map(c => {
          const isA = filter === c.k;
          return (
            <button key={c.k} onClick={() => setFilter(c.k)} style={{
              padding: '6px 12px', borderRadius: 999,
              background: isA ? 'rgba(212,175,99,0.14)' : 'transparent',
              border: `1px solid ${isA ? 'var(--r-gold-soft)' : 'var(--r-line)'}`,
              color: isA ? 'var(--r-gold)' : 'var(--r-ink-soft)',
              fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
            }}>{c.l}</button>
          );
        })}
      </div>

      <div className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 120px' }}>
        {[
          ...MOCK_M.tasks,
          { id: 99, title: 'Draft Q3 OKRs', project: 'Personal', due: 'next week', overdue: false, priority: 'med' },
          { id: 100, title: 'Schedule Threefold facility tour', project: 'CrossFitThreefold', due: 'next week', overdue: false, priority: 'low' },
          { id: 101, title: 'Update YPP docs site', project: 'YPP', due: 'next week', overdue: false, priority: 'low' },
        ].map(t => {
          const colors = {
            'KG-KimGarst': '#c46a85', 'YPP': '#d4af63', 'EliteTeam': '#6aa3ff',
            'Personal': '#a48fd0', 'CrossFitThreefold': '#6dbf9e',
          };
          const c = colors[t.project] || 'var(--r-ink-mute)';
          return (
            <div key={t.id} style={{
              padding: '12px 14px', marginBottom: 8,
              background: 'var(--r-bg-card)',
              border: '1px solid var(--r-line)',
              borderLeft: `3px solid ${c}`,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid var(--r-line-strong)', flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--r-ink)', lineHeight: 1.3 }}>{t.title}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: c }}>● {t.project}</span>
                  <span style={{ fontSize: 10, color: t.overdue ? 'var(--r-rose)' : 'var(--r-ink-mute)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: t.overdue ? 600 : 400 }}>
                    {t.overdue ? 'overdue' : `due ${t.due}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =================== Mobile shell (with tabs + light/dark) ===================
const MobileShell = ({ dark = true }) => {
  const [tab, setTab] = useStateMob('hall');
  const Page = tab === 'hall' ? <MobileHall/>
            : tab === 'tidings' ? <MobileTidings/>
            : tab === 'council' ? <MobileCouncil/>
            : tab === 'ravens' ? <MobileRavens/>
            : <MobileMore/>;

  return (
    <IOSDevice width={MOBILE_W} height={MOBILE_H} dark={dark}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'var(--r-bg)',
        color: 'var(--r-ink)',
        overflow: 'hidden',
      }} data-theme-host>
        {/* starfield (dark only) */}
        {dark && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5 }}>
            {Array.from({ length: 24 }, (_, i) => {
              const x = (i * 37) % 100;
              const y = (i * 73) % 100;
              const s = ((i * 13) % 14) / 10 + 0.4;
              return (
                <div key={i} style={{
                  position: 'absolute', left: x + '%', top: y + '%',
                  width: s, height: s, borderRadius: '50%',
                  background: '#e6f2ff',
                  boxShadow: `0 0 ${s * 3}px rgba(230, 242, 255, 0.6)`,
                  animation: `r-twinkle ${2 + (i % 5)}s ease-in-out infinite`,
                  animationDelay: (i * 0.13) + 's',
                }}/>
              );
            })}
          </div>
        )}
        <div style={{ position: 'relative', height: '100%' }}>
          {Page}
          <MobileTabBar active={tab} setActive={setTab}/>
        </div>
      </div>
    </IOSDevice>
  );
};

const MobileRavens = () => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <MobileNav eyebrow="THE RAVENS" title="65 across 6 realms"/>
    <div className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 120px' }}>
      <div style={{ padding: '10px 12px', marginBottom: 12, fontSize: 12, color: 'var(--r-elf-glow)', background: 'rgba(106,163,255,0.06)', border: '1px dashed rgba(106,163,255,0.3)', borderRadius: 8, fontStyle: 'italic' }}>
        Elrond sorted 14 newsletters and flagged 2 invoices since 6am.
      </div>
      {MOCK_M.emails.concat(MOCK_M.emails.slice(0,3)).map((m, i) => {
        const acctColors = {
          'matt@your-profit-partners.com': '#d4af63',
          'matt@eliteteam.ai': '#6aa3ff',
          'mjohnst@gmail.com': '#c46a85',
          'matt@mattjohnston.io': '#a48fd0',
        };
        const c = acctColors[m.acct] || 'var(--r-ink-mute)';
        return (
          <div key={i} style={{
            padding: '12px 14px', marginBottom: 6,
            background: m.unread ? 'rgba(212,175,99,0.04)' : 'var(--r-bg-card)',
            border: '1px solid var(--r-line)',
            borderLeft: `3px solid ${c}`,
            borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.unread ? 'var(--r-gold)' : 'transparent' }}/>
              <span style={{ fontSize: 12.5, color: m.unread ? 'var(--r-star)' : 'var(--r-ink-soft)', fontWeight: m.unread ? 500 : 400, flex: 1 }}>{m.from}</span>
              <span className="r-mono" style={{ fontSize: 10, color: 'var(--r-ink-mute)' }}>{m.age}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--r-ink)', lineHeight: 1.35, marginLeft: 13 }}>{m.subject}</div>
          </div>
        );
      })}
    </div>
  </div>
);

const MobileMore = () => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <MobileNav eyebrow="MORE" title="Rooms of Imladris"/>
    <div className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 120px' }}>
      {ROOMS_M.filter(r => !['/', '/tidings', '/council', '/ravens'].includes(r.key)).map(r => (
        <div key={r.key} className="r-card" style={{
          padding: '14px 16px', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <RoomGlyphM kind={r.icon} color="#d4af63" size={20}/>
          <div style={{ flex: 1 }}>
            <div className="r-display" style={{ fontSize: 16, color: 'var(--r-star)' }}>{r.name}</div>
            <div style={{ fontSize: 11, color: 'var(--r-ink-mute)', marginTop: 2 }}>{r.sub}</div>
          </div>
          <span style={{ color: 'var(--r-ink-faint)' }}>›</span>
        </div>
      ))}
    </div>
  </div>
);

window.MobileShell = MobileShell;
