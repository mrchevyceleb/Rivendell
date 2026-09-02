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
export const NATIVE_OPEN_STORAGE_KEY = 'rivendell.native-open.installed.v2';
const UNIX_WORKSPACE_PREFIXES = [
  '/home/mrchevyceleb/ASSISTANT-HUB',
  '/Users/mjohnst/ASSISTANT-HUB',
];

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

function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua)
    && /Chrome\//i.test(ua)
    && !/(?:EdgA|OPR|SamsungBrowser|Firefox|FxiOS)\//i.test(ua);
}

function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function androidViewIntent(url: URL): string {
  const scheme = url.protocol.slice(0, -1);
  const data = `${url.host}${url.pathname}${url.search}`;
  return `intent://${data}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
}

function openWindowsDefaultBrowser(url: URL): void {
  let handedOff = false;
  const markHandedOff = () => { handedOff = true; };
  const onVisibility = () => { if (document.visibilityState === 'hidden') markHandedOff(); };
  window.addEventListener('blur', markHandedOff, { once: true });
  document.addEventListener('visibilitychange', onVisibility);
  fireNativeScheme(`rivendell://open?url=${encodeURIComponent(url.href)}`);

  window.setTimeout(() => {
    window.removeEventListener('blur', markHandedOff);
    document.removeEventListener('visibilitychange', onVisibility);
    if (handedOff || document.visibilityState === 'hidden') return;
    // The acknowledged handler no longer responded. Make this click recoverable
    // and let future links use their ordinary target=_blank path until setup is
    // confirmed again. Top-level navigation is the only popup-safe async fallback.
    try { window.localStorage.removeItem(NATIVE_OPEN_STORAGE_KEY); } catch { /* best effort */ }
    window.location.assign(url.href);
  }, 3000);
}

/** Open an agent-supplied external HTTP(S) link outside an installed PWA.
 *  Returns true when the normal anchor navigation has been replaced.
 *
 *  Web platform APIs cannot choose the OS default browser directly. Windows
 *  uses Rivendell's one-time native scheme handler (Start-Process honors the
 *  default browser); Android hands the URL to ACTION_VIEW. Ordinary browser
 *  tabs and same-origin links retain normal target=_blank behavior. */
export function openExternalHttpLink(href: string): boolean {
  if (!isStandalonePwa() || typeof window === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return false;

  if (isWindowsPlatform()) {
    try {
      if (window.localStorage.getItem(NATIVE_OPEN_STORAGE_KEY) !== '1') return false;
    } catch {
      return false;
    }
    openWindowsDefaultBrowser(url);
    return true;
  }

  // Chrome's documented intent:// path is reliable on Android. Other Android
  // PWA runtimes differ (and may replace the PWA with the fallback URL), so
  // leave their ordinary target=_blank behavior untouched. Intent fragments
  // reserve `#Intent`; links with fragments/credentials also keep the normal,
  // lossless anchor path.
  if (isAndroidChrome() && !url.hash && !url.username && !url.password) {
    try {
      window.location.assign(androidViewIntent(url));
      return true;
    } catch {
      return false;
    }
  }

  return false;
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
const UNIX_MENTION = UNIX_WORKSPACE_PREFIXES
  .map((prefix) => `${escapeRegex(prefix)}(?:/[^\\n\\r]+?)?`)
  .join('|');
const MENTION_PATTERN = new RegExp(
  `(?:${WIN_MENTION}|${UNIX_MENTION}|${WORKSPACE_MENTION})${STOP_LOOKAHEAD}`,
  'g',
);

const TRAILING_PUNCT = /[\s).,;:!?\]'"`>]+$/;

export function annotateWorkspaceMentions(input: string): string {
  if (!mentionsWorkspace(input)) return input;
  return annotateMarkdownOutsideCode(input);
}

export function parseWorkspaceMentionText(value: string): { kind: 'doc' | 'folder'; path: string; display: string } | null {
  const trimmed = value.trim();
  const proxyMarkdownLink = trimmed.match(/^\[([^\]]+)]\((rivendell-(?:doc|folder):[^)]+)\)$/);
  if (proxyMarkdownLink) {
    const target = parseProxyHref(proxyMarkdownLink[2]);
    if (!target) return null;
    return { ...target, display: proxyMarkdownLink[1] || toWindowsDisplay(target.path) };
  }

  const clean = trimmed.replace(TRAILING_PUNCT, '');
  const rel = extractRelativePath(normalizeHrefPath(clean));
  if (rel === null) return null;
  const path = normalizeWorkspacePath(rel);
  if (path === null) return null;
  return { kind: inferKind(path), path, display: toWindowsDisplay(path) };
}

