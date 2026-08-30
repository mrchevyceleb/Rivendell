// Agent editor — create/edit a teammate: name, role, engine, scope doc.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { WORKSPACE_COMPANIONS } from '../chat/hooks/useCompanionPicker';
import { createAgent, updateAgentReq, deleteAgentReq, uploadAgentAvatar, removeAgentAvatar, agentAvatarUrl, agentColor, type Agent } from './agents';
import { GROK_VOICES } from '../voice/useGrokCall';

export type AgentEditorProps = {
  open: boolean;
  /** Present in edit mode. */
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onDeleted: (agent: Agent) => void;
};

export function AgentEditor({ open, agent, onClose, onSaved, onDeleted }: AgentEditorProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [engine, setEngine] = useState('xai');
  const [voice, setVoice] = useState('ara');
  const [pinned, setPinned] = useState(false);
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState<number | undefined>(undefined);
  const [dropHover, setDropHover] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const agentRef = useRef('');
  const savingRef = useRef(false);

  // Reset the form when the editor OPENS, or when it retargets to a
  // different agent (by id — object identity changes every agents poll, and
  // re-running this mid-edit would wipe the fields and steal the cursor).
  const agentId = agent?.id ?? '';
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) { wasOpenRef.current = false; return; }
    const reopened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!reopened && agentRef.current === agentId) return;
    agentRef.current = agentId;
    setName(agent?.name ?? '');
    setRole(agent?.role ?? '');
    setEngine(agent?.engine ?? 'xai');
    setVoice(agent?.voice ?? 'ara');
    setPinned(Boolean(agent?.pinned));
    setScope('');
    setErr(null);
    setAvatarVersion(undefined);
    if (agent) {
      fetch(`/api/agents/${encodeURIComponent(agent.id)}/scope`)
        .then((r) => r.text())
        .then(setScope)
        .catch(() => setScope(''));
    }
    if (reopened) nameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);

  // Keyed on `open` ONLY — inline `onClose` from the parent changes identity
  // every agents poll, which re-ran this effect and yanked focus back to a
  // stale element mid-typing (the "cursor keeps jumping" bug).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const applyAvatar = async (file: File) => {
    if (!agent || !file.type.startsWith('image/')) { setErr('Pick an image file.'); return; }
    setBusy(true); setErr(null);
    try {
      const updated = await uploadAgentAvatar(agent.id, file);
      setAvatarVersion(updated.avatar ?? Date.now());
      onSaved(updated);
    } catch (e) {
      setErr((e as Error).message || 'Upload failed');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (savingRef.current) return; // synchronous double-submit guard (busy state flushes too late)
    savingRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const saved = agent
        ? await updateAgentReq(agent.id, { name, role, engine, voice, pinned, scope: scope.trim() || undefined })
        : await createAgent({ name, role, engine, voice, scope: scope.trim() || undefined });
      onSaved(saved);
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Save failed');
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="bt-legal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={agent ? 'Edit agent' : 'New agent'}>
      <div className="bt-agent-editor bt-fade" onClick={(e) => e.stopPropagation()}>
        <div className="bt-agent-editor-head">
          <span className="bt-agent-editor-title">{agent ? `Edit ${agent.name}` : 'New agent'}</span>
          <button className="bt-iconbtn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        {agent ? (
          <div className="bt-avatar-row">
            <div
              className={`bt-avatar-preview${dropHover ? ' bt-avatar-drop' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
              onDragLeave={() => setDropHover(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropHover(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void applyAvatar(f);
              }}
              role="button"
              aria-label="Upload avatar"
              title="Click or drop a picture"
            >
              {(() => {
                const version = avatarVersion === -1 ? undefined : avatarVersion ?? agent.avatar;
                return version
                  ? <img src={`/api/agents/${encodeURIComponent(agent.id)}/avatar?v=${version}`} alt={agent.name} />
                  : <span style={{ background: agentColor(agent.name), width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#FCFCFC' }}>{agent.name.slice(0, 1).toUpperCase()}</span>;
              })()}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyAvatar(f); e.target.value = ''; }}
            />
            <div>
              <div className="bt-avatar-hint">Avatar — click the disc or drop a picture. Square-cropped to a round badge.</div>
              <div className="bt-avatar-btns">
                <button className="bt-avatar-btn" disabled={busy} onClick={() => fileRef.current?.click()}>Upload photo</button>
                {(avatarVersion ?? agent.avatar) ? (
                  <button className="bt-avatar-btn" disabled={busy} onClick={async () => {
                    setBusy(true); setErr(null);
                    try {
                      const updated = await removeAgentAvatar(agent.id);
                      setAvatarVersion(updated?.avatar ?? -1);
                      onSaved(updated ?? agent);
                    } catch (e) {
                      setErr((e as Error).message || 'Remove failed');
                    } finally { setBusy(false); }
                  }}>Remove</button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <label className="bt-agent-field">
          <span>Name</span>
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chief of Staff" maxLength={60} />
        </label>

        <label className="bt-agent-field">
          <span>Role — one line, shown under the name</span>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Coordination, plans, delegation" maxLength={120} />
        </label>

        <label className="bt-agent-field">
          <span>Engine — the brain this agent runs on</span>
          <select value={engine} onChange={(e) => setEngine(e.target.value)}>
            {WORKSPACE_COMPANIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        {agent ? (
          <label className="bt-agent-pinrow" title="Pinned agents show as bubbles at the top of the sidebar">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span>Pin to top — show as a bubble above the list</span>
          </label>
        ) : null}

        <label className="bt-agent-field">
          <span>Voice — how this agent sounds on calls</span>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            {GROK_VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>

        <label className="bt-agent-field">
          <span>Scope — who they are and what they do (markdown, editable here or in ~/.rivendell/personas/&lt;id&gt;.md)</span>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={9}
            placeholder={'# Name\n\nYou are …\n\n## What you do\n- …'}
            spellCheck={false}
          />
        </label>

        {err ? <div className="bt-agent-err">{err}</div> : null}

        <div className="bt-agent-editor-actions">
          {agent ? (
            <button
              className="bt-agent-btn danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Delete ${agent.name}? Its thread history stays on disk but the agent is removed.`)) return;
                setBusy(true);
                setErr(null);
                try {
                  await deleteAgentReq(agent.id);
                  onDeleted(agent);
                  onClose();
                } catch (e) {
                  setErr((e as Error).message || 'Delete failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete agent
            </button>
          ) : null}
          <button className="bt-agent-btn primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
