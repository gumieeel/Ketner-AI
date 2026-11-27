/**
 * Страховка процесса от необработанных ошибок (инцидент 26.11.2026: Supabase закрыл соединение
 * с кодом 57P01, отклонённый промис некому было поймать, Node завершился, Render перезапустил
 * сервис).
 *
 * - `unhandledRejection` с временной ошибкой соединения (база закрыла или сбросила соединение,
 *   сеть оборвалась) — запись в лог, процесс работает дальше: postgres.js откроет новое соединение
 *   на следующем запросе.
 * - Любая другая необработанная ошибка — как раньше: запись в лог и выход с кодом 1, Render
 *   перезапускает процесс. Состояние после неизвестной ошибки не гарантировано.
 * - `uncaughtException` — запись в лог и выход с кодом 1, как раньше.
 */

/** Коды SQLSTATE: администратор/сервер закрыл соединение; ошибки соединения класса 08. */
const TRANSIENT_SQLSTATE = new Set(['57P01', '57P02', '57P03', '08000', '08003', '08006']);
/** Коды Node и postgres.js: соединение сброшено, отказано, по таймауту, закрыто или уничтожено. */
const TRANSIENT_CONNECTION = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'CONNECTION_ENDED',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
]);

/** Код ошибки: SQLSTATE у PostgresError, строковый код у ошибок Node и postgres.js. */
export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  if (typeof code === 'string' && code) return code;
  if (typeof errno === 'string' && errno) return errno;
  return null;
}

/** Временная ошибка соединения с базой или сетью: процесс может работать дальше. */
export function isTransientConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && (TRANSIENT_SQLSTATE.has(code) || TRANSIENT_CONNECTION.has(code));
}

/** Что от процесса нужно страховке; в тестах — свой EventEmitter. */
export type ProcessLike = Pick<NodeJS.EventEmitter, 'on' | 'off'>;

export interface SafetyNetOptions {
  proc?: ProcessLike;
  exit?: (code: number) => void;
  log?: (message: string, error?: unknown) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ставит обработчики на процесс; возвращает их снятие (для тестов). */
export function installProcessSafetyNet(options: SafetyNetOptions = {}): () => void {
  const proc = options.proc ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log =
    options.log ?? ((message: string, error?: unknown) => console.error(message, error ?? ''));

  const onRejection = (reason: unknown) => {
    const code = errorCode(reason) ?? 'нет';
    if (isTransientConnectionError(reason)) {
      // Стек здесь только из postgres.js и ничего не добавляет; код и текст — достаточно.
      log(
        `[process] необработанный отказ: временная ошибка соединения (код ${code}), работа продолжается: ${messageOf(reason)}`,
      );
      return;
    }
    log(`[process] необработанный отказ (код ${code}), процесс завершается`, reason);
    exit(1);
  };
  const onException = (error: Error) => {
    log(
      `[process] необработанное исключение (код ${errorCode(error) ?? 'нет'}), процесс завершается`,
      error,
    );
    exit(1);
  };

  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.off('unhandledRejection', onRejection);
    proc.off('uncaughtException', onException);
  };
}
