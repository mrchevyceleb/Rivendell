import { useState } from 'react';
import type { CompanionId } from '../data/types';
import { useBananaModel, useFireworksModel } from './useBananaModel';
import {
  normalizeCodexEffort,
  normalizeCodexModel,
  readStoredCodexEffort,
  readStoredCodexModel,
} from '../codexModels';
import { DEFAULT_CLAUDE_MODEL, normalizeClaudeModel } from '../components/CodexEnginePicker';

// Companion + model/effort selection for an embedded chat (the Workspace room).
// Unlike Hall, this exposes every engine family directly in one flat list.
// Claude Code and Codex use their normal local CLI profiles unless the server
// operator explicitly configures an account map.
//
// Model/effort choices share localStorage keys with Hall so a model pick in one
// place carries to the other; only the companion choice is panel-scoped.

// One entry per picker lane. `id` is the (string) selection key; `cli` is the
// engine the server runs; `account`, when set by a custom integration, pins a
// named profile. Public defaults do not select a machine-specific account.
export const WORKSPACE_COMPANIONS: {
  id: string;
  cli: CompanionId;
  account?: RepoAccount;
  label: string;
}[] = [
  { id: 'claude', cli: 'claude', label: 'Claude Code' },
  { id: 'codex', cli: 'codex', label: 'Codex' },
  { id: 'banana', cli: 'banana', label: 'OpenRouter' },
  { id: 'banana-fireworks', cli: 'banana-fireworks', label: 'Fireworks' },
  { id: 'banana-local', cli: 'banana-local', label: 'Local · LM Studio' },
  { id: 'zai', cli: 'zai', label: 'Z.ai · GLM' },
  { id: 'xai', cli: 'xai', label: 'xAI · Grok 4.6' },
];

// Optional named profile for custom/private picker extensions. Public entries
// intentionally leave this unset and use the CLI's normal local profile.
export type RepoAccount = string;

// Plain-words, one-line explanation of the ACTIVE lane's auth, shown under the
// picker so "which account is this?" is never a mystery.
export function companionAuthBlurb(cli: CompanionId, account: RepoAccount | null): string {
  const who = account ? 'the configured subscription login' : 'the login mapped to the selected repo';
  switch (cli) {
    case 'assistant':      return `Elrond on Claude Code, signed in as ${who}.`;
    case 'claude':         return `Claude Code, signed in as ${who}.`;
    case 'codex':           return `Codex, signed in as ${who}.`;
    case 'zai':              return 'GLM 5.3 via your Z.ai coding plan (no Claude or Codex login).';
    case 'xai':              return 'Grok 4.6 via your xAI coding plan (no Claude or Codex login).';
    case 'banana':           return 'OpenRouter, billed to your OpenRouter API key (no Claude or Codex login).';
    case 'banana-fireworks': return 'Fireworks, billed to your Fireworks API key (no Claude or Codex login).';
    case 'banana-local':     return 'A local model via an OpenAI-compatible server. No cloud account required.';
    default:                 return '';
  }
}

// Z.ai coding-plan models (Anthropic-compatible, run through the claude CLI).
// GLM 5.3 / 5.2 ids MUST carry the `[1m]` suffix to get the 1M context window;
// the bare ids serve the 200K variant and compact far too early.
export const DEFAULT_ZAI_MODEL = 'glm-5.3[1m]';
export const DEFAULT_ZAI_EFFORT = 'high';
export const ZAI_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_ZAI_MODEL, label: 'GLM 5.3 · 1M' },
  { id: 'glm-5.3-flash[1m]', label: 'GLM 5.3 Flash · 1M' },
  { id: 'glm-5.2[1m]', label: 'GLM 5.2 · 1M' },
  { id: 'glm-5.1', label: 'GLM 5.1 · 200K' },
];
// GLM's two real thinking-effort levels. Z.ai recommends Max for coding.
// (Claude Code maps low/medium/high -> GLM "high", xhigh/max -> GLM "max", so
// exposing more than these two would just be duplicate labels for the same two.)
export const ZAI_EFFORTS = ['high', 'max'];

