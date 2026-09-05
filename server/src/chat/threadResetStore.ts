import { JsonStore, type StoredRecord } from '../lib/jsonStore.ts';

type ThreadResetRecord = StoredRecord & {
  resetAt: number;
};

const store = new JsonStore<ThreadResetRecord>('thread-resets.json', []);
let writeQueue: Promise<void> = Promise.resolve();

/** Load durable Fresh generations before chat sockets begin admitting work. */
export async function loadThreadResetEpochs(): Promise<Map<string, number>> {
  const records = await store.list();
  const epochs = new Map<string, number>();
  for (const record of records) {
    if (typeof record.id !== 'string' || !record.id) continue;
    if (!Number.isFinite(record.resetAt) || record.resetAt <= 0) continue;
    epochs.set(record.id, Math.max(epochs.get(record.id) ?? 0, record.resetAt));
  }
  return epochs;
}

/** Persist the reset generation before destructive Fresh work starts. Calls are
 * serialized so simultaneous resets on different threads cannot lose a row. */
export function persistThreadResetEpoch(logKey: string, resetAt: number): Promise<void> {
  const write = async () => {
    const records = await store.list();
    const nextResetAt = Math.max(
      resetAt,
      records.find((record) => record.id === logKey)?.resetAt ?? 0,
    );
    const next: ThreadResetRecord = {
      id: logKey,
      resetAt: nextResetAt,
      updatedAt: new Date(nextResetAt).toISOString(),
    };
    const index = records.findIndex((record) => record.id === logKey);
    if (index >= 0) records[index] = next;
    else records.push(next);
    await store.replace(records);
  };
  writeQueue = writeQueue.then(write, write);
  return writeQueue;
}
