import assert from 'node:assert/strict';
import test from 'node:test';
import { transformLocalLlmRequest } from './local-llm-proxy.ts';

test('strips grammar-hostile validation bounds without removing tool structure', () => {
  const request = {
    model: 'local-model',
    tools: [{
      type: 'function',
      function: {
        name: 'send_message',
        parameters: {
          type: 'object',
          required: ['text', 'format', 'minimum'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 4000, pattern: '.+' },
            count: { type: 'number', minimum: 1, maximum: 100000 },
            mode: { type: 'string', enum: ['fast', 'safe'] },
            // These names collide with JSON Schema keywords and must survive.
            format: { type: 'string', maxLength: 64 },
            minimum: { type: 'number', maximum: 10 },
          },
        },
      },
    }],
  };

  const transformed = transformLocalLlmRequest(JSON.stringify(request));
  const parsed = JSON.parse(transformed.body);
  const parameters = parsed.tools[0].function.parameters;
  assert.equal(transformed.removed, 7);
  assert.deepEqual(parameters.required, ['text', 'format', 'minimum']);
  assert.deepEqual(parameters.properties.mode.enum, ['fast', 'safe']);
  assert.deepEqual(parameters.properties.text, { type: 'string' });
  assert.deepEqual(parameters.properties.count, { type: 'number' });
  assert.deepEqual(parameters.properties.format, { type: 'string' });
  assert.deepEqual(parameters.properties.minimum, { type: 'number' });
});

test('leaves non-tool request bodies byte-for-byte unchanged', () => {
  const body = '{"model":"local","messages":[]}';
  assert.deepEqual(transformLocalLlmRequest(body), { body, removed: 0 });
});
