import { useCallback, useEffect, useRef, useState } from 'react';
import { DiscoveryApiError, fetchAnalysis, type AnalysisResponse } from './api';

/** Как часто спрашивать статус, пока этап выполняется. */
export const POLL_MS = 1500;

export type AnalysisLoad =
  | { state: 'loading' }
  | { state: 'not_found' }
  | { state: 'error'; error: DiscoveryApiError }
  | ({ state: 'ready' } & AnalysisResponse);

const isRunning = (load: AnalysisLoad): boolean =>
  load.state === 'ready' &&
  (load.analysis.status === 'analyzing' || load.analysis.status === 'discovering');

/**
 * Анализ по id с опросом статуса, пока идёт этап. Остановка опроса — когда анализ ждёт ответов,
 * готов или упал; `refresh` — после действия пользователя (ответы, повтор).
 */
export function useAnalysis(id: string): { load: AnalysisLoad; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<AnalysisLoad>({ state: 'loading' });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchAnalysis(id);
      if (alive.current) setLoad({ state: 'ready', ...response });
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof DiscoveryApiError && error.status === 404) {
        setLoad({ state: 'not_found' });
        return;
      }
      setLoad((previous) =>
        // Сбой одного опроса не прячет уже показанный анализ: следующий опрос повторит запрос.
        previous.state === 'ready'
          ? previous
          : {
              state: 'error',
              error:
                error instanceof DiscoveryApiError
                  ? error
                  : new DiscoveryApiError('unknown_error', '', 0),
            },
      );
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    setLoad({ state: 'loading' });
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const running = isRunning(load);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [running, load, refresh]);

  return { load, refresh };
}
