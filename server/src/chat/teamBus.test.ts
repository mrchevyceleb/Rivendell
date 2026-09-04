import assert from 'node:assert/strict';
import test from 'node:test';
import { extendTeamChain, type TeamChain } from './teamBus.ts';

test('team chains have no arbitrary depth ceiling and stop only repeated edges', () => {
  let chain: TeamChain | undefined;
  for (let index = 0; index < 100; index += 1) {
    const next = extendTeamChain(chain, `agent-${index}`, `agent-${index + 1}`);
    assert.equal(next.repeatsEdge, false);
    chain = next.chain;
  }
  assert.equal(chain?.edges.length, 100);

  const returnViaNewEdge = extendTeamChain(chain, 'agent-100', 'agent-0');
  assert.equal(returnViaNewEdge.repeatsEdge, false);
  const repeated = extendTeamChain(returnViaNewEdge.chain, 'agent-0', 'agent-1');
  assert.equal(repeated.repeatsEdge, true);
  assert.equal(repeated.chain.edges.length, 101);
});
