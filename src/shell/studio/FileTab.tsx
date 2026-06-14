import { Code2, Eye, MessageSquare, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { Button, Chip } from '../../components/Primitives';
import { fetchWorkspaceFileForEdit, saveWorkspaceFile } from '../../data/api';
import type { WorkspaceEditFileResponse } from '../../data/types';
import { useScribeSocket } from '../../hooks/useScribeSocket';

function languageExtension(lang: string) {
  switch (lang) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return javascript({ jsx: true });
    case 'ts': case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'json': return json();
    case 'md': case 'mdx': case 'markdown': return markdown();
    case 'py': return python();
    case 'css': return css();
    case 'html': return html();
    default: return null;
  }
}

const editorTheme = EditorView.theme({
  '&': { fontSize: '13px', fontFamily: 'var(--r-mono, ui-monospace, monospace)', background: 'var(--r-bg)', color: 'var(--r-ink)', height: '100%' },
  '.cm-content': { padding: '16px 24px', caretColor: 'var(--r-gold)', overflowWrap: 'anywhere' },
  '.cm-scroller': { overflowX: 'hidden' },
  '.cm-cursor': { borderLeftColor: 'var(--r-gold)' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: 'var(--r-bg)', borderRight: '1px solid var(--r-line)', color: 'var(--r-ink-faint)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--r-gold) 8%, transparent)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--r-gold) 5%, transparent)' },
  '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--r-elf-blue) 25%, transparent)' },
  '&.cm-focused .cm-selectionBackground': { background: 'color-mix(in srgb, var(--r-elf-blue) 30%, transparent)' },
}, { dark: true });

