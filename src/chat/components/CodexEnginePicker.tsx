import { CODEX_MODELS, codexEffortsForModel } from '../codexModels';

// Model + reasoning-effort selector for Codex. The chosen values ride the WS
// send/steer payload and reach `codex -m` / `-c model_reasoning_effort`.
export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function CodexEnginePicker(props: {
  model: string;
  onModelChange: (m: string) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  disabled?: boolean;
  models?: { id: string; label: string }[];
  efforts?: string[];
  modelAriaLabel?: string;
  effortAriaLabel?: string;
  effortLabel?: string;
}) {
  const models = props.models ?? CODEX_MODELS;
  const efforts = props.efforts ?? codexEffortsForModel(props.model);
  const base = {
    fontSize: 12.5,
    border: '1px solid var(--rule, currentColor)',
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    padding: '2px 6px',
    cursor: (props.disabled ? 'not-allowed' : 'pointer') as 'not-allowed' | 'pointer',
    opacity: props.disabled ? 0.5 : 1,
  };
  return (
    <>
      <select
        aria-label={props.modelAriaLabel ?? 'Codex model'}
        style={base}
        disabled={props.disabled}
        value={props.model}
        onChange={(e) => props.onModelChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <select
        aria-label={props.effortAriaLabel ?? 'Reasoning effort'}
        style={base}
        disabled={props.disabled}
        value={props.effort}
        onChange={(e) => props.onEffortChange(e.target.value)}
      >
        {efforts.map((e) => (
          <option key={e} value={e}>{`${props.effortLabel ?? 'effort'} · ${e}`}</option>
        ))}
      </select>
    </>
  );
}
