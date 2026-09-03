import assert from 'node:assert/strict';
import test from 'node:test';
import { codexImageArgs, shouldRetryEmptyCodexTurn } from './codex-args.ts';

test('binds each Codex image path without consuming the positional prompt', () => {
  assert.deepEqual(
    codexImageArgs(['/tmp/receipt one.png', '/tmp/receipt-two.jpg']),
    ['--image=/tmp/receipt one.png', '--image=/tmp/receipt-two.jpg'],
  );
  assert.equal(codexImageArgs(['/tmp/receipt.png']).includes('--image'), false);
});

test('retries only a first empty Codex crash with no side-effect activity', () => {
  const emptyFailure = {
    code: 1,
    signal: null,
    producedAgentMessage: false,
    sawActionableItem: false,
    sawTurnCompleted: false,
    stderr: '',
    transientProjectConfigError: false,
    retryDepth: 0,
  } as const;
  assert.equal(shouldRetryEmptyCodexTurn(emptyFailure), true);
  assert.equal(shouldRetryEmptyCodexTurn({ ...emptyFailure, code: 0 }), true);
  assert.equal(shouldRetryEmptyCodexTurn({ ...emptyFailure, retryDepth: 1 }), false);
  assert.equal(shouldRetryEmptyCodexTurn({ ...emptyFailure, sawActionableItem: true }), false);
  assert.equal(shouldRetryEmptyCodexTurn({ ...emptyFailure, signal: 'SIGKILL', code: 137 }), false);
  assert.equal(shouldRetryEmptyCodexTurn({ ...emptyFailure, stderr: 'authentication failed' }), false);
});
