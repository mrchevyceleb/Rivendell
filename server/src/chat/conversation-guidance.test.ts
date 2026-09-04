import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationGuidanceForTurn } from './conversation-guidance.ts';

test('adds conversation milestones only to visible human agent turns', () => {
  const direct = conversationGuidanceForTurn({ chatId: 'bot-kip' });
  assert.match(direct, /brief user-facing updates at natural milestones/);
  assert.equal(conversationGuidanceForTurn({ chatId: 'main' }), '');
  assert.equal(conversationGuidanceForTurn({ chatId: 'bot-kip', peerFrom: 'Max' }), '');
  assert.equal(conversationGuidanceForTurn({ chatId: 'bot-kip', peerFromRole: 'automation' }), '');
  assert.equal(conversationGuidanceForTurn({ chatId: 'bot-kip', hidden: true }), '');
});
