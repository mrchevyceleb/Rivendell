import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalProviderError } from './providerErrors.ts';

test('xAI capacity errors are not mislabeled as account rate limits', () => {
  const error = terminalProviderError('xai', {
    type: 'result',
    api_error_status: 429,
    errors: [{ message: 'resource-exhausted: The model is currently at capacity due to high demand.' }],
  });
  assert.equal(error?.message, 'xAI is temporarily at capacity. Try again in a few minutes or switch brains.');
  assert.equal(error?.retryable, true);
});

test('resource-exhausted quota errors remain rate-limit errors', () => {
  const error = terminalProviderError('xai', {
    type: 'result',
    api_error_status: 429,
    errors: [{ message: 'resource-exhausted: monthly quota exceeded' }],
  });
  assert.equal(error?.message, "xAI's usage window is full, so this turn could not run. Switch brains or try again after the limit resets.");
});
