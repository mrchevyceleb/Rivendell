/* global React, Ornaments, AppShell */
const { useState: useStateChat, useEffect: useEffectChat, useRef: useRefChat, useMemo: useMemoChat } = React;
const { Evenstar: EvChat, KnotDivider: KnotChat, Corner: CornerChat, Ring: RingChat, Signet: SignetChat, TengwarLine: TengChat, StarField: StarChat, IlluminatedCapital: ICapChat } = Ornaments;
const MOCK_C = AppShell.MOCK;

// =================================================================
// Hall — main chat experience with Elrond
// Center: conversation. Right: Scribe's log. Top: agent toggle + tools status.
// =================================================================

const AGENTS = [
  { key: 'claude', name: 'Claude Code', desc: 'sonnet · 200k', color: '#d4af63' },
  { key: 'codex',  name: 'Codex CLI',   desc: 'gpt-5 · 256k', color: '#6aa3ff' },
];

const SAMPLE_THREAD = [
  { role: 'user', t: '7:24 AM', content: 'morning. catch me up.' },
  { role: 'assistant', t: '7:24 AM', content: 'Good morning, Matt. While you slept I closed three tasks Stripe confirmed paid, sorted fourteen newsletters into the Reading queue, and drafted a reply to Kim about the funnel revision — it needs your eyes before it goes out. There is one thing for your attention: the EliteTeam standup at 9 collides with a Threefold dial-in I did not move. I left both in your calendar with a flag.', tools: ['stripe.list', 'gmail.draft', 'gcal.read'] },
  { role: 'user', t: '7:26 AM', content: 'show me kim\'s draft' },
  { role: 'assistant', t: '7:26 AM', content: '', toolBlock: { name: 'gmail.draft.read', args: { thread: 'Re: Funnel V3 — small change' }, status: 'ok', preview: 'Kim — happy to make the change. Two thoughts before we ship: (1) the headline test is still inconclusive at 1,400 visits; I\'d give it through Friday. (2) The opt-in copy reads stronger if we move "free" to the second line. I\'ll have V3.1 in your inbox tonight. — Matt' } },
  { role: 'assistant', t: '7:26 AM', content: 'Read it twice. The "give it through Friday" line is yours to nuance — Kim moves fast and might push back. Want me to soften it, or send as-is?' },
];

const ToolPill = ({ name }) => (
  <span style={{
    fontFamily: 'var(--r-mono)', fontSize: 10.5,
    padding: '2px 7px', borderRadius: 4,
    background: 'rgba(106,163,255,0.08)',
    border: '1px solid rgba(106,163,255,0.2)',
    color: 'var(--r-elf-glow)',
  }}>{name}</span>
);

const ToolBlock = ({ block }) => (
  <div style={{
    background: 'var(--r-bg-deep)',
    border: '1px solid var(--r-line)',
    borderRadius: 10,
    padding: '10px 14px',
    margin: '8px 0',
    fontFamily: 'var(--r-mono)',
    fontSize: 12,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--r-gold)', letterSpacing: '0.06em' }}>⌖</span>
        <span style={{ color: 'var(--r-elf-glow)' }}>{block.name}</span>
        <span style={{ color: 'var(--r-ink-faint)' }}>·</span>
        <span style={{ color: 'var(--r-ink-mute)', fontSize: 11 }}>{block.status === 'ok' ? 'returned' : block.status}</span>
      </div>
      <span style={{ color: 'var(--r-emerald)', fontSize: 11 }}>✓</span>
    </div>
    {block.preview && (
      <div style={{
        fontFamily: 'var(--r-body)',
        fontSize: 12.5,
        color: 'var(--r-ink-soft)',
        lineHeight: 1.55,
        padding: '6px 0 0 0',
        borderTop: '1px dashed var(--r-line)',
        marginTop: 6,
        whiteSpace: 'pre-wrap',
      }}>{block.preview}</div>
    )}
  </div>
);

const Message = ({ m, agentColor }) => {
  if (m.role === 'user') {
    return (
      <div className="r-fade-in" style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'rgba(196,213,247,0.06)',
          border: '1px solid var(--r-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--r-display)', fontSize: 14, color: 'var(--r-ink-soft)',
          flexShrink: 0,
        }}>M</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 500, color: 'var(--r-ink)' }}>Matt</span>
            <span style={{ fontSize: 11, color: 'var(--r-ink-faint)' }}>{m.t}</span>
          </div>
          <div style={{ color: 'var(--r-ink)', fontSize: 14.5 }}>{m.content}</div>
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="r-fade-in" style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <div style={{ flexShrink: 0 }}>
        <SignetChat size={30} color={agentColor}>
          <EvChat size={16} color={agentColor}/>
        </SignetChat>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span className="r-display-i" style={{ fontWeight: 500, color: agentColor, fontSize: 16 }}>Elrond</span>
          <span style={{ fontSize: 11, color: 'var(--r-ink-faint)' }}>{m.t}</span>
        </div>
        {m.toolBlock && <ToolBlock block={m.toolBlock}/>}
        {m.content && (
          <div style={{ color: 'var(--r-ink)', fontSize: 14.5, lineHeight: 1.65 }}>
            {m.content}
          </div>
        )}
        {m.tools && m.tools.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {m.tools.map(t => <ToolPill key={t} name={t}/>)}
          </div>
        )}
      </div>
    </div>
  );
};

