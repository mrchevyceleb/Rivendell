import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeObservedCronJob } from './assistantData.ts';

test('observed jobs normalize paused state with one source of truth', () => {
  const activeButPaused = normalizeObservedCronJob({
    id: 'one', name: 'One', schedule: '* * * * *', status: 'active', paused: true,
  });
  assert.equal(activeButPaused?.status, 'paused');
  assert.equal(activeButPaused?.paused, true);

  const pausedButFalse = normalizeObservedCronJob({
    id: 'two', name: 'Two', schedule: '* * * * *', status: 'paused', paused: false,
  });
  assert.equal(pausedButFalse?.status, 'paused');
  assert.equal(pausedButFalse?.paused, true);

  const failed = normalizeObservedCronJob({
    id: 'three', name: 'Three', schedule: '* * * * *', status: 'failed', paused: false,
  });
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.paused, false);
});

test('observed jobs reject missing UI-required fields and normalize defaults', () => {
  assert.equal(normalizeObservedCronJob({ id: 'missing', name: 'Missing' }), null);
  const normalized = normalizeObservedCronJob({ id: 'ok', name: 'Okay', schedule: 'manual' });
  assert.equal(normalized?.target, 'Okay');
  assert.equal(normalized?.runtime, 'local');
  assert.equal(normalized?.lastRun, 'observed externally');
  assert.equal(normalized?.readOnly, true);
});
