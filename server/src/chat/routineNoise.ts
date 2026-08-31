/** Classifiers for scheduled-routine noise in durable chat event logs.
 *  Used by unread counts, history previews, and team-recent so quiet
 *  automations never look like a teammate waiting on Matt. */

const GEAR = '\u2699';

export function eventInner(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const wrapped = (o.ev && typeof o.ev === 'object' ? o.ev : o) as Record<string, unknown>;
  if (wrapped.event && typeof wrapped.event === 'object') {
    return wrapped.event as Record<string, unknown>;
  }
  return wrapped;
}

export function eventType(raw: unknown): string | undefined {
  const inner = eventInner(raw);
  const t = inner?.type;
  return typeof t === 'string' ? t : undefined;
}

/** Every text payload on the event (assistant content can be an array). */
export function eventTexts(raw: unknown): string[] {
  const inner = eventInner(raw);
  if (!inner) return [];
  if (typeof inner.text === 'string') return inner.text ? [inner.text] : [];
  const msg = inner.message;
  if (msg && typeof msg === 'object') {
    const content = (msg as { content?: unknown }).content;
    if (typeof content === 'string') return content ? [content] : [];
    if (Array.isArray(content)) {
      const out: string[] = [];
      for (const c of content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text' && typeof (c as { text?: string }).text === 'string') {
          out.push((c as { text: string }).text);
        }
      }
      return out;
    }
  }
  return [];
}

export function isRoutinePromptText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^\[routine:/i.test(t) || /\(Scheduled automation —/i.test(t);
}

function normalizeReply(text: string): string {
  return text.trim().replace(/[*`#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Exact idle token. "NO_UPDATE — failed to reach X" must still show. */
export function isExactNoUpdate(text: string): boolean {
  return /^no_update[.!?]*$/.test(normalizeReply(text));
}

/** Negated failure phrase ("no jobs failed", "nothing failed", "zero
 *  errors"): the negator must sit within 3 words of the failure word —
 *  "No updates because the API failed" is NOT negated. */
const NEGATED_FAILURE = /\b(?:no|nothing|never|zero|without)\s+(?:[\w-]+\s+){0,3}(?:failed|failures?|errors?|broken|timed out|timeouts?)\b/;

/** Failure/delivery signals that always beat a quiet pattern. Negation- and
 *  context-aware: "no jobs failed" and "previously posted items are
 *  unchanged" are quiet, while "an API error" and "posted the summary" are not. */
function hasFailureSignal(text: string): boolean {
  const lower = normalizeReply(text);
  if (/\b(needs you|needs matt|needs attention|action needed)\b/.test(lower)) return true;
  if (/\b(failed|failures?|errors?|broken|timed out|timeouts?)\b/.test(lower) && !NEGATED_FAILURE.test(lower)) return true;
  if (/\b(posted|shipped|deployed|sent|published|refreshed)\b/.test(lower)
    && !/\b(previously|not|never)\b[^.;!\n]{0,20}\b(posted|shipped|deployed|sent|published|refreshed)\b/.test(lower)
    && !/\b(posted|shipped|deployed|sent|published|refreshed)\b[^.;!\n]{0,30}\bunchanged\b/.test(lower)) return true;
  return false;
}

/** No-op automation replies: hide these, keep real ship/fail/needs-Matt text. */
export function isQuietRoutineReply(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const lower = normalizeReply(t);
  // Failure/delivery signals always win over the quiet patterns below —
  // "Stayed silent because of an API error" must surface, not vanish.
  if (hasFailureSignal(t)) return false;
  if (isExactNoUpdate(t)) return true;
  if (/^quiet\b/.test(lower)) return true;
  if (/\bstayed silent\b/.test(lower)) return true;
  if (/\bno new shipped rows\b/.test(lower)) return true;
  if (NEGATED_FAILURE.test(lower) && lower.length < 500) return true; // "no jobs failed"
  if (/\b(unchanged|no changes?|no updates?|up to date)\b/.test(lower) && lower.length < 500) return true;
  if (/\b(zero|no) (errors?|failures?|issues?|problems?)\b/.test(lower) && lower.length < 500) return true;
  if (/\bnothing (new|happened)\b/.test(lower) && lower.length < 500) return true;
  return false;
}

/** Last non-quiet text, else the last payload. Trailing NO_UPDATE must not
 *  steal unread / preview from real prose in the same event. */
export function eventText(raw: unknown): string {
  const texts = eventTexts(raw);
  const real = [...texts].reverse().find((t) => t.trim() && !isQuietRoutineReply(t));
  if (real) return real;
  return texts.length ? texts[texts.length - 1] : '';
}

export function isAutomationPeerEvent(raw: unknown): boolean {
  if (eventType(raw) !== 'peer_message') return false;
  const inner = eventInner(raw);
  if (!inner) return false;
  const fromRole = typeof inner.fromRole === 'string' ? inner.fromRole : '';
  const from = typeof inner.from === 'string' ? inner.from : '';
  if (fromRole.trim().toLowerCase() === 'automation') return true;
  if (from.trim().startsWith(GEAR)) return true;
  return isRoutinePromptText(eventText(raw));
}

/** Skip this event when counting unread / picking a sidebar preview. */
export function isRoutineNoiseEvent(raw: unknown, afterAutomation: boolean): boolean {
  const t = eventType(raw);
  if (t === 'peer_message' && isAutomationPeerEvent(raw)) return true;
  const texts = eventTexts(raw);
  if (texts.some((text) => isRoutinePromptText(text))) return true;
  if (t === 'assistant' || t === 'result') {
    const nonempty = texts.map((x) => x.trim()).filter(Boolean);
    const quietAll = nonempty.length === 0 || nonempty.every(isQuietRoutineReply);
    if (afterAutomation && t === 'assistant' && quietAll) return true;
    if (t === 'result' && afterAutomation) return true;
    if (t === 'assistant' && !eventText(raw).trim()) return true;
  }
  return false;
}
