import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';

export type StoredRecord = { id: string; createdAt?: string; updatedAt?: string };

export class JsonStore<T extends StoredRecord> {
  private readonly path: string;

  constructor(fileName: string, private readonly seed: T[]) {
    this.path = join(STATE_DIR, fileName);
  }

  async list(): Promise<T[]> {
    return this.read();
  }

  async create(input: Omit<Partial<T>, 'id'> & { id?: string }): Promise<T> {
    const now = new Date().toISOString();
    const item = { id: input.id ?? randomUUID(), createdAt: now, updatedAt: now, ...input } as T;
    const items = await this.read();
    await this.write([item, ...items]);
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const items = await this.read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const next = { ...items[index], ...patch, id, updatedAt: new Date().toISOString() } as T;
    items[index] = next;
    await this.write(items);
    return next;
  }

  async delete(id: string): Promise<boolean> {
    const items = await this.read();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    await this.write(next);
    return true;
  }

  async replace(items: T[]): Promise<T[]> {
    await this.write(items);
    return items;
  }

  private async read(): Promise<T[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // Seed below.
    }
    await this.write(this.seed);
    return [...this.seed];
  }

  private async write(items: T[]): Promise<void> {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(this.path, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  }
}
