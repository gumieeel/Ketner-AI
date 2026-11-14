/**
 * Секреты в метаданных журналов исполнений: поиск, очистка перед записью и безопасная запись.
 *
 * ЭТО НЕ ГРАНИЦА БЕЗОПАСНОСТИ. Правила ловят типичные утечки (поле `accessToken` со строкой, ключ
 * `sk-…`, `Bearer …` с токеном) и пропускают безобидное (имя поля в JSON-схеме, слово «bearer» в
 * тексте). Секрет в неожиданном виде (например, токен без префикса в поле `note`) они не найдут.
 * Защита данных — в том, что журналы получают только метаданные (размеры, имена полей, отпечатки,
 * короткие безопасные выдержки), а не содержимое; эти правила — последняя страховка.
 *
 * Те же правила повторяет функция базы `platform_contains_secret(jsonb)`
 * (docs/PERSISTENCE_SLICE_A.sql). Там она — сигнальная проверка (tripwire): код очищает метаданные
 * до записи, и проверка базы срабатывать не должна. Совпадение правил проверяют общий набор примеров
 * (secret-corpus.ts) в тестах кода и в стенде на настоящем Postgres.
 */

/** Имена полей, строковое значение которых считается секретом (после нормализации: строчные, без `_`, `-`, точек). */
const SECRET_KEY = /(token|secret|password|passwd|apikey|privatekey|cookie|tokendata)$/;
/** Значение заголовка авторизации: схема и токен. */
const AUTH_HEADER_VALUE = /^(bearer|basic|token|digest)\s+\S{8,}/i;
/** Отметка об очистке: такое значение секретом не считается. */
export const REDACTION = /^\[redacted(:[a-z_]+)?\]$/;

/** Форматы токенов, которые ищутся в любом строковом значении, в том числе внутри текста. */
const TOKEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['api_key', /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{19,}/],
  ['stripe_key', /\b[rs]k_(live|test)_[A-Za-z0-9]{10,}/],
  ['github_token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['aws_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['telegram_bot_token', /\b[0-9]{8,10}:[A-Za-z0-9_-]{35}/],
  // «Bearer» и токен от 20 символов, в котором есть цифра: слово «bearer» в тексте не срабатывает.
  [
    'bearer_token',
    /[Bb][Ee][Aa][Rr][Ee][Rr]\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{20,}/,
  ],
];

export type SecretReason =
  'secret_field' | 'authorization_header' | (typeof TOKEN_PATTERNS)[number][0];

export interface SecretFinding {
  /** Путь в документе: `$.a.b[0]`. */
  path: string;
  reason: SecretReason;
}

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

function reasonFor(key: string | null, value: string): SecretReason | null {
  if (REDACTION.test(value)) return null;
  if (key !== null) {
    const normalized = normalizeKey(key);
    if (normalized === 'authorization' && AUTH_HEADER_VALUE.test(value))
      return 'authorization_header';
    if (SECRET_KEY.test(normalized) && value.length >= 4) return 'secret_field';
  }
  for (const [reason, pattern] of TOKEN_PATTERNS) {
    if (pattern.test(value)) return reason;
  }
  return null;
}

/** Все строковые значения документа, похожие на секрет. */
export function findSecrets(doc: unknown): SecretFinding[] {
  const found: SecretFinding[] = [];
  const walk = (value: unknown, key: string | null, path: string, depth: number): void => {
    if (depth > 32) return;
    if (typeof value === 'string') {
      const reason = reasonFor(key, value);
      if (reason) found.push({ path, reason });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, null, `${path}[${index}]`, depth + 1));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k, `${path}.${k}`, depth + 1);
    }
  };
  walk(doc, null, '$', 0);
  return found;
}

export function containsSecret(doc: unknown): boolean {
  return findSecrets(doc).length > 0;
}

/**
 * Копия документа, где каждое найденное значение заменено на `[redacted:<причина>]`.
 * Структура и остальные значения не меняются.
 */
export function sanitizeForJournal<T>(doc: T): { value: T; redactions: SecretFinding[] } {
  const redactions: SecretFinding[] = [];
  const walk = (value: unknown, key: string | null, path: string, depth: number): unknown => {
    if (depth > 32) return '[redacted:too_deep]';
    if (typeof value === 'string') {
      const reason = reasonFor(key, value);
      if (!reason) return value;
      redactions.push({ path, reason });
      return `[redacted:${reason}]`;
    }
    if (Array.isArray(value))
      return value.map((item, i) => walk(item, null, `${path}[${i}]`, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, k, `${path}.${k}`, depth + 1)]),
      );
    }
    return value;
  };
  return { value: walk(doc, null, '$', 0) as T, redactions };
}

/** Ошибка базы: сработала сигнальная проверка `*_no_secrets`. */
export function isSecretTripwire(error: unknown): boolean {
  const e = error as { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? '');
  return e?.code === '23514' && constraint.endsWith('_no_secrets');
}

export const TRIPWIRE_PLACEHOLDER = { redacted: 'tripwire' } as const;

/**
 * Запись в журнал, которая не может сорваться из-за проверки секретов. Действие к этому моменту уже
 * выполнено, и потерять строку журнала нельзя:
 *   1) метаданные очищаются в коде (`sanitizeForJournal`);
 *   2) если сигнальная проверка базы всё же сработала (правила кода и базы разошлись), строка
 *      пишется ещё раз с метаданными-заглушкой `{"redacted":"tripwire"}`, а расхождение уходит в журнал
 *      сервера как ошибка — его надо разобрать и выровнять правила;
 *   3) любая другая ошибка базы пробрасывается как есть.
 */
export async function writeJournalSafely<T>(
  meta: T,
  write: (meta: T | typeof TRIPWIRE_PLACEHOLDER) => Promise<void>,
  report: (message: string, details: Record<string, unknown>) => void = (message, details) =>
    console.error(`[journal] ${message}`, details),
): Promise<{ redactions: SecretFinding[]; tripwire: boolean }> {
  const { value, redactions } = sanitizeForJournal(meta);
  try {
    await write(value);
    return { redactions, tripwire: false };
  } catch (error) {
    if (!isSecretTripwire(error)) throw error;
    report('secret tripwire fired after sanitizing: code and database rules differ', {
      constraint: (error as { constraint_name?: string }).constraint_name,
    });
    await write(TRIPWIRE_PLACEHOLDER);
    return { redactions, tripwire: true };
  }
}
