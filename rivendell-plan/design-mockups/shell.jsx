/* global React, Ornaments */
const { useState, useEffect, useRef, useMemo } = React;
const { Evenstar, ElvenLeaf, KnotDivider, Corner, Ring, Signet, TengwarLine, StarField, IlluminatedCapital } = Ornaments;

// =================================================================
// Mock data — for prototype
// =================================================================
const MOCK = {
  user: { name: 'Matt' },
  assistant: { name: 'Elrond', title: 'Lord of Imladris' },
  greeting: () => {
    const h = new Date().getHours();
    if (h < 5) return 'In the small hours';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Late tidings';
  },
  tasks: [
    { id: 1, title: 'Sign Q2 partnership memo for EliteTeam', project: 'EliteTeam', due: 'today', overdue: false, priority: 'high' },
    { id: 2, title: 'Review Kim\'s funnel copy revision', project: 'KG-KimGarst', due: 'today', overdue: false, priority: 'high' },
    { id: 3, title: 'Renew domain — mattjohnston.io', project: 'Personal', due: 'overdue', overdue: true, priority: 'high' },
    { id: 4, title: 'Programming block: Wed AM CrossFit', project: 'CrossFitThreefold', due: 'tomorrow', overdue: false, priority: 'med' },
    { id: 5, title: 'Draft YPP Q2 retro deck', project: 'YPP', due: 'Fri', overdue: false, priority: 'med' },
  ],
  events: [
    { id: 1, title: 'Standup — EliteTeam', time: '9:00', dur: '30m', cal: 'work', loc: 'Zoom' },
    { id: 2, title: 'Coaching: Sarah K.', time: '10:30', dur: '45m', cal: 'work' },
    { id: 3, title: '1:1 with Coach Matt', time: '13:00', dur: '60m', cal: 'personal', loc: 'Threefold' },
    { id: 4, title: 'Family dinner', time: '18:30', dur: '90m', cal: 'family', loc: 'Home' },
  ],
  emails: [
    { id: 1, from: 'Kim Garst', subject: 'Re: Funnel V3 — small change', acct: 'matt@your-profit-partners.com', age: '14m', unread: true },
    { id: 2, from: 'Stripe', subject: 'Receipt for $2,940.00', acct: 'matt@eliteteam.ai', age: '1h', unread: false },
    { id: 3, from: 'Jess', subject: 'school pickup tomorrow?', acct: 'mjohnst@gmail.com', age: '2h', unread: true },
    { id: 4, from: 'Anthropic', subject: 'Your monthly invoice', acct: 'matt@mattjohnston.io', age: '3h', unread: false },
  ],
  family: [
    { id: 1, title: 'Pick up Em from soccer (5:30)', who: 'Matt', priority: 'high' },
    { id: 2, title: 'Order birthday cake for Saturday', who: 'Jess', priority: 'med' },
    { id: 3, title: 'School forms — sign + scan', who: 'Both', priority: 'high' },
  ],
  scribeLog: [
    { id: 1, t: '7:42 AM', kind: 'email', text: 'Sorted 14 newsletters into Reading queue. Flagged 2 invoices for review.', tools: ['gmail.list', 'gmail.label'] },
    { id: 2, t: '7:48 AM', kind: 'calendar', text: 'Detected conflict at 13:00 — moved EliteTeam standup proposal to 14:00 (draft only, awaiting your nod).', tools: ['gcal.read', 'gcal.draft'] },
    { id: 3, t: '8:03 AM', kind: 'task', text: 'Closed 3 tasks Stripe-confirmed as paid: KG-Q1 invoice, EliteTeam retainer, mjio hosting.', tools: ['stripe.list', 'tasks.close'] },
    { id: 4, t: '8:14 AM', kind: 'note', text: 'Drafted reply to Kim about funnel V3 — saved as draft. You\'ll want to read it before sending.', tools: ['gmail.draft'] },
    { id: 5, t: '8:21 AM', kind: 'web', text: 'Researched competitor pricing for YPP retro deck. 4 datapoints in /docs/ypp-q2-research.md.', tools: ['web.search', 'fs.write'] },
    { id: 6, t: 'now', kind: 'thinking', text: 'Watching for the Threefold programming export to land...', tools: [], live: true },
  ],
  pinned: [
    { id: 1, title: 'Annual review draft', kind: 'doc' },
    { id: 2, title: 'Kim — Q2 plan', kind: 'thread' },
    { id: 3, title: 'Programming framework v3', kind: 'doc' },
  ],
  weather: { temp: 58, condition: 'Clear', sunset: '8:14 PM' },
};

