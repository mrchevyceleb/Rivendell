// Client-side companion to server/src/lib/proxyLinks.ts. Detects mentions of
// the workspace label `ASSISTANT-HUB/path/to/thing` in freeform text and
// rewrites them to inline markdown links with custom protocols
// (`rivendell-doc:` / `rivendell-folder:`) so the Markdown renderer can swap
// them for in-app proxy cards. Operates on text only, never on URLs in code
// fences (those are passed through verbatim by react-markdown's normal
// parsing).

const LABEL = 'ASSISTANT-HUB';

// Workspace and OneDrive paths commonly contain spaces ("Client Dashboards/
// Q1 Plan.md"), so the matcher has to accept them inside segments. To avoid
// absorbing trailing prose, the lookahead caps the run at: end-of-text,
// newline, sentence punctuation, period-then-space (e.g. ".md "), or a space
// followed by a common English connective. This handles the common cases
// well enough — a stray over-match on unusual prose is preferable to
// breaking every path that contains a space.
const STOP_WORDS = '(?:and|or|but|the|a|an|is|are|was|were|to|of|in|on|at|by|for|that|which|because|since|so|then|with|from|as|when|where|while|after|before|will|would|should|can|could|may|might|like|this|these|those|it|its|i|we|you|he|she|they)';
const MENTION_PATTERN = new RegExp(
  String.raw`\b${LABEL}(\/[^\n\r]+?)?(?=$|[,;:!?]|[\n\r]|\.(?:\s|$)|\s+${STOP_WORDS}\b)`,
  'g',
);

const TRAILING_PUNCT = /[\s).,;:!?\]'"`>]+$/;

export function annotateWorkspaceMentions(input: string): string {
  if (!input.includes(LABEL)) return input;
  return input.replace(MENTION_PATTERN, (_match, tail: string | undefined) => {
    if (!tail) return `[${LABEL}](rivendell-folder:)`;
    const trailingMatch = tail.match(TRAILING_PUNCT);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const cleanTail = trailing ? tail.slice(0, tail.length - trailing.length) : tail;
    const pathParts = splitPathAndTrailingText(cleanTail.replace(/^\//, ''));
    const rel = pathParts.path;
    const looksLikeFile = rel.length > 0 && /\.[A-Za-z0-9]+$/.test(rel.split('/').pop() ?? '');
    const protocol = looksLikeFile ? 'rivendell-doc' : 'rivendell-folder';
    const display = rel ? `${LABEL}/${rel}` : LABEL;
    return `[${display}](${protocol}:${encodeURIComponent(rel)})${pathParts.trailingText}${trailing}`;
  });
}

export function parseProxyHref(href: string | undefined): { kind: 'doc' | 'folder'; path: string } | null {
  if (!href) return null;
  if (href.startsWith('rivendell-doc:')) return { kind: 'doc', path: decodeProxyPath(href.slice('rivendell-doc:'.length)) };
  if (href.startsWith('rivendell-folder:')) return { kind: 'folder', path: decodeProxyPath(href.slice('rivendell-folder:'.length)) };
  return null;
}

function decodeProxyPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPathAndTrailingText(value: string): { path: string; trailingText: string } {
  const filePathWithTrailingText = value.match(/^(.+\.[A-Za-z0-9]{1,12})(\s+.+)$/);
  if (filePathWithTrailingText) {
    return { path: filePathWithTrailingText[1], trailingText: filePathWithTrailingText[2] };
  }
  return { path: value, trailingText: '' };
}