const Composer = ({ onSend, agentColor }) => {
  const [val, setVal] = useStateChat('');
  const taRef = useRefChat(null);
  useEffectChat(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 220) + 'px';
  }, [val]);

  const submit = () => {
    if (!val.trim()) return;
    onSend(val);
    setVal('');
  };

  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(180deg, var(--r-bg-card), var(--r-bg-soft))',
      border: '1px solid var(--r-line-gold)',
      borderRadius: 14,
      padding: 14,
      boxShadow: '0 12px 40px -12px rgba(0,0,0,0.5), 0 0 30px rgba(212,175,99,0.06)',
    }}>
      <CornerChat position="tl"/>
      <CornerChat position="tr"/>
      <CornerChat position="bl"/>
      <CornerChat position="br"/>
      <textarea
        ref={taRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="Speak, and Elrond shall listen…"
        rows={1}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          color: 'var(--r-ink)',
          fontFamily: 'var(--r-body)',
          fontSize: 15,
          lineHeight: 1.5,
          padding: '4px 6px',
          minHeight: 28,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, padding: '0 4px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="r-btn r-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} title="Attach">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 11l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8"/></svg>
            attach
          </button>
          <button className="r-btn r-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} title="Voice">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0 M12 18v3"/></svg>
            voice
          </button>
          <button className="r-btn r-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} title="Browse tools">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 11-7-7"/></svg>
            tools · 47
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, color: 'var(--r-ink-faint)', fontFamily: 'var(--r-mono)' }}>↵ to send · ⇧↵ for line</span>
          <button className="r-btn r-btn-gold" style={{ padding: '6px 14px' }} onClick={submit}>
            send →
          </button>
        </div>
      </div>
    </div>
  );
};

const AgentToggle = ({ agent, setAgent }) => (
  <div style={{
    display: 'inline-flex',
    background: 'var(--r-bg-deep)',
    border: '1px solid var(--r-line)',
    borderRadius: 999,
    padding: 3,
  }}>
    {AGENTS.map(a => {
      const isActive = a.key === agent.key;
      return (
        <button key={a.key} onClick={() => setAgent(a)} style={{
          padding: '5px 14px',
          borderRadius: 999,
          border: 'none',
          background: isActive ? 'rgba(212,175,99,0.14)' : 'transparent',
          color: isActive ? 'var(--r-gold)' : 'var(--r-ink-mute)',
          fontSize: 12,
          fontFamily: 'var(--r-body)',
          fontWeight: 500,
          cursor: 'pointer',
          letterSpacing: '0.02em',
          transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: isActive ? a.color : 'var(--r-ink-ghost)',
            boxShadow: isActive ? `0 0 6px ${a.color}` : 'none',
          }}/>
          {a.name}
        </button>
      );
    })}
  </div>
);

