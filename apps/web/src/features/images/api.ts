import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { API_BASE } from '@/lib/api-config';
import type { GeneratedImage, ImageAspect, ImageCapabilities } from './types';

export { ApiError };

function headers(json: boolean): Record<string, string> {
  const result: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const token = getAuthToken();
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function request<T>(path: string, init: RequestInit & { body?: string } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/images${path}`, {
    ...init,
    headers: {
      ...headers(init.body !== undefined),
      ...(init.headers as Record<string, string> | undefined),
    },
    credentials: 'include',
  });
  checkSessionInvalid(response);
  if (!response.ok) {
    let code = 'unknown_error';
    let message = `Запрос завершился со статусом ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // тело не JSON
    }
    throw new ApiError(code, message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Ссылки на файлы сервер отдаёт от корня (/api/images/...): приводим к адресу API. */
export function resolveImageUrl(url: string): string {
  return url.startsWith('/api/') ? `${API_BASE}${url.slice(4)}` : url;
}

export const imagesApi = {
  capabilities: () => request<ImageCapabilities>('/capabilities'),
  list: () => request<{ images: GeneratedImage[] }>('').then((body) => body.images),
  generate: (
    input: {
      prompt: string;
      modelId: string;
      aspect: ImageAspect;
      style: string;
      language: 'ru' | 'en';
    },
    signal?: AbortSignal,
  ) =>
    request<{ image: GeneratedImage; replacedBy: string | null }>('/generate', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  remove: (id: string) => request<void>(`/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
