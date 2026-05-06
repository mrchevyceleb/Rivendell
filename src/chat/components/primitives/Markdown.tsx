import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';
import {
  annotateWorkspaceMentions,
  openWorkspaceLink,
  parseProxyHref,
} from '../../utils/proxyLinks';

// Literary-styled wrapper around react-markdown. Agent replies arrive as
// markdown; this renderer leans on the gold/silver theme tokens so emphasis
// (bold, code, headings, lists, quotes) reads at a glance instead of dissolving
// into a wall of ivory text.

// react-markdown v10 strips unknown URL schemes via its default urlTransform.
// Whitelist our internal proxy schemes so the `a` override below sees them
// and can render in-app cards instead of empty external links.
function proxyUrlTransform(url: string): string {
  if (url.startsWith('rivendell-doc:') || url.startsWith('rivendell-folder:')) return url;
  return defaultUrlTransform(url);
}

export function Markdown({ children }: { children: string }) {
  const annotated = annotateWorkspaceMentions(children);
  return (
    <div className="sw-md">
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        urlTransform={proxyUrlTransform}
        components={{
          p: ({ children }) => (
            <p style={{ margin: '0 0 8px', lineHeight: 1.6 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 600, color: 'var(--r-gold)' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic', color: 'var(--r-ink)' }}>{children}</em>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '4px 0 8px', paddingLeft: 22, listStyle: 'disc' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '4px 0 8px', paddingLeft: 22, listStyle: 'decimal' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '2px 0', lineHeight: 1.55 }}>{children}</li>
          ),
          h1: ({ children }) => (
            <h3 style={{
              margin: '14px 0 6px',
              fontFamily: 'var(--r-display)',
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--r-gold)',
              fontStyle: 'italic',
            }}>{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 style={{
              margin: '12px 0 4px',
              fontFamily: 'var(--r-display)',
              fontSize: 17,
              fontWeight: 500,
              color: 'var(--r-gold)',
              fontStyle: 'italic',
            }}>{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 style={{
              margin: '10px 0 2px',
              fontFamily: 'var(--r-display)',
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--r-gold-soft)',
              fontStyle: 'italic',
            }}>{children}</h5>
          ),
          code: (props: any) => {
            const { inline, children, className } = props;
            if (inline ?? !className) {
              return (
                <code
                  style={{
                    fontFamily: 'var(--r-mono)',
                    fontSize: '0.92em',
                    color: 'var(--r-gold)',
                    background: 'rgba(212, 175, 99, 0.10)',
                    border: '1px solid var(--r-line-gold)',
                    borderRadius: 4,
                    padding: '0 5px',
                    wordBreak: 'break-all',
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre style={{
                background: 'var(--r-bg-deep)',
                border: '1px solid var(--r-line)',
                borderLeft: '2px solid var(--r-gold-soft)',
                borderRadius: 6,
                padding: '10px 12px',
                margin: '10px 0',
                overflowX: 'auto',
                maxWidth: '100%',
                fontFamily: 'var(--r-mono)',
                fontSize: 12.5,
                lineHeight: 1.55,
                color: 'var(--r-ink)',
                whiteSpace: 'pre',
              }}><code>{children}</code></pre>
            );
          },
          a: ({ href, children }: { href?: string; children?: ReactNode }) => {
            const proxyTarget = parseProxyHref(href);
            if (proxyTarget) {
              const onClick = (event: React.MouseEvent) => {
                event.preventDefault();
                openWorkspaceLink(proxyTarget.path, proxyTarget.kind);
              };
              return (
                <a
                  href={href}
                  onClick={onClick}
                  className="sw-md-proxy-link"
                  data-proxy-kind={proxyTarget.kind}
                >
                  {children}
                </a>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--r-elf-glow)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                  textDecorationColor: 'rgba(106, 163, 255, 0.5)',
                }}
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '2px solid var(--r-gold-soft)',
              margin: '8px 0',
              padding: '2px 0 2px 12px',
              color: 'var(--r-ink-soft)',
              fontStyle: 'italic',
              background: 'rgba(212, 175, 99, 0.04)',
            }}>{children}</blockquote>
          ),
          hr: () => (
            <hr style={{
              border: 0,
              height: 1,
              margin: '14px 0',
              background: 'linear-gradient(90deg, transparent, var(--r-line-gold), transparent)',
            }} />
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '8px 0' }}>
              <table style={{
                borderCollapse: 'collapse',
                fontSize: 13,
                lineHeight: 1.45,
              }}>{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ borderBottom: '1px solid var(--r-line-gold)' }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th style={{
              textAlign: 'left',
              padding: '6px 12px 6px 0',
              fontWeight: 500,
              color: 'var(--r-gold)',
              fontFamily: 'var(--r-display)',
              fontStyle: 'italic',
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '4px 12px 4px 0',
              borderTop: '1px solid var(--r-line)',
              verticalAlign: 'top',
              color: 'var(--r-ink)',
            }}>{children}</td>
          ),
          del: ({ children }) => (
            <del style={{ color: 'var(--r-ink-faint)' }}>{children}</del>
          ),
          input: (props: any) => {
            // GFM task list checkboxes — render as read-only visual markers.
            if (props.type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={!!props.checked}
                  readOnly
                  style={{ marginRight: 6, verticalAlign: 'middle', accentColor: 'var(--r-gold)' }}
                />
              );
            }
            return <input {...props} />;
          },
        }}
      >
        {annotated}
      </ReactMarkdown>
    </div>
  );
}
