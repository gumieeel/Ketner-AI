import { getAuthToken } from '../auth/auth-store';
import { API_BASE } from '@/lib/api-config';
import type { QuotaReport } from './types';

/** Остаток запросов топ-моделей. null — без входа или если сервер не ответил (строка просто не видна). */
export async function fetchQuota(mode: 'standard' | 'max'): Promise<QuotaReport | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE}/usage/quota${mode === 'max' ? '?mode=max' : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) return null;
    return (await response.json()) as QuotaReport;
  } catch {
    return null;
  }
}
