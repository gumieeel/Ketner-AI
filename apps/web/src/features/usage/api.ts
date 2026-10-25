import { getAuthToken } from '../auth/auth-store';
import { API_BASE } from '@/lib/api-config';
import type { CreditsReport } from './types';

/** Остаток кредитов и цена запроса моделей. null — без входа или если сервер не ответил (строка просто не видна). */
export async function fetchCredits(mode: 'standard' | 'max'): Promise<CreditsReport | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(`${API_BASE}/usage/credits${mode === 'max' ? '?mode=max' : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) return null;
    return (await response.json()) as CreditsReport;
  } catch {
    return null;
  }
}
