/* global React, Ornaments, AppShell */
const { Evenstar: EvR, KnotDivider: KnotR, Corner: CornerR, Signet: SignR, TengwarLine: TengR, IlluminatedCapital: ICapR, ElvenLeaf: LeafR } = Ornaments;
const MOCK_R = AppShell.MOCK;

// =============== Shared header ===============
const RoomHeader = ({ room, eyebrow, title, subtitle, right }) => (
  <div style={{
    padding: '28px 36px 18px',
    borderBottom: '1px solid var(--r-line)',
    position: 'relative',
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
      <div>
        <div className="r-eyebrow-gold">{eyebrow}</div>
        <div className="r-display" style={{ fontSize: 36, color: 'var(--r-star)', lineHeight: 1, marginTop: 6, letterSpacing: '-0.01em' }}>
          {title}
        </div>
        {subtitle && (
          <div className="r-display-i" style={{ fontSize: 15, color: 'var(--r-ink-mute)', marginTop: 8 }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  </div>
);

// =============== Tidings (morning brief) ===============
const TidingsView = () => {
  const tasksUrgent = MOCK_R.tasks.filter(t => t.due === 'today' || t.overdue);
  return (
    <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
      <RoomHeader
        eyebrow="The Tidings · April 30, 2026"
        title="Whilst you slept, the world has turned."
        subtitle={`${MOCK_R.greeting()}, Matt. There are six matters and three drafts awaiting your eye.`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="r-btn r-btn-ghost">read aloud</button>
            <button className="r-btn r-btn-elf">brief by voice</button>
          </div>
        }
      />

      <div style={{ padding: '26px 36px 40px', maxWidth: 1100 }}>
        {/* Lead — illuminated brief */}
        <div className="r-illuminated" style={{ padding: '22px 28px', position: 'relative' }}>
          <CornerR position="tl"/><CornerR position="tr"/><CornerR position="bl"/><CornerR position="br"/>
          <div style={{ display: 'flex', gap: 22 }}>
            <ICapR letter="W" size={92}/>
            <div className="r-dropcap" style={{ flex: 1, fontSize: 15.5, lineHeight: 1.7, color: 'var(--r-ink)' }}>
              hilst you were away, three Stripe payments cleared and I closed the corresponding tasks; I
              sorted fourteen newsletters into Reading; and the EliteTeam Q2 partnership memo arrived from
              Legal — I have prepared a redline for your morning. Kim Garst replied late last night about
              the funnel; my draft response sits in your inbox. The 13:00 calendar collision remains open,
              awaiting your call. — <span style={{ color: 'var(--r-gold)', fontStyle: 'italic' }}>Elrond</span>
            </div>
          </div>
        </div>

        <div className="r-divider-knot" style={{ margin: '32px 0' }}/>

        {/* Three columns: Today / Drafts / Watching */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
          <Section title="What demands you" eyebrow="Today">
            {tasksUrgent.map(t => (
              <Row key={t.id}
                left={<span className="r-pulse-dot" style={{ background: t.overdue ? 'var(--r-rose)' : 'var(--r-amber)' }}/>}
                title={t.title}
                meta={<><span className="r-chip">{t.project}</span> <span style={{ color: t.overdue ? 'var(--r-rose)' : 'var(--r-amber)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em' }}>{t.overdue ? 'OVERDUE' : 'DUE TODAY'}</span></>}
              />
            ))}
          </Section>

          <Section title="Drafts to read" eyebrow="Awaiting your eye">
            <Row title="Reply to Kim Garst — funnel V3"
              meta={<><span className="r-chip-elf">email</span><span style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>3min read</span></>}
              cta="Open" />
            <Row title="EliteTeam Q2 memo — redline"
              meta={<><span className="r-chip-elf">document</span><span style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>8min read</span></>}
              cta="Open" />
            <Row title="Calendar move — 13:00 conflict"
              meta={<><span className="r-chip-elf">calendar</span><span style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>1 decision</span></>}
              cta="Decide" />
          </Section>

          <Section title="What I am watching" eyebrow="Background">
            <Row title="Threefold programming export"
              meta={<span style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', fontStyle: 'italic' }}>arriving — usually by 9am</span>} />
            <Row title="Stripe — Kim's Q2 invoice"
              meta={<span style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', fontStyle: 'italic' }}>pending · sent 4d ago</span>} />
            <Row title="Domain renewal — mattjohnston.io"
              meta={<span style={{ fontSize: 11.5, color: 'var(--r-rose)' }}>auto-renew failed · my action awaits yours</span>} />
          </Section>
        </div>

        <div className="r-divider-knot" style={{ margin: '32px 0' }}/>

        {/* Day at a glance */}
        <div className="r-display" style={{ fontSize: 22, color: 'var(--r-star)', marginBottom: 14 }}>The day in eight chimes</div>
        <div style={{
          background: 'var(--r-bg-card)',
          border: '1px solid var(--r-line)',
          borderRadius: 14,
          padding: 18,
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0,
          position: 'relative',
        }}>
          {Array.from({ length: 8 }, (_, i) => {
            const hour = 7 + i * 2;
            const event = MOCK_R.events.find(e => parseInt(e.time) >= hour && parseInt(e.time) < hour + 2);
            return (
              <div key={i} style={{
                borderRight: i < 7 ? '1px dashed var(--r-line)' : 'none',
                padding: '4px 8px',
                minHeight: 80,
              }}>
                <div className="r-mono" style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>{hour}:00</div>
                {event && (
                  <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(106,163,255,0.1)', border: '1px solid rgba(106,163,255,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--r-elf-glow)', fontWeight: 500 }}>{event.title}</div>
                    <div className="r-mono" style={{ fontSize: 10, color: 'var(--r-ink-mute)', marginTop: 2 }}>{event.time} · {event.dur}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Section = ({ eyebrow, title, children }) => (
  <div className="r-card" style={{ padding: 18, position: 'relative' }}>
    <div className="r-eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>
    <div className="r-display" style={{ fontSize: 18, color: 'var(--r-star)', marginBottom: 14 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
  </div>
);

const Row = ({ left, title, meta, cta }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 12px',
    background: 'var(--r-bg-deep)',
    border: '1px solid var(--r-line)',
    borderRadius: 8,
  }}>
    {left && <div style={{ marginTop: 4 }}>{left}</div>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, color: 'var(--r-ink)', lineHeight: 1.4 }}>{title}</div>
      {meta && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>{meta}</div>}
    </div>
    {cta && <button className="r-btn r-btn-ghost" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>{cta}</button>}
  </div>
);

// =============== Council (tasks) ===============
const PROJECT_COLORS_R = {
  'KG-KimGarst': '#c46a85', 'YPP': '#d4af63', 'EliteTeam': '#6aa3ff',
  'Personal': '#a48fd0', 'CrossFitThreefold': '#6dbf9e', 'mjio': '#5fb8d4',
};

const CouncilView = () => (
  <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
    <RoomHeader
      eyebrow="The Council"
      title="Tasks &amp; decisions"
      subtitle="Twenty-three open. Three for the morrow. One overdue."
      right={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="r-btn r-btn-ghost">filter</button>
          <button className="r-btn r-btn-gold">+ new task</button>
        </div>
      }
    />
    <div style={{ padding: '24px 36px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
      {[
        { title: 'In Hand', count: 5, items: MOCK_R.tasks },
        { title: 'On the Horizon', count: 11, items: MOCK_R.tasks.slice(2) },
        { title: 'In Council\'s Care', count: 7, items: MOCK_R.tasks.slice(0,3), elrond: true },
      ].map(col => (
        <div key={col.title} className="r-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span className="r-display" style={{ fontSize: 17, color: 'var(--r-star)' }}>{col.title}</span>
            <span className="r-mono" style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>{col.count}</span>
          </div>
          {col.elrond && (
            <div style={{ padding: '8px 10px', marginBottom: 10, fontSize: 11.5, color: 'var(--r-elf-glow)', background: 'rgba(106,163,255,0.06)', border: '1px dashed rgba(106,163,255,0.3)', borderRadius: 6, fontStyle: 'italic' }}>
              Elrond is handling these autonomously. He will surface what needs you.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col.items.map(t => (
              <div key={t.id} style={{
                padding: '10px 12px',
                background: 'var(--r-bg-deep)',
                border: '1px solid var(--r-line)',
                borderRadius: 8,
                borderLeft: `3px solid ${PROJECT_COLORS_R[t.project] || 'var(--r-ink-mute)'}`,
              }}>
                <div style={{ fontSize: 13.5, color: 'var(--r-ink)' }}>{t.title}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5 }}>
                  <span className="r-chip" style={{ background: `${PROJECT_COLORS_R[t.project]}18`, borderColor: `${PROJECT_COLORS_R[t.project]}40`, color: PROJECT_COLORS_R[t.project] }}>{t.project}</span>
                  <span style={{ fontSize: 10.5, color: t.overdue ? 'var(--r-rose)' : 'var(--r-ink-mute)', fontWeight: t.overdue ? 600 : 400, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {t.overdue ? 'overdue' : `due ${t.due}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// =============== Reckoning (calendar) ===============
const ReckoningView = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
      <RoomHeader
        eyebrow="The Reckoning"
        title="Week of the 27th"
        subtitle="Eighteen events · two collisions · one travel day"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="r-btn r-btn-ghost">‹</button>
            <button className="r-btn r-btn-ghost">today</button>
            <button className="r-btn r-btn-ghost">›</button>
          </div>
        }
      />
      <div style={{ padding: '24px 36px' }}>
        <div style={{
          background: 'var(--r-bg-card)', border: '1px solid var(--r-line)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid var(--r-line-gold)' }}>
            <div></div>
            {days.map((d, i) => (
              <div key={d} style={{
                padding: '12px 10px', textAlign: 'center',
                borderLeft: '1px solid var(--r-line)',
                background: i === 2 ? 'rgba(212,175,99,0.06)' : 'transparent',
              }}>
                <div className="r-eyebrow" style={{ fontSize: 10 }}>{d}</div>
                <div className="r-display" style={{ fontSize: 22, color: i === 2 ? 'var(--r-gold)' : 'var(--r-ink)', marginTop: 2 }}>{27 + i > 30 ? (27+i-30) : 27+i}</div>
              </div>
            ))}
          </div>
          {/* Time grid */}
          {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(hr => (
            <div key={hr} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', minHeight: 56, borderBottom: '1px dashed var(--r-line)' }}>
              <div className="r-mono" style={{ padding: '6px 10px', fontSize: 11, color: 'var(--r-ink-faint)', textAlign: 'right' }}>{hr % 12 || 12}{hr >= 12 ? 'p' : 'a'}</div>
              {days.map((d, i) => {
                const event = i === 2 && MOCK_R.events.find(e => parseInt(e.time) === hr);
                const calColors = { work: '#6aa3ff', personal: '#6dbf9e', family: '#d99e57' };
                return (
                  <div key={i} style={{
                    borderLeft: '1px solid var(--r-line)',
                    background: i === 2 ? 'rgba(212,175,99,0.02)' : 'transparent',
                    padding: 4, position: 'relative',
                  }}>
                    {event && (
                      <div style={{
                        background: `${calColors[event.cal]}22`,
                        borderLeft: `2px solid ${calColors[event.cal]}`,
                        padding: '5px 7px', borderRadius: 4, fontSize: 11,
                        color: 'var(--r-ink)', height: 'calc(100% - 4px)',
                      }}>
                        <div style={{ fontWeight: 500 }}>{event.title}</div>
                        <div className="r-mono" style={{ fontSize: 10, color: 'var(--r-ink-mute)', marginTop: 1 }}>{event.time} · {event.dur}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// =============== Ravens (email) ===============
const RAVEN_ACCOUNTS = [
  { email: 'matt@mattjohnston.io',         color: '#a48fd0', count: 8,  label: 'Personal' },
  { email: 'mjohnst@gmail.com',            color: '#c46a85', count: 23, label: 'Gmail' },
  { email: 'matt@eliteteam.ai',            color: '#6aa3ff', count: 14, label: 'EliteTeam' },
  { email: 'coachmatt@threefoldfit.com',   color: '#6dbf9e', count: 5,  label: 'Threefold' },
  { email: 'matt@r-link.com',              color: '#d99e57', count: 3,  label: 'R-Link' },
  { email: 'matt@your-profit-partners.com',color: '#d4af63', count: 12, label: 'YPP' },
];

const RavensView = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%', minHeight: 0 }}>
    {/* Account rail */}
    <div style={{ borderRight: '1px solid var(--r-line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }} className="r-scroll">
      <div className="r-eyebrow-gold">Ravenry</div>
      <div className="r-display" style={{ fontSize: 22, color: 'var(--r-star)', lineHeight: 1.1 }}>Six realms<br/>kept</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {RAVEN_ACCOUNTS.map(a => (
          <button key={a.email} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', background: 'transparent',
            border: '1px solid var(--r-line)', borderRadius: 8,
            color: 'var(--r-ink-soft)', cursor: 'pointer',
            textAlign: 'left',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.color, boxShadow: `0 0 6px ${a.color}` }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--r-ink)' }}>{a.label}</div>
              <div style={{ fontSize: 10, color: 'var(--r-ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email}</div>
            </div>
            <span className="r-mono" style={{ fontSize: 10.5, color: a.color }}>{a.count}</span>
          </button>
        ))}
      </div>
      <div className="r-divider-knot" style={{ margin: '8px 0' }}/>
      <div style={{ padding: 12, background: 'rgba(106,163,255,0.05)', border: '1px solid rgba(106,163,255,0.2)', borderRadius: 8 }}>
        <div className="r-eyebrow" style={{ color: 'var(--r-elf-glow)' }}>Elrond's care</div>
        <div style={{ fontSize: 12, color: 'var(--r-ink-soft)', marginTop: 6, lineHeight: 1.5 }}>
          14 newsletters sorted to Reading. 2 invoices flagged. 1 draft awaiting your read.
        </div>
      </div>
    </div>

    <div className="r-scroll" style={{ overflow: 'auto', padding: '24px 36px' }}>
      <RoomHeader
        eyebrow="The Ravens"
        title="65 messages, 6 realms"
        subtitle="Three need you. The rest, I have shaped or shelved."
      />
      <div style={{ padding: 0, marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...MOCK_R.emails, ...MOCK_R.emails, ...MOCK_R.emails.slice(0,2)].map((m, i) => {
          const acct = RAVEN_ACCOUNTS.find(a => a.email === m.acct) || RAVEN_ACCOUNTS[0];
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 16px',
              background: m.unread ? 'rgba(212,175,99,0.04)' : 'var(--r-bg-deep)',
              border: '1px solid var(--r-line)',
              borderLeft: `3px solid ${acct.color}`,
              borderRadius: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.unread ? 'var(--r-gold)' : 'transparent', flexShrink: 0 }}/>
              <div style={{ minWidth: 140, fontSize: 13, color: m.unread ? 'var(--r-star)' : 'var(--r-ink-soft)', fontWeight: m.unread ? 500 : 400 }}>{m.from}</div>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--r-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</div>
              <span className="r-chip" style={{ borderColor: acct.color + '40', color: acct.color, background: acct.color + '12' }}>{acct.label}</span>
              <span className="r-mono" style={{ fontSize: 11, color: 'var(--r-ink-mute)', minWidth: 40, textAlign: 'right' }}>{m.age}</span>
            </div>
          );
        })}
      </div>
    </div>
  </div>
);

// =============== Hearth (family) ===============
const HearthView = () => (
  <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
    <RoomHeader
      eyebrow="The Hearth"
      title="Family &amp; home"
      subtitle="Where the smallest matters are kept."
    />
    <div style={{ padding: '24px 36px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
      <div>
        <div className="r-display" style={{ fontSize: 19, color: 'var(--r-star)', marginBottom: 14 }}>Today's keep</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MOCK_R.family.map(t => (
            <div key={t.id} className="r-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid var(--r-line-strong)` }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: 'var(--r-ink)' }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', marginTop: 3 }}>{t.who}</div>
              </div>
              <span className="r-chip" style={{
                color: t.priority === 'high' ? 'var(--r-rose)' : 'var(--r-amber)',
                borderColor: t.priority === 'high' ? 'rgba(196,106,133,0.3)' : 'rgba(217,158,87,0.3)',
                background: t.priority === 'high' ? 'rgba(196,106,133,0.1)' : 'rgba(217,158,87,0.1)',
              }}>{t.priority}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="r-card" style={{ padding: 18 }}>
        <div className="r-eyebrow-gold">Hearthstone</div>
        <div className="r-display" style={{ fontSize: 17, color: 'var(--r-star)', marginTop: 6 }}>Em's school week</div>
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--r-ink-soft)', lineHeight: 1.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Mon</span><span>library day · book bag</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tue</span><span>soccer · 5:30 pickup</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Wed</span><span>spelling test · words sent</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Fri</span><span>pizza day · $5 cash</span></div>
        </div>
      </div>
    </div>
  </div>
);

// =============== Annals, Library, Weavings, Forge — lighter ===============
const SimpleListView = ({ eyebrow, title, subtitle, items }) => (
  <div className="r-scroll" style={{ height: '100%', overflowY: 'auto' }}>
    <RoomHeader eyebrow={eyebrow} title={title} subtitle={subtitle}/>
    <div style={{ padding: '24px 36px', maxWidth: 900 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} className="r-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: 'var(--r-display)', fontStyle: 'italic', fontSize: 18, color: 'var(--r-gold)', minWidth: 28 }}>{it.glyph || '·'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: 'var(--r-ink)' }}>{it.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', marginTop: 3 }}>{it.meta}</div>
            </div>
            {it.right && <span className="r-mono" style={{ fontSize: 11, color: 'var(--r-ink-mute)' }}>{it.right}</span>}
          </div>
        ))}
      </div>
    </div>
  </div>
);

const AnnalsView = () => (
  <SimpleListView eyebrow="The Annals" title="Past councils" subtitle="Every conversation, kept."
    items={[
      { glyph: 'I', title: 'Q2 partnership memo — first read', meta: 'Today · 47 messages · Claude Code', right: '2 hr ago' },
      { glyph: 'II', title: 'Programming framework v3 design', meta: 'Yesterday · 91 messages · Codex CLI', right: '1 day' },
      { glyph: 'III', title: 'Family calendar audit', meta: 'Mon · 23 messages', right: '4 days' },
      { glyph: 'IV', title: 'YPP funnel V3 review', meta: 'Sun · 18 messages', right: '5 days' },
      { glyph: 'V', title: 'Annual review draft — first pass', meta: 'last week · 134 messages', right: '7 days' },
    ]}/>
);

const LibraryView = () => (
  <SimpleListView eyebrow="The Library" title="Documents &amp; notes" subtitle="Everything written, indexed and recallable."
    items={[
      { glyph: '§', title: 'Annual review draft', meta: 'doc · 8 pages · last edit yesterday', right: 'pinned' },
      { glyph: '§', title: 'Programming framework v3', meta: 'doc · 14 pages · last edit Mon', right: 'pinned' },
      { glyph: '§', title: 'YPP Q2 retro research', meta: 'note · 4 datapoints · written by Elrond', right: 'today' },
      { glyph: '§', title: 'EliteTeam memo redline', meta: 'doc · 12 pages · awaits your eye', right: 'today' },
      { glyph: '§', title: 'Personal OS — values', meta: 'note · 1 page', right: '3 weeks' },
    ]}/>
);

const WeavingsView = () => (
  <SimpleListView eyebrow="The Weavings" title="Cron &amp; automations" subtitle="Threads Elrond holds without your asking."
    items={[
      { glyph: '⌖', title: 'Sort newsletters → Reading queue', meta: 'every morning at 7:00 · last ran 7:42 AM', right: '✓ active' },
      { glyph: '⌖', title: 'Close tasks on Stripe payment', meta: 'on event · stripe.invoice.paid', right: '✓ active' },
      { glyph: '⌖', title: 'Draft Kim weekly digest', meta: 'Fridays at 4pm', right: '✓ active' },
      { glyph: '⌖', title: 'Family calendar sync', meta: 'every 15 minutes', right: '✓ active' },
      { glyph: '⌖', title: 'Domain renewal watch', meta: '60 days before expiry', right: '⚠ 1 issue' },
    ]}/>
);

const ForgeView = () => (
  <SimpleListView eyebrow="The Forge" title="Settings &amp; connections" subtitle="The bones beneath."
    items={[
      { glyph: '⚙', title: 'Connections — Gmail, GCal, Stripe, Notion, GitHub, Slack, Tailscale', meta: '7 connected · all healthy', right: 'manage' },
      { glyph: '⚙', title: 'Tools — 47 enabled', meta: 'Elrond may use these without asking', right: 'audit' },
      { glyph: '⚙', title: 'Voice — push-to-talk', meta: 'Gemini live · ⌥-space', right: 'edit' },
      { glyph: '⚙', title: 'Models — Claude Code (default), Codex CLI', meta: 'fallback · Sonnet 4.5', right: 'edit' },
      { glyph: '⚙', title: 'Identity — ts-mac-mini · 100.124.7.42', meta: 'Tailscale tailnet · matt.tail-scale.ts.net', right: 'verify' },
      { glyph: '⚙', title: 'Sleep schedule', meta: 'Elrond rests 11pm–6am · except urgent', right: 'edit' },
    ]}/>
);

// =============== Pins ===============
const PinsView = () => (
  <SimpleListView eyebrow="Pinned" title="Held close" subtitle="The few things you keep returning to."
    items={MOCK_R.pinned.map((p, i) => ({ glyph: ['α', 'β', 'γ', 'δ'][i] || '·', title: p.title, meta: p.kind, right: 'open' }))}/>
);

window.RoomViews = { TidingsView, CouncilView, ReckoningView, RavensView, HearthView, AnnalsView, LibraryView, WeavingsView, ForgeView, PinsView };
