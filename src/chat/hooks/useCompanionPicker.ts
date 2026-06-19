import { useState } from 'react';
import type { CompanionId } from '../data/types';
import { useBananaModel, useFireworksModel } from './useBananaModel';

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
  { id: 'banana-fireworks', label: 'Fireworks' },
  { id: 'banana-local', label: 'Local · LM Studio' },
  { id: 'zai', label: 'Z.ai · GLM' },
];

// Z.ai coding-plan models (Anthropic-compatible, run through the claude CLI).
// GLM 5.2's id MUST carry the `[1m]` suffix to get its 1M context window; bare
// `glm-5.2` serves the 200K variant and compacts far too early.
export const DEFAULT_ZAI_MODEL = 'glm-5.2[1m]';
export const DEFAULT_ZAI_EFFORT = 'high';
export const ZAI_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_ZAI_MODEL, label: 'GLM 5.2 · 1M' },
  { id: 'glm-5.1', label: 'GLM 5.1 · 200K' },
];
// GLM-5.2's two real thinking-effort levels. Z.ai recommends Max for coding.
// (Claude Code maps low/medium/high -> GLM "high", xhigh/max -> GLM "max", so
// exposing more than these two would just be duplicate labels for the same two.)
export const ZAI_EFFORTS = ['high', 'max'];

export function normalizeZaiModel(model: string): string {
  // Migrate the legacy bare `glm-5.2` to the 1M id.
  const normalized = model === 'glm-5.2' ? DEFAULT_ZAI_MODEL : model;
  return ZAI_MODELS.some((entry) => entry.id === normalized) ? normalized : DEFAULT_ZAI_MODEL;
}

export function normalizeZaiEffort(effort: string): string {
  return ZAI_EFFORTS.includes(effort) ? effort : DEFAULT_ZAI_EFFORT;
}

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
}

export function readStoredZaiModel(): string {
  if (typeof window === 'undefined') return DEFAULT_ZAI_MODEL;
  const raw = localStorage.getItem('rivendell:zai-model') || DEFAULT_ZAI_MODEL;
  const model = normalizeZaiModel(raw);
  if (model !== raw) localStorage.setItem('rivendell:zai-model', model);
  return model;
}

export function readStoredZaiEffort(): string {
  if (typeof window === 'undefined') return DEFAULT_ZAI_EFFORT;
  const raw = localStorage.getItem('rivendell:zai-effort') || DEFAULT_ZAI_EFFORT;
  const effort = normalizeZaiEffort(raw);
  if (effort !== raw) localStorage.setItem('rivendell:zai-effort', effort);
  return effort;
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
  const fireworksModel = useFireworksModel();

  const [claudeModel, setClaudeModelState] = useState(() => readLS('rivendell:claude-model', 'claude-opus-4-8'));
  const [claudeEffort, setClaudeEffortState] = useState(() => readLS('rivendell:claude-effort', 'xhigh'));
  const [codexModel, setCodexModelState] = useState(() => readLS('rivendell:codex-model', 'gpt-5.5'));
  const [codexEffort, setCodexEffortState] = useState(() => readLS('rivendell:codex-effort', 'xhigh'));
  const [zaiModel, setZaiModelState] = useState(readStoredZaiModel);
  const [zaiEffort, setZaiEffortState] = useState(readStoredZaiEffort);
  const [bananaEffort, setBananaEffortState] = useState(() => readLS('rivendell:banana-effort', 'medium'));
  const [localModel, setLocalModelState] = useState(() => readLS('rivendell:local-model', ''));
  const [localContextWindow, setLocalContextWindow] = useState<number | null>(null);

  const persist = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (typeof window !== 'undefined') localStorage.setItem(key, v);
  };
  const setClaudeModel = persist('rivendell:claude-model', setClaudeModelState);
  const setClaudeEffort = persist('rivendell:claude-effort', setClaudeEffortState);
  const setCodexModel = persist('rivendell:codex-model', setCodexModelState);
  const setCodexEffort = persist('rivendell:codex-effort', setCodexEffortState);
  const setZaiModel = (v: string) => {
    const model = normalizeZaiModel(v);
    setZaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-model', model);
  };
  const setZaiEffort = (v: string) => {
    const effort = normalizeZaiEffort(v);
    setZaiEffortState(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-effort', effort);
  };
  const setBananaEffort = persist('rivendell:banana-effort', setBananaEffortState);
  const setLocalModel = persist('rivendell:local-model', setLocalModelState);

  const cli = companion;
  const isClaude = cli === 'assistant' || cli === 'claude';
  const isCodex = cli === 'codex' || cli === 'codex-personal';
  const isLocal = cli === 'banana-local';
  const isOpenRouter = cli === 'banana';
  const isFireworks = cli === 'banana-fireworks';
  const isZai = cli === 'zai';

  const model =
    isZai ? zaiModel
    : isLocal ? (localModel || undefined)
    : isOpenRouter ? bananaModel.model
    : isFireworks ? fireworksModel.model
    : isCodex ? codexModel
    : isClaude ? claudeModel
    : undefined;
  const effort =
    isCodex ? codexEffort
    : isZai ? zaiEffort
    : isClaude ? claudeEffort
    : (isOpenRouter || isLocal || isFireworks) ? bananaEffort
    : undefined;

  return {
    companion, setCompanion,
    cli, model, effort,
    isClaude, isCodex, isLocal, isOpenRouter, isFireworks, isZai,
    bananaModel,
    fireworksModel,
    claudeModel, setClaudeModel, claudeEffort, setClaudeEffort,
    codexModel, setCodexModel, codexEffort, setCodexEffort,
    zaiModel, setZaiModel, zaiEffort, setZaiEffort,
    bananaEffort, setBananaEffort,
    localModel, setLocalModel, localContextWindow, setLocalContextWindow,
  };
}