// Right rail: Scribe's log
const ScribeRail = () => {
  const ICONS = {
    email:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18v12H3z M3 6l9 7 9-7"/></svg>,
    calendar: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18 M8 3v4 M16 3v4"/></svg>,
    task:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12l4 4 10-10"/></svg>,
    note:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h4"/></svg>,
    web:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18 M12 3a13 13 0 010 18 M12 3a13 13 0 000 18"/></svg>,
    thinking: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r="0.8" fill="currentColor"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/><circle cx="16" cy="12" r="0.8" fill="currentColor"/></svg>,
  };
  const COLORS = {
    email: 'var(--r-elf-blue)', calendar: 'var(--r-amber)',
    task: 'var(--r-emerald)', note: 'var(--r-gold)',
    web: 'var(--r-silver)', thinking: 'var(--r-ink-mute)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '20px 22px 14px',
        borderBottom: '1px solid var(--r-line)',
      }}>
        <div className="r-eyebrow-gold">The Scribe's Log</div>
        <div className="r-display" style={{ fontSize: 19, fontWeight: 500, color: 'var(--r-star)', marginTop: 6, lineHeight: 1.2 }}>
          Whilst you were away
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', marginTop: 4, fontStyle: 'italic' }}>
          Six acts since 6:14 AM · still on watch
        </div>
      </div>

      <div className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 22px', position: 'relative' }}>
        {/* timeline rail */}
        <div style={{
          position: 'absolute', left: 30, top: 22, bottom: 22,
          width: 1,
          background: 'linear-gradient(180deg, transparent, var(--r-line-gold) 8%, var(--r-line-gold) 92%, transparent)',
        }}/>

        {MOCK_C.scribeLog.map((entry, i) => (
          <div key={entry.id} className="r-stream-in" style={{
            display: 'flex', gap: 14,
            padding: '10px 0',
            position: 'relative',
            animationDelay: (i * 0.06) + 's',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'var(--r-bg)',
              border: `1px solid ${COLORS[entry.kind]}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              color: COLORS[entry.kind],
              marginLeft: -1,
              marginTop: 2,
              ...(entry.live ? { boxShadow: `0 0 12px ${COLORS[entry.kind]}` } : {}),
            }}>
              {entry.live
                ? <span className="r-pulse-dot" style={{ width: 5, height: 5 }}/>
                : ICONS[entry.kind] }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 10.5, color: 'var(--r-ink-faint)', fontFamily: 'var(--r-mono)', letterSpacing: '0.04em' }}>{entry.t}</span>
                <span style={{ fontSize: 10, color: COLORS[entry.kind], textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>
                  {entry.kind}
                </span>
              </div>
              <div style={{ color: 'var(--r-ink-soft)', fontSize: 13, lineHeight: 1.55, marginTop: 3 }}>
                {entry.text}
                {entry.live && <span style={{ marginLeft: 4, color: 'var(--r-elf-glow)' }} className="r-breathe">···</span>}
              </div>
              {entry.tools.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  {entry.tools.map(t => (
                    <span key={t} style={{
                      fontFamily: 'var(--r-mono)', fontSize: 10,
                      color: 'var(--r-ink-mute)',
                    }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 22px', borderTop: '1px solid var(--r-line)' }}>
        <button className="r-btn r-btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: 11.5 }}>
          Open full Scribe →
        </button>
      </div>
    </div>
  );
};

const HallView = () => {
  const [agent, setAgent] = useStateChat(AGENTS[0]);
  const [thread, setThread] = useStateChat(SAMPLE_THREAD);
  const scrollRef = useRefChat(null);

  useEffectChat(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length]);

  const send = (text) => {
    setThread(t => [...t, { role: 'user', t: 'now', content: text }]);
    // simulate
    setTimeout(() => {
      setThread(t => [...t, {
        role: 'assistant', t: 'now',
        content: 'Heard. Let me consider that for a moment.',
      }]);
    }, 700);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', height: '100%', minHeight: 0 }}>
      {/* Center: chat */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {/* Top bar */}
        <div style={{
          padding: '18px 32px 14px',
          borderBottom: '1px solid var(--r-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SignetChat size={42} color={agent.color}>
              <EvChat size={20} color={agent.color}/>
            </SignetChat>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, lineHeight: 1.1 }}>
                <span className="r-display-i" style={{ fontSize: 22, color: 'var(--r-star)' }}>Elrond</span>
                <span style={{ fontSize: 10, color: 'var(--r-ink-mute)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Lord of Imladris</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--r-ink-mute)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span className="r-pulse-dot green" style={{ width: 5, height: 5 }}/>
                attending · all systems clear · last action 2m ago
              </div>
            </div>
          </div>
          <AgentToggle agent={agent} setAgent={setAgent}/>
        </div>

        {/* Conversation scroll */}
        <div ref={scrollRef} className="r-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 32px 0' }}>
          {/* opening flourish */}
          <div style={{ textAlign: 'center', padding: '12px 0 28px' }}>
            <KnotChat opacity={0.5}/>
            <div style={{
              fontFamily: 'var(--r-display)', fontStyle: 'italic',
              fontSize: 13, color: 'var(--r-ink-mute)', marginTop: 6,
              letterSpacing: '0.03em',
            }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {MOCK_C.greeting()}, Matt
            </div>
          </div>

          {thread.map((m, i) => <Message key={i} m={m} agentColor={agent.color}/>)}

          <div style={{ height: 24 }}/>
        </div>

        {/* Composer */}
        <div style={{ padding: '14px 32px 22px' }}>
          <Composer onSend={send} agentColor={agent.color}/>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 10, padding: '0 4px',
            fontSize: 10.5, color: 'var(--r-ink-faint)',
          }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <span className="r-mono">⌘K commands</span>
              <span className="r-mono">⌘⇧L scribe</span>
              <span className="r-mono">⌘/ shortcuts</span>
            </div>
            <span className="r-mono">tailscale · ts-mac-mini · 100.124.7.42</span>
          </div>
        </div>
      </div>

      {/* Right rail: scribe */}
      <div style={{
        borderLeft: '1px solid var(--r-line)',
        background: 'linear-gradient(180deg, var(--r-rail-grad-1), var(--r-rail-grad-2))',
        position: 'relative',
      }}>
        <ScribeRail/>
      </div>
    </div>
  );
};

window.HallView = HallView;
