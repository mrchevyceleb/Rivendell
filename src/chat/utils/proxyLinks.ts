// Client-side companion to server/src/lib/proxyLinks.ts. Detects mentions of
// the workspace label `ASSISTANT-HUB/path/to/thing` in freeform text and
// rewrites them to inline markdown links with custom protocols
// (`rivendell-doc:` / `rivendell-folder:`) so the Markdown renderer can swap
// them for in-app proxy cards. Operates on text only, never on URLs in code
// fences (those are passed through verbatim by react-markdown's normal
// parsing).

const LABEL = 'ASSISTANT-HUB';
const MENTION_PATTERN = new RegExp(
  String.raw`\b${LABEL}(/[A-Za-z0-9._\-/]+)?`,
  'g',
);

export function annotateWorkspaceMentions(input: string): string {
  if (!input.includes(LABEL)) return input;
  return input.replace(MENTION_PATTERN, (match, tail: string | undefined) => {
    const rel = tail ? tail.replace(/^\//, '').replace(/[).,;:!?\]'"`>]+$/, '') : '';
    const trailing = tail && rel.length < tail.length - 1 ? tail.slice(rel.length + 1) : '';
    const looksLikeFile = rel.length > 0 && /\.[A-Za-z0-9]+$/.test(rel.split('/').pop() ?? '');
    const protocol = looksLikeFile ? 'rivendell-doc' : 'rivendell-folder';
    const display = rel ? `${LABEL}/${rel}` : LABEL;
    return `[${display}](${protocol}:${rel})${trailing}`;
  });
}

export function parseProxyHref(href: string | undefined): { kind: 'doc' | 'folder'; path: string } | null {
  if (!href) return null;
  if (href.startsWith('rivendell-doc:')) return { kind: 'doc', path: href.slice('rivendell-doc:'.length) };
  if (href.startsWith('rivendell-folder:')) return { kind: 'folder', path: href.slice('rivendell-folder:'.length) };
  return null;
}
