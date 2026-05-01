import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';

// A literary-styled wrapper around react-markdown. Sam returns markdown by
// default, so text blocks render through this so bullets, bold, code, and
// links render properly instead of showing raw asterisks.

export function Markdown({ children }: { children: string }) {
  return (
    <div className="sw-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p style={{ margin: '0 0 8px', lineHeight: 1.55 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic' }}>{children}</em>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '4px 0 8px', paddingLeft: 22 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '4px 0 8px', paddingLeft: 22 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '2px 0', lineHeight: 1.5 }}>{children}</li>
          ),
          h1: ({ children }) => (
            <h3 style={{
              margin: '12px 0 6px',
              fontFamily: 'var(--serif-display)',
              fontSize: 20, fontWeight: 500,
            }}>{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 style={{
              margin: '10px 0 4px',
              fontFamily: 'var(--serif-display)',
              fontSize: 17, fontWeight: 500,
            }}>{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 style={{
              margin: '8px 0 2px',
              fontFamily: 'var(--serif-display)',
              fontSize: 15, fontWeight: 500,
            }}>{children}</h5>
          ),
          code: (props: any) => {
            const { inline, children, className } = props;
            if (inline ?? !className) {
              return <code className="sw-code-inline" style={{ wordBreak: 'break-all' }}>{children}</code>;
            }
            return (
              <pre style={{
                background: 'rgba(74,50,24,0.05)',
                border: '1px solid var(--rule-soft)',
                borderRadius: 2,
                padding: '8px 10px',
                margin: '8px 0',
                overflowX: 'auto',
                maxWidth: '100%',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--ink)',
                whiteSpace: 'pre',
              }}><code>{children}</code></pre>
            );
          },
          a: ({ href, children }: { href?: string; children?: ReactNode }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="sw-link"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '2px solid var(--rule)',
              margin: '8px 0',
              padding: '2px 0 2px 12px',
              color: 'var(--ink-2)',
              fontStyle: 'italic',
            }}>{children}</blockquote>
          ),
          hr: () => <hr className="sw-rule" style={{ margin: '12px 0' }} />,
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
            <thead style={{ borderBottom: '1px solid var(--rule)' }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th style={{
              textAlign: 'left',
              padding: '6px 12px 6px 0',
              fontWeight: 600,
              color: 'var(--ink)',
              fontFamily: 'var(--serif-display)',
              fontStyle: 'italic',
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '4px 12px 4px 0',
              borderTop: '1px solid var(--rule-soft)',
              verticalAlign: 'top',
            }}>{children}</td>
          ),
          del: ({ children }) => (
            <del style={{ color: 'var(--ink-faint)' }}>{children}</del>
          ),
          input: (props: any) => {
            // GFM task list checkboxes — render as read-only visual markers.
            if (props.type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={!!props.checked}
                  readOnly
                  style={{ marginRight: 6, verticalAlign: 'middle' }}
                />
              );
            }
            return <input {...props} />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
