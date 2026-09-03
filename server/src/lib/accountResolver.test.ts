import assert from 'node:assert/strict';
import test from 'node:test';
import { accountEnv } from './accountResolver.ts';

test('Rivendell retry override wins while canonical Claude retry config is preserved', () => {
  const canonical = process.env.CLAUDE_CODE_MAX_RETRIES;
  const override = process.env.RIVENDELL_CLAUDE_MAX_RETRIES;
  try {
    process.env.CLAUDE_CODE_MAX_RETRIES = '4';
    delete process.env.RIVENDELL_CLAUDE_MAX_RETRIES;
    assert.equal(accountEnv('/tmp/rivendell-retry-test').CLAUDE_CODE_MAX_RETRIES, '4');

    process.env.RIVENDELL_CLAUDE_MAX_RETRIES = '2';
    assert.equal(accountEnv('/tmp/rivendell-retry-test').CLAUDE_CODE_MAX_RETRIES, '2');
  } finally {
    if (canonical === undefined) delete process.env.CLAUDE_CODE_MAX_RETRIES;
    else process.env.CLAUDE_CODE_MAX_RETRIES = canonical;
    if (override === undefined) delete process.env.RIVENDELL_CLAUDE_MAX_RETRIES;
    else process.env.RIVENDELL_CLAUDE_MAX_RETRIES = override;
  }
});
