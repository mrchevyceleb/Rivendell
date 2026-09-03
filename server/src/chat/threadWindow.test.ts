import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVisibleTurns } from './threadWindow.ts';

test('recovered turns preserve an explicit warning when image pixels are unavailable', () => {
  const [turn] = extractVisibleTurns([{
    seq: 1,
    ev: {
      type: 'event',
      event: { type: '_user_echo', text: 'Log this receipt', imageCount: 1 },
    },
  }]);

  assert.equal(turn.role, 'user');
  assert.match(turn.text, /^Log this receipt/);
  assert.match(turn.text, /1 image was attached/);
  assert.match(turn.text, /do not infer them from earlier conversation/);
});

test('image-only turns remain visible during text-only context recovery', () => {
  const [turn] = extractVisibleTurns([{
    seq: 1,
    ev: {
      type: 'event',
      event: { type: '_user_echo', text: '', imageCount: 2 },
    },
  }]);

  assert.match(turn.text, /2 images were attached/);
});
