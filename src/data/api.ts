import type { FileTreeNode, WorkspaceEditFileResponse, WorkspaceSaveResponse } from './types';

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function fetchWorkspaceFileForEdit(path: string): Promise<WorkspaceEditFileResponse> {
  return apiJson<WorkspaceEditFileResponse>(`/api/docs/file/edit?path=${encodeURIComponent(path)}`);
}

export function saveWorkspaceFile(path: string, content: string, expectedModifiedAt?: string): Promise<WorkspaceSaveResponse> {
  return apiJson<WorkspaceSaveResponse>('/api/docs/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content, expectedModifiedAt }),
  });
}

export function createWorkspaceEntry(path: string, kind: 'file' | 'directory'): Promise<{ node: FileTreeNode }> {
  return apiJson<{ node: FileTreeNode }>('/api/docs/file', {
    method: 'POST',
    body: JSON.stringify({ path, kind }),
  });
}

export function renameWorkspaceEntry(from: string, to: string): Promise<{ path: string }> {
  return apiJson<{ path: string }>('/api/docs/rename', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

export function deleteWorkspaceEntry(path: string): Promise<{ path: string }> {
  return apiJson<{ path: string }>(`/api/docs/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export type WorkspaceUploadResponse = { path: string; size: number; modifiedAt: string };

/** Send a file to the ship's workspace. The server keeps it under `path`,
 *  adding a numeric suffix rather than overwriting. */
export async function uploadWorkspaceFile(path: string, file: Blob): Promise<WorkspaceUploadResponse> {
  const response = await fetch(`/api/files/upload?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain text */
    }
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as WorkspaceUploadResponse;
}