function CodeEditor({ value, language, onChange, onSave, readOnly }: {
  value: string; language: string; onChange: (v: string) => void; onSave: () => void; readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = useRef(value);

  useEffect(() => {
    if (!containerRef.current) return;
    const langExt = languageExtension(language);
    const saveKeymap = keymap.of([{ key: 'Mod-s', run: () => { onSaveRef.current(); return true; } }]);
    const extensions = [
      history(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      saveKeymap,
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newVal = update.state.doc.toString();
          valueRef.current = newVal;
          onChangeRef.current(newVal);
        }
      }),
      EditorView.lineWrapping,
      ...(langExt ? [langExt] : []),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: containerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === valueRef.current) return;
    valueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} style={{ height: '100%', overflow: 'auto' }} className="r-scroll" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileTab({
  id,
  path,
  onDirtyChange,
  onAskElrond,
}: {
  id: string;
  path: string;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onAskElrond: (path: string) => void;
}) {
  const [openDoc, setOpenDoc] = useState<WorkspaceEditFileResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [baselineModifiedAt, setBaselineModifiedAt] = useState<string | undefined>();
  const [loadingFile, setLoadingFile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [externalChange, setExternalChange] = useState<string | null>(null);

  const dirty = Boolean(openDoc?.editable && draft !== openDoc.content);

  useEffect(() => { onDirtyChange(id, dirty); }, [id, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(id, false), [id, onDirtyChange]);

  const loadFile = useCallback(async (p: string) => {
    setLoadingFile(true);
    setSaveError(null);
    setConflictInfo(null);
    setExternalChange(null);
    try {
      const doc = await fetchWorkspaceFileForEdit(p);
      setOpenDoc(doc);
      setDraft(doc.content);
      setBaselineModifiedAt(doc.modifiedAt);
      setViewMode('edit');
    } catch (err: any) {
      setSaveError(err?.message ?? String(err));
    } finally {
      setLoadingFile(false);
    }
  }, []);

  useEffect(() => { void loadFile(path); }, [path, loadFile]);

  const handleSave = useCallback(async () => {
    if (!openDoc || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setConflictInfo(null);
    try {
      const result = await saveWorkspaceFile(openDoc.path, draft, baselineModifiedAt);
      setOpenDoc((prev) => prev ? { ...prev, content: draft, modifiedAt: result.modifiedAt, size: result.size } : prev);
      setBaselineModifiedAt(result.modifiedAt);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes('409') || msg.includes('changed on disk')) setConflictInfo(msg);
      else setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [openDoc, dirty, saving, draft, baselineModifiedAt]);

  // Live-sync: Elrond edited this file on disk.
  const { events } = useScribeSocket();
  const lastEventRef = useRef<typeof events[number] | null>(null);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || last === lastEventRef.current) return;
    lastEventRef.current = last;
    const p = last.payload as any;
    if (p?.kind !== 'workspace-change' || p?.by === 'human') return;
    if (p?.op === 'change' && p?.path === path) {
      if (!dirty) void loadFile(path);
      else setExternalChange(`Elrond changed ${path}`);
    }
  }, [events, path, dirty, loadFile]);

  const isMarkdownView = openDoc?.language === 'md' || openDoc?.language === 'markdown' || (openDoc?.name?.endsWith('.md') ?? false);

  return (
    <div className="studio-filetab">
      <div className="studio-editor-header">
        <span className="studio-editor-lang">{openDoc?.language || 'file'}</span>
        <span className="studio-editor-path">{path}</span>
        {dirty && <Chip tone="gold">unsaved</Chip>}
        {saving && <Chip tone="neutral">saving…</Chip>}
        {!dirty && !saving && openDoc?.editable && <Chip tone="elf">saved</Chip>}
        {openDoc && !openDoc.editable && <Chip tone="rose">{openDoc.reason === 'binary' ? 'binary' : 'too large'}</Chip>}
        {openDoc && <Chip>{formatBytes(openDoc.size)}</Chip>}

        <div className="studio-editor-header-actions">
          {isMarkdownView && openDoc?.editable && (
            <Button tone="ghost" onClick={() => setViewMode((m) => m === 'edit' ? 'preview' : 'edit')}>
              {viewMode === 'edit' ? <><Eye size={13} /> Preview</> : <><Code2 size={13} /> Source</>}
            </Button>
          )}
          {openDoc?.editable && (
            <Button tone="gold" onClick={handleSave} disabled={!dirty || saving}>
              <Save size={13} /> Save
            </Button>
          )}
          <Button tone="ghost" onClick={() => onAskElrond(path)}>
            <MessageSquare size={13} /> Ask Elrond
          </Button>
        </div>
      </div>

      {saveError && <div className="studio-editor-banner rose">Save failed: {saveError}</div>}
      {conflictInfo && (
        <div className="studio-editor-banner gold">
          <span>⚠ Conflict: {conflictInfo}</span>
          <button onClick={() => { void loadFile(path); }}>Reload theirs</button>
          <button onClick={() => { void saveWorkspaceFile(path, draft).then((r) => { setBaselineModifiedAt(r.modifiedAt); setOpenDoc((p) => p ? { ...p, content: draft, modifiedAt: r.modifiedAt } : p); setConflictInfo(null); }); }}>Overwrite</button>
        </div>
      )}
      {externalChange && !conflictInfo && (
        <div className="studio-editor-banner elf">
          <span>Elrond is tending this file</span>
          {!dirty && <button onClick={() => { void loadFile(path); }}>Reload</button>}
        </div>
      )}

      <div className="studio-editor-body">
        {loadingFile ? (
          <div className="studio-editor-empty">Opening…</div>
        ) : !openDoc ? (
          <div className="studio-editor-empty">Could not open this file.</div>
        ) : !openDoc.editable ? (
          <div className="studio-editor-empty">
            {openDoc.reason === 'binary' ? (
              <>Binary file — <a href={`/api/files/raw?path=${encodeURIComponent(openDoc.path)}`} target="_blank" rel="noreferrer">Open in browser</a></>
            ) : (
              <>File too large to edit ({formatBytes(openDoc.size)}). Max 2 MB.</>
            )}
          </div>
        ) : isMarkdownView && viewMode === 'preview' ? (
          <div className="markdown-content r-scroll" style={{ padding: '16px 24px', height: '100%', overflowY: 'auto' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        ) : (
          <CodeEditor value={draft} language={openDoc.language} onChange={setDraft} onSave={handleSave} readOnly={!openDoc.editable} />
        )}
      </div>
    </div>
  );
}
