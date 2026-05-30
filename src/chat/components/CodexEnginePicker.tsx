// Model + reasoning-effort selector for the Codex companion. Mirrors the
// engines.json matrix (model IDs verified 2026-05-30). The chosen values ride
// the WS send/steer payload and reach `codex -m` / `-c model_reasoning_effort`.
const CODEX_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
  { id: 'gpt-5.3-codex-spark', label: 'Spark 5.3' },
];
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

export function CodexEnginePicker(props: {
  model: string;
  onModelChange: (m: string) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  disabled?: boolean;
}) {
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
        aria-label="Codex model"
        style={base}
        disabled={props.disabled}
        value={props.model}
        onChange={(e) => props.onModelChange(e.target.value)}
      >
        {CODEX_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <select
        aria-label="Reasoning effort"
        style={base}
        disabled={props.disabled}
        value={props.effort}
        onChange={(e) => props.onEffortChange(e.target.value)}
      >
        {CODEX_EFFORTS.map((e) => (
          <option key={e} value={e}>{`effort · ${e}`}</option>
        ))}
      </select>
    </>
  );
}
