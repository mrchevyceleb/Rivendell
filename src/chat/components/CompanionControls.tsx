import { Bot } from 'lucide-react';
import type { CompanionPicker } from '../hooks/useCompanionPicker';
import {
  WORKSPACE_COMPANIONS,
  ZAI_EFFORTS,
  ZAI_MODELS,
  XAI_EFFORTS,
  XAI_MODELS,
  companionAuthBlurb,
} from '../hooks/useCompanionPicker';
import { CodexEnginePicker, CLAUDE_MODELS, CLAUDE_EFFORTS } from './CodexEnginePicker';
import { ModelPicker } from './ModelPicker';
import { LocalModelPicker } from './LocalModelPicker';

// Compact companion + model/effort bar for the embedded Workspace chat. Picks
// the engine (KG vs personal Claude/Codex, OpenRouter, Local) and surfaces the
// right model/effort control for whichever engine is active.

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  border: '1px solid var(--r-line)',
  borderRadius: 7,
  background: 'var(--r-bg-card)',
  color: 'var(--r-ink)',
  padding: '4px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--r-body)',
};

const REASONING_EFFORT_OPTIONS = [
  { value: 'low', label: 'effort · low' },
  { value: 'medium', label: 'effort · medium' },
  { value: 'high', label: 'effort · high' },
];

const LOCAL_THINKING_OPTIONS = [
  { value: 'low', label: 'thinking · off' },
  { value: 'medium', label: 'thinking · auto' },
  { value: 'high', label: 'thinking · on' },
];

export function CompanionControls({ picker }: { picker: CompanionPicker }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 16px',
        borderBottom: '1px solid var(--r-line)',
        background: 'var(--r-bg-soft)',
      }}
    >
      <Bot size={14} style={{ color: 'var(--r-gold)', flexShrink: 0 }} />
      <select
        aria-label="Companion"
        style={selectStyle}
        value={picker.companion}
        onChange={(e) => picker.setCompanion(e.target.value as typeof picker.companion)}
      >
        {WORKSPACE_COMPANIONS.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>

      {picker.isClaude && (
        <CodexEnginePicker
          model={picker.claudeModel}
          onModelChange={picker.setClaudeModel}
          effort={picker.claudeEffort}
          onEffortChange={picker.setClaudeEffort}
          models={CLAUDE_MODELS}
          efforts={CLAUDE_EFFORTS}
        />
      )}

      {picker.isCodex && (
        <CodexEnginePicker
          model={picker.codexModel}
          onModelChange={picker.setCodexModel}
          effort={picker.codexEffort}
          onEffortChange={picker.setCodexEffort}
        />
      )}

      {picker.isOpenRouter && <ModelPicker state={picker.bananaModel} />}

      {picker.isFireworks && (
        <>
          <ModelPicker state={picker.fireworksModel} />
          <select
            aria-label="Reasoning effort"
            style={selectStyle}
            value={picker.bananaEffort}
            onChange={(e) => picker.setBananaEffort(e.target.value)}
          >
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </>
      )}

      {picker.isLocal && (
        <>
          <LocalModelPicker
            onActiveChange={(m) => picker.setLocalModel(m ?? '')}
            onContextChange={picker.setLocalContextWindow}
            onThinkingSupportChange={picker.setLocalSupportsThinking}
          />
          {picker.localSupportsThinking && (
            <select
              aria-label="Local thinking mode"
              style={selectStyle}
              value={picker.bananaEffort}
              onChange={(e) => picker.setBananaEffort(e.target.value)}
            >
              {LOCAL_THINKING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
        </>
      )}

      {picker.isZai && (
        <CodexEnginePicker
          model={picker.zaiModel}
          onModelChange={picker.setZaiModel}
          effort={picker.zaiEffort}
          onEffortChange={picker.setZaiEffort}
          models={ZAI_MODELS}
          efforts={ZAI_EFFORTS}
          modelAriaLabel="GLM model"
          effortAriaLabel="GLM thinking level"
          effortLabel="thinking"
        />
      )}

      {picker.isXai && (
        <CodexEnginePicker
          model={picker.xaiModel}
          onModelChange={picker.setXaiModel}
          effort={picker.xaiEffort}
          onEffortChange={picker.setXaiEffort}
          models={XAI_MODELS}
          efforts={XAI_EFFORTS}
          modelAriaLabel="Grok model"
          effortAriaLabel="Grok thinking level"
          effortLabel="thinking"
        />
      )}

      <span
        style={{
          flexBasis: '100%',
          margin: 0,
          fontSize: 11,
          lineHeight: 1.4,
          color: 'var(--r-ink-soft)',
        }}
      >
        {companionAuthBlurb(picker.cli, picker.account)}
      </span>
    </div>
  );
}
