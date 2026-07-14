import { useState } from 'react';
import type { CompanionId } from '../data/types';
import { useBananaModel, useFireworksModel } from './useBananaModel';
import {
  normalizeCodexEffort,
  normalizeCodexModel,
  readStoredCodexEffort,
  readStoredCodexModel,
} from '../codexModels';

// Companion + model/effort selection for an embedded chat (the Workspace room).
// Unlike Hall, this exposes every engine family directly in one flat list. For
// Claude Code and Codex, the selected repo decides KG vs personal through
// account-map.json.
//
// Model/effort choices share localStorage keys with Hall so a model pick in one
// place carries to the other; only the companion choice is panel-scoped.

// One entry per picker lane. `id` is the (string) selection key; `cli` is the
// engine the server runs; `account`, when set, PINS that login no matter the
// repo. Rivendell's picker is the only surface that overrides the per-repo
// account-map (terminals/AutoSam keep repo resolution) — the choice rides into
// the chat via useChat's chatId encoding and is forced at spawn server-side.
export const WORKSPACE_COMPANIONS: {
  id: string;
  cli: CompanionId;
  account?: RepoAccount;
  label: string;
}[] = [
  { id: 'claude-kim', cli: 'claude', account: 'kim', label: 'Claude · kim' },
  { id: 'codex-kim', cli: 'codex', account: 'kim', label: 'Codex · kim' },
  { id: 'banana', cli: 'banana', label: 'OpenRouter' },
  { id: 'banana-fireworks', cli: 'banana-fireworks', label: 'Fireworks' },
  { id: 'banana-local', cli: 'banana-local', label: 'Local · LM Studio' },
  { id: 'zai', cli: 'zai', label: 'Z.ai · GLM' },
  { id: 'xai', cli: 'xai', label: 'xAI · Grok 4.5' },
];

// The two logins Rivendell can pin a lane to. The canonical account map lives
// at ~/samwise/.accounts/account-map.json (consumed server-side); these are the
// only two accounts configured on Moria.
export type RepoAccount = 'kim' | 'personal';

// Plain-words, one-line explanation of the ACTIVE lane's auth, shown under the
// picker so "which account is this?" is never a mystery.
export function companionAuthBlurb(cli: CompanionId, account: RepoAccount | null): string {
  const who =
    account === 'kim' ? 'the kim login (R-Link / Kim Garst)'
    : account === 'personal' ? 'your personal login'
    : 'the login mapped to the selected repo';
  switch (cli) {
    case 'assistant':      return `Elrond on Claude Code, signed in as ${who}.`;
    case 'claude':         return `Claude Code, signed in as ${who}.`;
    case 'codex':           return `Codex, signed in as ${who}.`;
    case 'zai':              return 'GLM 5.2 via your Z.ai coding plan (no Claude or Codex login).';
    case 'xai':              return 'Grok 4.5 via your xAI coding plan (no Claude or Codex login).';
    case 'banana':           return 'OpenRouter, billed to your OpenRouter API key (no Claude or Codex login).';
    case 'banana-fireworks': return 'Fireworks, billed to your Fireworks API key (no Claude or Codex login).';
    case 'banana-local':     return 'A local model on Moria via LM Studio. No account, no cloud cost.';
    default:                 return '';
  }
}

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

// xAI coding-plan models (Anthropic-compatible, run through the claude CLI
// redirected to https://api.x.ai). Grok 4.5 is the current coding-plan model.
export const DEFAULT_XAI_MODEL = 'grok-4.5';
export const DEFAULT_XAI_EFFORT = 'high';
export const XAI_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_XAI_MODEL, label: 'Grok 4.5' },
];
// xAI's Anthropic endpoint maps Claude Code's effort onto Grok's thinking
// budget. Exposing the full range would mostly duplicate the same behavior;
// offer the two meaningful levels, matching the GLM picker.
export const XAI_EFFORTS = ['high', 'max'];

export function normalizeXaiModel(model: string): string {
  return XAI_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_XAI_MODEL;
}

export function normalizeXaiEffort(effort: string): string {
  return XAI_EFFORTS.includes(effort) ? effort : DEFAULT_XAI_EFFORT;
}

export function readStoredXaiModel(): string {
  if (typeof window === 'undefined') return DEFAULT_XAI_MODEL;
  const raw = localStorage.getItem('rivendell:xai-model') || DEFAULT_XAI_MODEL;
  const model = normalizeXaiModel(raw);
  if (model !== raw) localStorage.setItem('rivendell:xai-model', model);
  return model;
}

export function readStoredXaiEffort(): string {
  if (typeof window === 'undefined') return DEFAULT_XAI_EFFORT;
  const raw = localStorage.getItem('rivendell:xai-effort') || DEFAULT_XAI_EFFORT;
  const effort = normalizeXaiEffort(raw);
  if (effort !== raw) localStorage.setItem('rivendell:xai-effort', effort);
  return effort;
}

export type CompanionPicker = ReturnType<typeof useCompanionPicker>;

