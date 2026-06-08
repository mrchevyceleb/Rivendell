import { useState } from 'react';
import type { CompanionId } from '../data/types';
import { useBananaModel } from './useBananaModel';

// Companion + model/effort selection for an embedded chat (the Workspace room).
// Unlike Hall — which exposes assistant/codex/banana top-level tabs and reaches
// the personal accounts through a second "banana engine" picker — this exposes
// every engine directly in one flat list, which is what Matt wants in the side
// panel: pick KG vs personal Claude/Codex (or OpenRouter / Local) in one click.
//
// Model/effort choices share localStorage keys with Hall so a model pick in one
// place carries to the other; only the companion choice is panel-scoped.

export const WORKSPACE_COMPANIONS: { id: CompanionId; label: string }[] = [
  { id: 'assistant', label: 'Elrond · KG Claude' },
  { id: 'claude', label: 'Personal Claude' },
  { id: 'codex', label: 'KG Codex' },
  { id: 'codex-personal', label: 'Personal Codex' },
  { id: 'banana', label: 'OpenRouter' },
  { id: 'banana-local', label: 'Local · vLLM' },
];

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
}

export type CompanionPicker = ReturnType<typeof useCompanionPicker>;

export function useCompanionPicker(storageKey: string) {
  const [companion, setCompanionState] = useState<CompanionId>(
    () => (readLS(storageKey, 'assistant') as CompanionId),
  );
  const setCompanion = (c: CompanionId) => {
    setCompanionState(c);
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, c);
  };

  const bananaModel = useBananaModel();

  const [claudeModel, setClaudeModelState] = useState(() => readLS('rivendell:claude-model', 'claude-opus-4-8'));
  const [claudeEffort, setClaudeEffortState] = useState(() => readLS('rivendell:claude-effort', 'xhigh'));
  const [codexModel, setCodexModelState] = useState(() => readLS('rivendell:codex-model', 'gpt-5.5'));
  const [codexEffort, setCodexEffortState] = useState(() => readLS('rivendell:codex-effort', 'xhigh'));
  const [bananaEffort, setBananaEffortState] = useState(() => readLS('rivendell:banana-effort', 'medium'));
  const [localModel, setLocalModelState] = useState(() => readLS('rivendell:local-model', ''));

  const persist = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (typeof window !== 'undefined') localStorage.setItem(key, v);
  };
  const setClaudeModel = persist('rivendell:claude-model', setClaudeModelState);
  const setClaudeEffort = persist('rivendell:claude-effort', setClaudeEffortState);
  const setCodexModel = persist('rivendell:codex-model', setCodexModelState);
  const setCodexEffort = persist('rivendell:codex-effort', setCodexEffortState);
  const setBananaEffort = persist('rivendell:banana-effort', setBananaEffortState);
  const setLocalModel = persist('rivendell:local-model', setLocalModelState);

  const cli = companion;
  const isClaude = cli === 'assistant' || cli === 'claude';
  const isCodex = cli === 'codex' || cli === 'codex-personal';
  const isLocal = cli === 'banana-local';
  const isOpenRouter = cli === 'banana';

  const model =
    isLocal ? (localModel || undefined)
    : isOpenRouter ? bananaModel.model
    : isCodex ? codexModel
    : isClaude ? claudeModel
    : undefined;
  const effort =
    isCodex ? codexEffort
    : isClaude ? claudeEffort
    : (isOpenRouter || isLocal) ? bananaEffort
    : undefined;

  return {
    companion, setCompanion,
    cli, model, effort,
    isClaude, isCodex, isLocal, isOpenRouter,
    bananaModel,
    claudeModel, setClaudeModel, claudeEffort, setClaudeEffort,
    codexModel, setCodexModel, codexEffort, setCodexEffort,
    bananaEffort, setBananaEffort,
    localModel, setLocalModel,
  };
}
