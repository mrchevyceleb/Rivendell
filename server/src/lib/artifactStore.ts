import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';
import { JsonStore, type StoredRecord } from './jsonStore.ts';

export type ArtifactKind = 'html' | 'markdown' | 'text';

export type ArtifactSource = {
  kind: 'chat' | 'job' | 'email' | 'manual';
  ref?: string;
};

export type ArtifactRecord = StoredRecord & {
  id: string;
  kind: ArtifactKind;
  title: string;
  source?: ArtifactSource;
  contentFile: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
};

const ARTIFACTS_DIR = join(STATE_DIR, 'artifacts');
const metaStore = new JsonStore<ArtifactRecord>('artifacts.json', []);

const EXTENSIONS: Record<ArtifactKind, string> = {
  html: 'html',
  markdown: 'md',
  text: 'txt',
};

export const CONTENT_TYPES: Record<ArtifactKind, string> = {
  html: 'text/html; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  text: 'text/plain; charset=utf-8',
};

async function ensureDir(): Promise<void> {
  if (!existsSync(ARTIFACTS_DIR)) {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
  }
}

export async function listArtifacts(): Promise<ArtifactRecord[]> {
  const items = await metaStore.list();
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getArtifact(id: string): Promise<ArtifactRecord | null> {
  const items = await metaStore.list();
  return items.find((item) => item.id === id) ?? null;
}

export async function readArtifactContent(id: string): Promise<{ record: ArtifactRecord; content: string } | null> {
  const record = await getArtifact(id);
  if (!record) return null;
  const path = join(ARTIFACTS_DIR, record.contentFile);
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf8');
  return { record, content };
}

export async function createArtifact(input: {
  kind: ArtifactKind;
  title: string;
  content: string;
  source?: ArtifactSource;
}): Promise<ArtifactRecord> {
  await ensureDir();
  const id = randomUUID();
  const ext = EXTENSIONS[input.kind];
  const contentFile = `${id}.${ext}`;
  const absPath = join(ARTIFACTS_DIR, contentFile);
  await writeFile(absPath, input.content, 'utf8');

  const now = new Date().toISOString();
  const record: ArtifactRecord = {
    id,
    kind: input.kind,
    title: input.title,
    source: input.source,
    contentFile,
    byteSize: Buffer.byteLength(input.content, 'utf8'),
    createdAt: now,
    updatedAt: now,
  };

  await metaStore.create(record);
  return record;
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const record = await getArtifact(id);
  if (!record) return false;
  const path = join(ARTIFACTS_DIR, record.contentFile);
  if (existsSync(path)) {
    try {
      await unlink(path);
    } catch {
      // Best effort; metadata is still removed below.
    }
  }
  await metaStore.delete(id);
  return true;
}