export function normalizeZaiModel(model: string): string {
  // Canonicalize the 1M variants; leave 5.2 selectable after the 5.3 default bump.
  const normalized =
    model === 'glm-5.3' ? DEFAULT_ZAI_MODEL
    : model === 'glm-5.3-flash' ? 'glm-5.3-flash[1m]'
    : model === 'glm-5.2' ? 'glm-5.2[1m]'
    : model;
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
  // One-time bump: everyone who was on the old default (5.2) moves to 5.3.
  // 5.2 stays in the picker if someone re-selects it after this migration.
  let raw = localStorage.getItem('rivendell:zai-model') || DEFAULT_ZAI_MODEL;
  if (raw === 'glm-5.2' || raw === 'glm-5.2[1m]') {
    raw = DEFAULT_ZAI_MODEL;
    localStorage.setItem('rivendell:zai-model', raw);
  }
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
// redirected to https://api.x.ai). Grok 4.6 is the current coding-plan model.
export const DEFAULT_XAI_MODEL = 'grok-4.6';
// Grok's top thinking budget. Rivendell defaults the whole picker to xAI Grok
// 4.6 at max thinking, so this is the out-of-the-box reasoning level too.
export const DEFAULT_XAI_EFFORT = 'max';
export const XAI_MODELS: { id: string; label: string }[] = [
  { id: 'grok-4.6', label: 'Grok 4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5' },
];
// xAI's Anthropic endpoint accepts Claude Code's complete effort range and
// maps it onto Grok's thinking budget. Keep every selectable tier visible;
// collapsing this to High/Max made Low, Medium, and XHigh unreachable even
// though the server already validates and forwards them.
export const XAI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function normalizeXaiModel(model: string): string {
  return XAI_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_XAI_MODEL;
}

export function normalizeXaiEffort(effort: string): string {
  return XAI_EFFORTS.includes(effort) ? effort : DEFAULT_XAI_EFFORT;
}

export function readStoredXaiModel(): string {
  if (typeof window === 'undefined') return DEFAULT_XAI_MODEL;
  // One-time bump: everyone who was on the old default (4.5) moves to 4.6.
  // 4.5 stays in the picker if someone re-selects it after this migration.
  let raw = localStorage.getItem('rivendell:xai-model') || DEFAULT_XAI_MODEL;
  if (raw === 'grok-4.5') {
    raw = DEFAULT_XAI_MODEL;
    localStorage.setItem('rivendell:xai-model', raw);
  }
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
    // Default lane is xAI Grok 4.6 (see DEFAULT_XAI_* — max thinking). Also
    // migrate stale lanes removed from the picker (assistant / claude-personal /
    // codex-personal / any personal-* lane) to that default so a stored
    // selection doesn't silently fall through to the first lane on every load.
    const stored = readLS(storageKey, 'xai');
    const raw = stored === 'claude-kim' ? 'claude' : stored === 'codex-kim' ? 'codex' : stored;
    if (raw !== stored && typeof window !== 'undefined') localStorage.setItem(storageKey, raw);
    const valid = WORKSPACE_COMPANIONS.some((c) => c.id === raw);
    if (!valid || /personal/i.test(raw)) {
      if (typeof window !== 'undefined') localStorage.setItem(storageKey, 'xai');
      return 'xai';
    }
    return raw;
  });
  const setCompanion = (c: string) => {
    setCompanionState(c);
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, c);
  };
  // Resolve the selected lane to its engine + optional explicitly pinned account.
  const entry = WORKSPACE_COMPANIONS.find((c) => c.id === companion) ?? WORKSPACE_COMPANIONS[0];
  const account = entry.account ?? null;

  const bananaModel = useBananaModel();
  const fireworksModel = useFireworksModel();

  const [claudeModel, setClaudeModelState] = useState(() => normalizeClaudeModel(readLS('rivendell:claude-model', DEFAULT_CLAUDE_MODEL)));
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
  // Process-local, intentionally not persisted. A new device starts at zero,
  // while every actual picker click advances only that lane's revision—even if
  // the clicked value matches what that device already displayed.
  const [selectionRevisions, setSelectionRevisions] = useState<Record<string, number>>({});
  const markSelectionChanged = (lane: string) => {
    setSelectionRevisions((revisions) => ({
      ...revisions,
      [lane]: (revisions[lane] ?? 0) + 1,
    }));
  };

  const persist = (key: string, set: (v: string) => void, lane?: string) => (v: string) => {
    if (lane) markSelectionChanged(lane);
    set(v);
    if (typeof window !== 'undefined') localStorage.setItem(key, v);
  };
  const setClaudeModel = (value: string) => {
    markSelectionChanged('claude');
    const model = normalizeClaudeModel(value);
    setClaudeModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:claude-model', model);
  };
  const setClaudeEffort = persist('rivendell:claude-effort', setClaudeEffortState, 'claude');
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
    markSelectionChanged('zai');
    const model = normalizeZaiModel(v);
    setZaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-model', model);
  };
  const setZaiEffort = (v: string) => {
    markSelectionChanged('zai');
    const effort = normalizeZaiEffort(v);
    setZaiEffortState(effort);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:zai-effort', effort);
  };
  const setXaiModel = (v: string) => {
    markSelectionChanged('xai');
    const model = normalizeXaiModel(v);
    setXaiModelState(model);
    if (typeof window !== 'undefined') localStorage.setItem('rivendell:xai-model', model);
  };
  const setXaiEffort = (v: string) => {
    markSelectionChanged('xai');
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
    cli, account, model, effort, selectionRevision: selectionRevisions[companion] ?? 0,
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
