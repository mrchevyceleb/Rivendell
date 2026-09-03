import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestEventLogSeq,
  normalizeEventLogSequence,
  reserveEventLogSeq,
} from './event-log-store.ts';

test('repairs cross-engine sequence regressions in durable file order', () => {
  const input = [
    JSON.stringify({ seq: 8, ev: { type: 'event', event: { type: '_user_echo', text: 'one' } } }),
    JSON.stringify({ seq: 9, ev: { type: 'turnEnd' } }),
    JSON.stringify({ seq: 4, ev: { type: 'event', event: { type: '_user_echo', text: 'late' } } }),
    JSON.stringify({ seq: 4, ev: { type: 'turnEnd' } }),
  ];

  const result = normalizeEventLogSequence(input);
  assert.equal(result.repaired, true);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line).seq), [8, 9, 10, 11]);
  assert.equal(JSON.parse(result.lines[2]).ev.event.text, 'late');
});

test('moves a repaired tail above every cursor from the old file', () => {
  const result = normalizeEventLogSequence([
    JSON.stringify({ seq: 100, ev: { type: 'turnEnd' } }),
    JSON.stringify({ seq: 50, ev: { type: 'event', event: { type: 'assistant' } } }),
    JSON.stringify({ seq: 101, ev: { type: 'turnEnd' } }),
  ]);
  assert.deepEqual(result.lines.map((line) => JSON.parse(line).seq), [100, 102, 103]);
});

test('shares one monotonic allocator across native sessions for the same log', () => {
  const key = `test-thread-${process.pid}-${Date.now()}`;
  assert.equal(reserveEventLogSeq(key, 20), 20);
  assert.equal(reserveEventLogSeq(key, 3), 21);
  assert.equal(latestEventLogSeq(key, 0), 21);
});