export function useCompanionPicker(storageKey: string) {
  const [companion, setCompanionState] = useState<string>(() => {
    // Migrate stale lanes removed from the picker (assistant / claude-personal /
    // codex-personal) to the new default so a stored selection doesn't silently
    // fall through to the first lane on every load.
    const raw = readLS(storageKey, 'claude-kim');
    const valid = WORKSPACE_COMPANIONS.some((c) => c.id === raw);
    if (!valid) {
      if (typeof window !== 'undefined') localStorage.setItem(storageKey, 'claude-kim');
      return 'claude-kim';
    }
    return raw;
  });
  const setCompanion = (c: string) => {
    setCompanionState(c);
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, c);
  };
  // Resolve the selected lane to its engine + (optional) pinned account. A stale
  // stored id (e.g. a pre-account-lanes 'claude') falls back to the first lane.
  const entry = WORKSPACE_COMPANIONS.find((c) => c.id === companion) ?? WORKSPACE_COMPANIONS[0];
  const account = entry.account ?? null;

  const bananaModel = useBananaModel();
  const fireworksModel = useFireworksModel();

  const [claudeModel, setClaudeModelState] = useState(() => readLS('rivendell:claude-model', 'claude-opus-4-8'));
  const [claudeEffort, setClaudeEffortState] = useState(() => readLS('rivendell:claude-effort', 'xhigh'));
  const [codexModel, setCodexModelState] = useState(readStoredCodexModel);
  const [codexEffort, setCodexEffortState] = useState(() => readStoredCodexEffort(codexModel));
  const [zaiModel, setZaiModelState] = useState(readStoredZaiModel);
  const [zaiEffort, setZaiEffortState] = useState(readStoredZaiEffort);
  const [xaiModel, setXaiModelState] = useState(readStoredXaiModel);
  const [xaiEffort, setXaiEffortState] = useState(readStoredXaiEffort);
  const [bananaEffort, setBananaEffortState] = useState(() => readLS('rivendell:banana-effort', 'medium'));
  const [localModel, setLocalModelState] = useState(() => readLS('rivendell:local-model', ''));
  const [localContextWindow, setLocalContextWindow] = useState<number | null>(null);
  const [localSupportsThinking, setLocalSupportsThinking] = useState(false);

  const persist = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (typeof window !== 'undefined') localStorage.setItem(key, v);
  };
  const setClaudeModel = persist('rivendell:claude-model', setClaudeModelState);
  const setClaudeEffort = persist('rivendell:claude-effort', setClaudeEffortState);
  const setCodexModel = (value: string) => {
    const model = normalizeCodexModel(value);
    const effort = normalizeCodexEffort(model, codexEffort);
    setCodexModelState(model);
    setCodexEffortState(effort);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rivendell:codex-model', model);
      localStorage.setItem('rivendell:codex-effort', effort);
    }
  };
  const setCodexEffort = (value: string) => {
    const effort = normalizeCodexEffort(codexModel, value);
    setCodexEffortState(effort);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rivendell:codex-effort', effort);
    }
  };
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
  const setXaiModel = (v: string) => {
    const model = normalizeXaiModel(v);
    setXaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:xai-model', model);
  };
  const setXaiEffort = (v: string) => {
    const effort = normalizeXaiEffort(v);
    setXaiEffortState(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:xai-effort', effort);
  };
  const setBananaEffort = persist('rivendell:banana-effort', setBananaEffortState);
  const setLocalModel = persist('rivendell:local-model', setLocalModelState);

  const cli = entry.cli;
  const isClaude = cli === 'assistant' || cli === 'claude';
  const isCodex = cli === 'codex';
  const isLocal = cli === 'banana-local';
  const isOpenRouter = cli === 'banana';
  const isFireworks = cli === 'banana-fireworks';
  const isZai = cli === 'zai';
  const isXai = cli === 'xai';

  const model =
    isZai ? zaiModel
    : isXai ? xaiModel
    : isLocal ? (localModel || undefined)
    : isOpenRouter ? bananaModel.model
    : isFireworks ? fireworksModel.model
    : isCodex ? codexModel
    : isClaude ? claudeModel
    : undefined;
  const effort =
    isCodex ? codexEffort
    : isZai ? zaiEffort
    : isXai ? xaiEffort
    : isClaude ? claudeEffort
    : (isOpenRouter || isLocal || isFireworks) ? bananaEffort
    : undefined;

  return {
    companion, setCompanion,
    cli, account, model, effort,
    isClaude, isCodex, isLocal, isOpenRouter, isFireworks, isZai, isXai,
    bananaModel,
    fireworksModel,
    claudeModel, setClaudeModel, claudeEffort, setClaudeEffort,
    codexModel, setCodexModel, codexEffort, setCodexEffort,
    zaiModel, setZaiModel, zaiEffort, setZaiEffort,
    xaiModel, setXaiModel, xaiEffort, setXaiEffort,
    bananaEffort, setBananaEffort,
    localModel, setLocalModel, localContextWindow, setLocalContextWindow,
    localSupportsThinking, setLocalSupportsThinking,
  };
}