function annotatePlainWorkspaceMentions(input: string): string {
  return input.replace(MENTION_PATTERN, (match) => {
    const trailingMatch = match.match(TRAILING_PUNCT);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const cleanMatch = trailing ? match.slice(0, match.length - trailing.length) : match;

    const rel = extractRelativePath(cleanMatch);
    if (rel === null) return match;

    const pathParts = splitPathAndTrailingText(rel);
    const finalRel = normalizeWorkspacePath(pathParts.path);
    if (finalRel === null) return match;
    const looksLikeFile = finalRel.length > 0 && /\.[A-Za-z0-9]+$/.test(finalRel.split('/').pop() ?? '');
    const protocol = looksLikeFile ? 'rivendell-doc' : 'rivendell-folder';
    const display = toWindowsDisplay(finalRel);
    return `[${display}](${protocol}:${encodeURIComponent(finalRel)})${pathParts.trailingText}${trailing}`;
  });
}

function annotateMarkdownOutsideCode(input: string): string {
  const chunks = input.split(/(\r?\n)/);
  let output = '';
  let fence: { char: '`' | '~'; length: number } | null = null;

  for (let i = 0; i < chunks.length; i += 2) {
    const line = chunks[i] ?? '';
    const newline = chunks[i + 1] ?? '';

    if (fence) {
      output += line + newline;
      const close = line.match(/^(?: {0,3})(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }

    const open = line.match(/^(?: {0,3})(`{3,}|~{3,})/);
    if (open) {
      fence = { char: open[1][0] as '`' | '~', length: open[1].length };
      output += line + newline;
      continue;
    }

    output += annotateInlineOutsideCodeSpans(line) + newline;
  }

  return output;
}

function annotateInlineOutsideCodeSpans(line: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < line.length) {
    const start = line.indexOf('`', cursor);
    if (start < 0) {
      output += annotatePlainWorkspaceMentions(line.slice(cursor));
      break;
    }

    let ticksEnd = start;
    while (line[ticksEnd] === '`') ticksEnd += 1;
    const tickCount = ticksEnd - start;
    const close = findClosingTickRun(line, ticksEnd, tickCount);

    if (close < 0) {
      output += annotatePlainWorkspaceMentions(line.slice(cursor));
      break;
    }

    output += annotatePlainWorkspaceMentions(line.slice(cursor, start));
    output += line.slice(start, close + tickCount);
    cursor = close + tickCount;
  }

  return output;
}

function findClosingTickRun(line: string, from: number, tickCount: number): number {
  const needle = '`'.repeat(tickCount);
  let pos = line.indexOf(needle, from);

  while (pos >= 0) {
    const before = line[pos - 1];
    const after = line[pos + tickCount];
    if (before !== '`' && after !== '`') return pos;
    pos = line.indexOf(needle, pos + 1);
  }

  return -1;
}

function extractRelativePath(value: string): string | null {
  if (value.startsWith(WIN_WORKSPACE_PREFIX)) {
    const tail = value.slice(WIN_WORKSPACE_PREFIX.length);
    if (tail === '') return '';
    if (!tail.startsWith('\\')) return null;
    return tail.slice(1).replace(/\\/g, '/');
  }
  for (const prefix of UNIX_WORKSPACE_PREFIXES) {
    if (value === prefix) return '';
    if (value.startsWith(`${prefix}/`)) return value.slice(prefix.length + 1);
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
  if (href.startsWith('rivendell-doc:')) {
    const path = normalizeWorkspacePath(decodeProxyPath(href.slice('rivendell-doc:'.length)));
    return path === null ? null : { kind: 'doc', path };
  }
  if (href.startsWith('rivendell-folder:')) {
    const path = normalizeWorkspacePath(decodeProxyPath(href.slice('rivendell-folder:'.length)));
    return path === null ? null : { kind: 'folder', path };
  }
  const rel = extractRelativePath(normalizeHrefPath(href));
  if (rel !== null) {
    const path = normalizeWorkspacePath(rel);
    if (path === null) return null;
    return { kind: inferKind(path), path };
  }
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

function mentionsWorkspace(value: string): boolean {
  return value.includes(LABEL)
    || value.includes(WIN_WORKSPACE_PREFIX)
    || UNIX_WORKSPACE_PREFIXES.some((prefix) => value.includes(prefix));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHrefPath(href: string): string {
  const decoded = decodeProxyPath(href);
  if (decoded.startsWith('file://')) return decoded.slice('file://'.length);
  return decoded;
}

export function normalizeWorkspacePath(path: string): string | null {
  const extracted = extractRelativePath(path);
  const candidate = (extracted ?? path).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
  const parts = candidate.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

function inferKind(rel: string): 'doc' | 'folder' {
  const leaf = rel.split('/').pop() ?? '';
  return /\.[A-Za-z0-9]+$/.test(leaf) ? 'doc' : 'folder';
}
