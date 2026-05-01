import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { workspaceRoot, WORKSPACE_DISPLAY_LABEL } from './workspace.ts';

export type ProxyLink = {
  kind: 'doc-link' | 'folder-link';
  path: string;
  title?: string;
};

export type ProxyRewrite = {
  text: string;
  links: ProxyLink[];
};

// Scans freeform text for absolute Mac paths inside the workspace and returns
// the same text with paths rewritten to workspace-relative form, plus a list
// of proxy link descriptors for each unique path. Used at boundaries where
// the assistant or a worker emits content that will be rendered cross-device.
export function rewriteAbsolutePaths(input: string): ProxyRewrite {
  if (!input) return { text: input, links: [] };
  const root = workspaceRoot();
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}(?:/[^\\s)\\]"'\`<>]*)?`, 'g');

  const seen = new Set<string>();
  const links: ProxyLink[] = [];

  const text = input.replace(pattern, (match) => {
    const trimmed = stripTrailingPunct(match);
    const trailing = match.slice(trimmed.length);
    const rel = trimmed === root ? '' : trimmed.slice(root.length + 1);
    const display = rel === '' ? WORKSPACE_DISPLAY_LABEL : `${WORKSPACE_DISPLAY_LABEL}/${rel}`;

    if (!seen.has(rel)) {
      seen.add(rel);
      const kind = inferKind(trimmed);
      const title = rel === '' ? WORKSPACE_DISPLAY_LABEL : rel.split('/').pop();
      links.push({ kind, path: rel, title });
    }

    return `${display}${trailing}`;
  });

  return { text, links };
}

function stripTrailingPunct(value: string): string {
  // Strip common trailing punctuation that wraps a path mention but isn't
  // part of the path itself.
  return value.replace(/[).,;:!?\]'"`>]+$/g, '');
}

function inferKind(absPath: string): 'doc-link' | 'folder-link' {
  try {
    if (existsSync(absPath)) {
      return statSync(absPath).isDirectory() ? 'folder-link' : 'doc-link';
    }
  } catch {
    // Fall through to extension heuristic.
  }
  // No filesystem hit (e.g. a path mentioned that doesn't exist yet) — guess
  // from the trailing segment: looks-like-a-file if it has a dot in the leaf.
  const leaf = absPath.split('/').pop() ?? '';
  return leaf.includes('.') ? 'doc-link' : 'folder-link';
}

// For absolute paths that need workspace-relative form without text rewrite —
// useful when a caller has a single path to translate.
export function relativeToWorkspace(absPath: string): string | null {
  if (!absPath) return null;
  const root = workspaceRoot();
  const abs = resolve(absPath);
  if (abs === root) return '';
  if (!abs.startsWith(`${root}/`)) return null;
  return abs.slice(root.length + 1);
}