// =================================================================
// Sidebar — "rooms of Rivendell"
// =================================================================
const ROOMS = [
  { key: '/',          name: 'Hall',       sub: 'Council with Elrond',     icon: 'hall' },
  { key: '/tidings',   name: 'Tidings',    sub: 'Today\'s morning brief',  icon: 'tidings' },
  { key: '/scribe',    name: 'Scribe',     sub: 'Log of his work',         icon: 'scribe' },
  { key: '/council',   name: 'Council',    sub: 'Tasks & decisions',       icon: 'council' },
  { key: '/reckoning', name: 'Reckoning',  sub: 'Calendar',                icon: 'reckoning' },
  { key: '/ravens',    name: 'Ravens',     sub: 'Email across realms',     icon: 'ravens' },
  { key: '/hearth',    name: 'Hearth',     sub: 'Family & home',           icon: 'hearth' },
  { key: '/library',   name: 'Library',    sub: 'Documents & notes',       icon: 'library' },
  { key: '/annals',    name: 'Annals',     sub: 'Past sessions',           icon: 'annals' },
  { key: '/weavings',  name: 'Weavings',   sub: 'Cron & automations',      icon: 'weavings' },
  { key: '/forge',     name: 'Forge',      sub: 'Settings & connections',  icon: 'forge' },
];

const RoomGlyph = ({ kind, color = 'currentColor', size = 18 }) => {
  const s = size, c = color;
  switch (kind) {
    case 'hall':      return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M4 20 V10 L12 4 L20 10 V20 M9 20 V14 H15 V20 M4 20 H20"/></svg>;
    case 'tidings':   return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><circle cx="12" cy="12" r="4"/><path d="M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6"/></svg>;
    case 'scribe':    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M5 4 H15 L19 8 V20 H5 Z M15 4 V8 H19 M8 12 H16 M8 15 H16 M8 18 H13"/></svg>;
    case 'council':   return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><circle cx="12" cy="13" r="6"/><circle cx="6" cy="9" r="1.6"/><circle cx="18" cy="9" r="1.6"/><circle cx="9" cy="20" r="1.6"/><circle cx="15" cy="20" r="1.6"/><circle cx="12" cy="5" r="1.6"/></svg>;
    case 'reckoning': return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><rect x="4" y="6" width="16" height="14" rx="1"/><path d="M4 10 H20 M8 4 V8 M16 4 V8"/><circle cx="12" cy="14" r="0.8" fill={c}/></svg>;
    case 'ravens':    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M3 9 Q3 6 6 6 H18 Q21 6 21 9 V15 Q21 18 18 18 H6 Q3 18 3 15 Z M3 9 L12 14 L21 9"/></svg>;
    case 'hearth':    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M4 20 V11 L12 5 L20 11 V20 H4 M9 20 V15 H15 V20 M11 11 Q12 13 13 11"/></svg>;
    case 'library':   return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M5 4 H10 V20 H5 Z M10 4 H15 V20 H10 Z M15 6 L19 5 L21 19 L17 20 Z"/></svg>;
    case 'annals':    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L15 14"/></svg>;
    case 'weavings':  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><circle cx="12" cy="12" r="3"/><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22 M5 5 L8 8 M16 16 L19 19 M5 19 L8 16 M16 8 L19 5"/></svg>;
    case 'forge':     return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.2"><path d="M8 4 L4 8 L8 12 M16 4 L20 8 L16 12 M12 4 V20 M5 20 H19"/></svg>;
    default: return null;
  }
};

