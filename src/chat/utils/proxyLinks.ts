// Client-side companion to server/src/lib/proxyLinks.ts. Detects mentions of
// the workspace label `ASSISTANT-HUB/path/to/thing` (or the equivalent Windows
// absolute path under OneDrive) in freeform text and rewrites them to inline
// markdown links with custom protocols (`rivendell-doc:` / `rivendell-folder:`)
// so the Markdown renderer can swap them for in-app proxy cards. Display text
// is rendered as the Windows path because Matt always views chat from a
// Windows machine, and a clickable Windows path doubles as something he can
// paste into Win+R if the in-app viewer is not what he wants.

const LABEL = 'ASSISTANT-HUB';
export const WIN_WORKSPACE_PREFIX = String.raw`C:\ASSISTANT-HUB`;

// Resolve the workspace-relative path Rivendell stores in ChatBlocks into the
// two URL forms a Windows client needs: a same-origin HTTP URL (the Tailscale
// front-door serves whatever Rivendell exposes on :8091, so this works from any
// device on the tailnet without a custom handler) and a `rivendell://` URL that
// the one-time PowerShell handler turns into `Start-Process` against the
// OneDrive-synced ASSISTANT-HUB copy on the local Windows PC.
export function buildLinkUrls(
  relPath: string,
  kind: 'doc' | 'folder',
): { browserUrl: string; nativeUrl: string; windowsPath: string } {
  const safeRel = (relPath || '').replace(/^\/+/, '');
  const windowsPath = safeRel === ''
    ? WIN_WORKSPACE_PREFIX
    : `${WIN_WORKSPACE_PREFIX}\\${safeRel.split('/').join('\\')}`;
  const browserUrl = `/api/files/raw?path=${encodeURIComponent(safeRel)}`;
  const nativeUrl = `rivendell://open?kind=${kind}&winpath=${encodeURIComponent(windowsPath)}`;
  return { browserUrl, nativeUrl, windowsPath };
}

// Triggers a `rivendell://` (or any custom scheme) URL in a way that does not
// navigate the current page. A throwaway hidden iframe whose `src` is the
// scheme URL is enough to fire the OS handler; the iframe load failure is
// silent in modern browsers, and unregistered-scheme dialogs only show in the
// top-level frame so the user gets at most a one-time "Open with…" prompt.
export function fireNativeScheme(url: string): void {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = url;
  document.body.appendChild(frame);
  setTimeout(() => {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  }, 1500);
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Windows/i.test(navigator.userAgent);
}

// Single entry point for "open this workspace path the right way for this
// device". On Windows we fire the `rivendell://` handler so the file launches
// in its native app; on phones, Macs, or Windows machines that haven't run the
// installer yet, we fall back to a path that always works — Tailscale-served
// HTTP for files, the in-app Library room for folders.
export function openWorkspaceLink(relPath: string, kind: 'doc' | 'folder'): void {
  const { browserUrl, nativeUrl } = buildLinkUrls(relPath, kind);
  if (isWindowsPlatform()) {
    fireNativeScheme(nativeUrl);
    return;
  }
  if (kind === 'doc') {
    window.open(browserUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const url = `/library?path=${encodeURIComponent(relPath || '')}`;
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// Workspace and OneDrive paths commonly contain spaces ("Client Dashboards/
// Q1 Plan.md"), so the matcher has to accept them inside segments. To avoid
// absorbing trailing prose, the lookahead caps the run at: end-of-text,
// newline, sentence punctuation, period-then-space (e.g. ".md "), or a space
// followed by a common English connective. This handles the common cases
// well enough — a stray over-match on unusual prose is preferable to
// breaking every path that contains a space.
const STOP_WORDS = '(?:and|or|but|the|a|an|is|are|was|were|to|of|in|on|at|by|for|that|which|because|since|so|then|with|from|as|when|where|while|after|before|will|would|should|can|could|may|might|like|this|these|those|it|its|i|we|you|he|she|they)';
const STOP_LOOKAHEAD = String.raw`(?=$|[,;:!?]|[\n\r]|\.(?:\s|$)|\s+${STOP_WORDS}\b|[)\]"'\`<>])`;
const WORKSPACE_MENTION = String.raw`\b${LABEL}(?:\/[^\n\r]+?)?`;
const WIN_MENTION = String.raw`C:\\ASSISTANT-HUB(?:\\[^\n\r]+?)?`;
const MENTION_PATTERN = new RegExp(
  `(?:${WIN_MENTION}|${WORKSPACE_MENTION})${STOP_LOOKAHEAD}`,
  'g',
);

const TRAILING_PUNCT = /[\s).,;:!?\]'"`>]+$/;

export function annotateWorkspaceMentions(input: string): string {
  if (!input.includes(LABEL)) return input;
  return input.replace(MENTION_PATTERN, (match) => {
    const trailingMatch = match.match(TRAILING_PUNCT);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const cleanMatch = trailing ? match.slice(0, match.length - trailing.length) : match;

    const rel = extractRelativePath(cleanMatch);
    if (rel === null) return match;

    const pathParts = splitPathAndTrailingText(rel);
    const finalRel = pathParts.path;
    const looksLikeFile = finalRel.length > 0 && /\.[A-Za-z0-9]+$/.test(finalRel.split('/').pop() ?? '');
    const protocol = looksLikeFile ? 'rivendell-doc' : 'rivendell-folder';
    const display = toWindowsDisplay(finalRel);
    return `[${display}](${protocol}:${encodeURIComponent(finalRel)})${pathParts.trailingText}${trailing}`;
  });
}

function extractRelativePath(value: string): string | null {
  if (value.startsWith(WIN_WORKSPACE_PREFIX)) {
    const tail = value.slice(WIN_WORKSPACE_PREFIX.length);
    if (tail === '') return '';
    if (!tail.startsWith('\\')) return null;
    return tail.slice(1).replace(/\\/g, '/');
  }
  if (value === LABEL) return '';
  if (value.startsWith(`${LABEL}/`)) return value.slice(LABEL.length + 1);
  return null;
}

function toWindowsDisplay(rel: string): string {
  if (!rel) return WIN_WORKSPACE_PREFIX;
  return `${WIN_WORKSPACE_PREFIX}\\${rel.split('/').join('\\')}`;
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
