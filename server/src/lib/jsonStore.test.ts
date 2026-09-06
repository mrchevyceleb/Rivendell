import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from './jsonStore.ts';

type Item = { id: string; value: string };

test('JsonStore writes atomically and refuses to erase corrupt state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tardis-json-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'items.json');
  const store = new JsonStore<Item>('items.json', [], directory);

  await store.create({ value: 'kept' });
  assert.equal((await store.list())[0]?.value, 'kept');
  assert.deepEqual(await readdir(directory), ['items.json']);

  await writeFile(path, '{broken', 'utf8');
  await assert.rejects(() => store.list(), /refusing to overwrite stored data/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
