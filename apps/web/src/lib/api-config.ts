/**
 * Базовый URL для запросов к backend API.
 * Если задана переменная VITE_API_URL, используется удалённый бэкенд,
 * иначе запросы идут по относительному пути '/api' (same-origin / Vite proxy).
 */
export const API_BASE =
  ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')
    : '') || '') + '/api';
