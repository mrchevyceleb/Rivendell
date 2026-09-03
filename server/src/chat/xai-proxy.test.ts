import assert from 'node:assert/strict';
import test from 'node:test';
import { isTransientXaiCapacity } from './xai-proxy.ts';

test('xAI proxy fast-retries transient capacity but not quota exhaustion', () => {
  assert.equal(isTransientXaiCapacity(503, ''), false);
  assert.equal(isTransientXaiCapacity(529, ''), false);
  assert.equal(isTransientXaiCapacity(429, JSON.stringify({
    code: 'resource-exhausted',
    error: 'The model is currently at capacity due to high demand.',
  })), true);
  assert.equal(isTransientXaiCapacity(429, JSON.stringify({
    code: 'resource-exhausted',
    error: 'Monthly quota exceeded.',
  })), false);
});