const Sidebar = ({ active, setActive, collapsed, setCollapsed }) => (
  <aside style={{
    width: collapsed ? 76 : 248,
    flexShrink: 0,
    transition: 'width 0.24s ease',
    borderRight: '1px solid var(--r-line)',
    background: 'linear-gradient(180deg, var(--r-sidebar-grad-1), var(--r-sidebar-grad-2))',
    backdropFilter: 'blur(8px)',
    display: 'flex', flexDirection: 'column',
    position: 'relative',
    zIndex: 10,
  }}>
    {/* Brand */}
    <div style={{
      height: 76, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px',
      borderBottom: '1px solid var(--r-line)',
      position: 'relative',
    }}>
      <div style={{ position: 'relative' }}>
        <Evenstar size={28} color="#d4af63" glow/>
      </div>
      {!collapsed && (
        <div>
          <div style={{ fontFamily: 'var(--r-display)', fontSize: 22, lineHeight: 1, color: 'var(--r-star)', letterSpacing: '0.02em' }}>
            Rivendell
          </div>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--r-ink-mute)', marginTop: 4 }}>
            Imladris · v3.0
          </div>
        </div>
      )}
    </div>

    {/* Status */}
    <div style={{
      padding: collapsed ? '12px 0' : '12px 18px',
      borderBottom: '1px solid var(--r-line)',
      display: 'flex', alignItems: 'center', gap: 10,
      justifyContent: collapsed ? 'center' : 'flex-start',
    }}>
      <span className="r-pulse-dot green"/>
      {!collapsed && (
        <div style={{ display: 'flex', justifyContent: 'space-between', flex: 1, fontSize: 11.5 }}>
          <span style={{ color: 'var(--r-ink-soft)' }}>Elrond is awake</span>
          <span className="r-mono" style={{ color: 'var(--r-ink-mute)' }}>47 tools</span>
        </div>
      )}
    </div>

    {/* Nav */}
    <nav className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 10px' }}>
      {ROOMS.map(room => {
        const isActive = active === room.key;
        return (
          <button
            key={room.key}
            onClick={() => setActive(room.key)}
            title={collapsed ? room.name : undefined}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: 12,
              padding: collapsed ? '10px 0' : '9px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              background: isActive
                ? 'linear-gradient(90deg, rgba(212,175,99,0.12), rgba(212,175,99,0.04) 70%, transparent)'
                : 'transparent',
              border: 'none',
              borderLeft: isActive ? '2px solid var(--r-gold)' : '2px solid transparent',
              borderRadius: isActive ? '0 8px 8px 0' : 8,
              color: isActive ? 'var(--r-star)' : 'var(--r-ink-soft)',
              fontFamily: 'var(--r-body)',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.14s ease',
              marginBottom: 2,
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(196,213,247,0.04)'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
          >
            <RoomGlyph kind={room.icon} color={isActive ? '#d4af63' : 'var(--r-ink-mute)'} size={17}/>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--r-display)', fontSize: 16, fontWeight: 500, lineHeight: 1.1, color: isActive ? 'var(--r-star)' : 'var(--r-ink)' }}>
                  {room.name}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--r-ink-mute)', marginTop: 2, letterSpacing: '0.02em' }}>
                  {room.sub}
                </div>
              </div>
            )}
          </button>
        );
      })}
    </nav>

    {/* Footer */}
    <div style={{
      padding: collapsed ? '12px 0' : '14px 18px',
      borderTop: '1px solid var(--r-line)',
      display: 'flex', flexDirection: 'column', gap: 8,
      alignItems: collapsed ? 'center' : 'stretch',
    }}>
      {!collapsed && (
        <div style={{ fontFamily: 'var(--r-display)', fontStyle: 'italic', fontSize: 12.5, color: 'var(--r-ink-mute)', textAlign: 'center', padding: '6px 0' }}>
          "The road goes ever on."
        </div>
      )}
      <button onClick={() => setCollapsed(c => !c)} style={{
        background: 'transparent', border: '1px solid var(--r-line)',
        color: 'var(--r-ink-mute)', padding: '6px 8px', borderRadius: 6,
        cursor: 'pointer', fontSize: 11,
      }}>{collapsed ? '›' : '‹  Fold'}</button>
    </div>
  </aside>
);

window.AppShell = { Sidebar, ROOMS, RoomGlyph, MOCK };
