import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { readSseStream } from '../chat/sse';
import { API_BASE } from '@/lib/api-config';
import type {
  AgentEvent,
  CodeCapabilities,
  CodeFileEntry,
  CodeProject,
  ImportResult,
  ThreadItem,
} from './types';

export { ApiError };

function authHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `Запрос завершился со статусом ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(body.error?.code ?? 'unknown_error', body.error?.message ?? fallback, response.status);
  } catch {
    return new ApiError('unknown_error', fallback, response.status);
  }
}

async function request<T>(path: string, init: RequestInit & { body?: string } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/code${path}`, {
    ...init,
    headers: { ...authHeaders(init.body !== undefined), ...(init.headers as Record<string, string> | undefined) },
    credentials: 'include',
  });
  checkSessionInvalid(response);
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

export const codeApi = {
  capabilities: () => request<CodeCapabilities>('/capabilities'),

  listProjects: async () => (await request<{ projects: CodeProject[] }>('/projects')).projects,
  getProject: (id: string) => request<{ project: CodeProject; running: boolean }>(`/projects/${enc(id)}`),
  createProject: async (input: { name: string; description?: string; template?: string }) =>
    (await request<{ project: CodeProject }>('/projects', { method: 'POST', body: JSON.stringify(input) })).project,
  importGithub: (input: { url: string; name?: string }) =>
    request<{ project: CodeProject } & ImportResult>('/projects/import-github', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  renameProject: async (id: string, name: string) =>
    (await request<{ project: CodeProject }>(`/projects/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })).project,
  deleteProject: (id: string) => request<void>(`/projects/${enc(id)}`, { method: 'DELETE' }),

  listFiles: (id: string) =>
    request<{ files: CodeFileEntry[]; fileCount: number; totalBytes: number }>(`/projects/${enc(id)}/files`),
  readFile: (id: string, path: string) =>
    request<{ path: string; content: string; size: number; language: string }>(
      `/projects/${enc(id)}/file?path=${enc(path)}`,
    ),
  writeFile: (id: string, path: string, content: string) =>
    request<{ file: CodeFileEntry; created: boolean; project?: CodeProject }>(`/projects/${enc(id)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  deleteFile: (id: string, path: string) =>
    request<{ removed: string[] }>(`/projects/${enc(id)}/file?path=${enc(path)}`, { method: 'DELETE' }),
  moveFile: (id: string, from: string, to: string) =>
    request<void>(`/projects/${enc(id)}/move`, { method: 'POST', body: JSON.stringify({ from, to }) }),
  importFiles: (id: string, files: Array<{ path: string; content: string }>) =>
    request<ImportResult>(`/projects/${enc(id)}/import`, { method: 'POST', body: JSON.stringify({ files }) }),

  /** Архив проекта скачивается через fetch с токеном, а не по ссылке: заголовок авторизации нужен. */
  async exportZip(id: string): Promise<{ blob: Blob; fileName: string }> {
    const response = await fetch(`${API_BASE}/code/projects/${enc(id)}/export.zip`, {
      headers: authHeaders(false),
      credentials: 'include',
    });
    if (!response.ok) throw await toApiError(response);
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob: await response.blob(), fileName: match?.[1] ?? 'project.zip' };
  },

  getThread: (id: string) => request<{ items: ThreadItem[]; running: boolean }>(`/projects/${enc(id)}/thread`),
  clearThread: (id: string) => request<void>(`/projects/${enc(id)}/thread`, { method: 'DELETE' }),
  stop: (id: string) => request<void>(`/projects/${enc(id)}/stop`, { method: 'POST' }),
};

export interface RunRequest {
  projectId: string;
  task: string;
  modelId: string;
  language: 'ru' | 'en';
  signal: AbortSignal;
}

/** Запускает агента и отдаёт события потока. Завершается, когда сервер закрыл поток. */
export async function streamAgentRun(request: RunRequest, onEvent: (event: AgentEvent) => void): Promise<void> {
  const response = await fetch(`${API_BASE}/code/projects/${enc(request.projectId)}/run`, {
    method: 'POST',
    headers: authHeaders(true),
    credentials: 'include',
    signal: request.signal,
    body: JSON.stringify({ task: request.task, modelId: request.modelId, language: request.language }),
  });
  checkSessionInvalid(response);
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError('empty_stream', 'Сервер не вернул поток', response.status);

  await readSseStream(response.body, (event) => {
    try {
      onEvent(JSON.parse(event.data) as AgentEvent);
    } catch {
      // повреждённое событие пропускаем: следующие разберутся
    }
  });
}
