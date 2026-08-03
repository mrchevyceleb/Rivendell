// Reimagined DESKTOP chat shell — §4. A 296px IDE sidebar (Files-first tabs,
// new-errand, Chronicle pane, companion footer) + a main column with Hall /
// Council / Forge room tabs, a chronicle ribbon ticker, a 760px feed, and the
// composer dock. Rendered by ChatTab (the live mount) and switched to Mobile
// under the mobile breakpoint by Threshold.

import { useState } from 'react';
import type { ShellViewProps } from '../reimagine/useChatShell';
import { ChatThread } from '../reimagine/blocks';
import { Composer } from '../reimagine/Composer';
import {
  CounselPopover,
  CompanionFooter,
  ModelChip,
} from '../reimagine/CounselPicker';
import {
  ChronicleRows,
  HubTree,
  HubsStrip,
  RibbonTicker,
} from '../reimagine/RoomViews';
import { Moon, StarSigil, Sun } from '../reimagine/icons';

export function Conversation({ s, picker, repo }: ShellViewProps) {
  const [pane, setPane] = useState<'files' | 'chron'>('files');
  const [counselOpen, setCounselOpen] = useState(false);

  return (
    <div className="rc rc-desktop">
      <div className="sky" aria-hidden="true">
        <Stars n={54} motes={7} />
      </div>
      <div className="shell">
        {/* ── sidebar ── */}
        <aside className="side">
          <div className="side-head">
            <button
              type="button"
              className="sigil"
              aria-label="Rivendell sigil"
              onClick={(e) => s.sparks.burst(e.clientX, e.clientY)}
            >
              <StarSigil style={{ width: 16, height: 16 }} />
            </button>
            <div>
              <h1>Rivendell</h1>
              <div className="sub">the last homely house</div>
            </div>
          </div>

          <button
            type="button"
            className="new-errand"
            onClick={() => {
              s.setRoom('hall');
              s.setValue('/errand ');
            }}
          >
            <PlusSmall /> Begin a new errand
          </button>

          <div className="side-tabs">
            <button type="button" className={`stab${pane === 'files' ? ' on' : ''}`} onClick={() => setPane('files')}>
              Files
            </button>
            <button type="button" className={`stab${pane === 'chron' ? ' on' : ''}`} onClick={() => setPane('chron')}>
              Chronicle
            </button>
          </div>

          <div className="side-scroll">
            <div className={`pane${pane === 'files' ? ' on' : ''}`}>
              <div className="side-sec">
                <span>The Hub · ASSISTANT-HUB</span>
              </div>
              <HubTree onPick={s.pickFile} />
            </div>
            <div className={`pane${pane === 'chron' ? ' on' : ''}`}>
              <div className="side-sec">
                <span>The Chronicle</span>
              </div>
              <ChronicleRows events={s.chronicle} onPick={s.pickChronicle} />
              <div className="side-sec" style={{ marginTop: 8 }}>
                <span>Hubs</span>
              </div>
              <HubsStrip />
            </div>
          </div>

          <div className="side-foot">
            <div className="side-sec" style={{ padding: '4px 10px 6px' }}>
              <span>Companion</span>
            </div>
            <CompanionFooter picker={picker} onClick={() => setCounselOpen(true)} />
          </div>
        </aside>

        {/* ── main column ── */}
        <div className="main">
          <header className="top">
            <h2 className="hall-title">The Hall</h2>
            <span className="crumb">
              {repo?.name ?? 'ASSISTANT-HUB'} · {repo?.branch ?? 'master'}
            </span>
            <div className="presence">
              <span className="pulse" style={{ width: 7, height: 7 }} /> Elrond attends
            </div>
            <button
              type="button"
              className="themebtn"
              aria-label="Day or night"
              onClick={s.toggle}
            >
              <Sun className="ic-sun" style={{ width: 15, height: 15 }} />
              <Moon className="ic-moon" style={{ width: 15, height: 15 }} />
            </button>
          </header>

          <RibbonTicker events={s.chronicle} />

          <main className="feed" ref={s.sticky.scrollRef} onScroll={s.sticky.onScroll}>
            <div className="feed-inner">
              <ChatThread
                blocks={s.blocks}
                status={s.status}
                contentRef={s.sticky.contentRef}
                bottomRef={s.sticky.bottomRef}
              />
              {s.error ? (
                <div className="chip" style={{ color: 'var(--amber)', borderColor: 'color-mix(in oklch, var(--amber) 40%, transparent)', background: 'color-mix(in oklch, var(--amber) 10%, transparent)' }}>
                  ⚠ {s.error}
                </div>
              ) : null}
            </div>
          </main>

          <button
            type="button"
            className={`jump${s.sticky.unread > 0 || (!s.sticky.pinned && s.busy) ? ' show' : ''}`}
            onClick={s.sticky.jumpToBottom}
          >
            To the latest word
            {s.sticky.unread > 0 ? <span className="cnt">{s.sticky.unread}</span> : null}
          </button>

          <div className="dock">
            <div className="dock-inner">
              <CounselPopover picker={picker} open={counselOpen} onClose={() => setCounselOpen(false)} />
              <Composer
                value={s.value}
                onChange={s.setValue}
                onSend={s.send}
                onStop={s.stop}
                onSteer={s.steer}
                busy={s.busy}
                commands={s.commands}
                modelChip={<ModelChip picker={picker} onClick={() => setCounselOpen((o) => !o)} />}
                onMellon={(rect) => s.sparks.burst(rect.left + rect.width / 2, rect.top + rect.height / 2)}
              />
            </div>
          </div>
        </div>
      </div>
      {s.sparks.sparks}
    </div>
  );
}

function PlusSmall() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Ambient starfield + gold motes (deterministic-enough random offsets).
function Stars({ n, motes }: { n: number; motes: number }) {
  const stars = Array.from({ length: n }, (_, i) => i);
  const ms = Array.from({ length: motes }, (_, i) => i);
  return (
    <>
      {stars.map((i) => (
        <span
          key={`s${i}`}
          className="st"
          style={{
            left: `${(i * 37) % 100}%`,
            top: `${(i * 61) % 100}%`,
            ['--d' as string]: `${2 + ((i * 7) % 40) / 10}s`,
            ['--dl' as string]: `${(i * 13) % 50 / 10}s`,
            ...(i % 3 === 0 ? { width: 1, height: 1 } : null),
          } as React.CSSProperties}
        />
      ))}
      {ms.map((i) => (
        <span
          key={`m${i}`}
          className="mote"
          style={{
            left: `${(i * 53) % 100}%`,
            ['--d' as string]: `${16 + ((i * 9) % 16)}s`,
            ['--dl' as string]: `${(i * 17) % 14}s`,
            ['--dx' as string]: `${((i * 29) % 60) - 30}px`,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
}
