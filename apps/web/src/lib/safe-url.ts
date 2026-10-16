/**
 * Безопасная ссылка для href/src. Пропускает только http(s), mailto, tel и относительные адреса.
 * `javascript:`, `data:`, `vbscript:` и прочие схемы отбрасываются: ссылка вида
 * `[текст](javascript:…)` в ответе модели иначе выполнила бы код на ketner.org и унесла токен.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeHref(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Браузер игнорирует управляющие символы и пробелы внутри схемы («java\tscript:»), поэтому
  // проверяем строку уже без них.
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (value === '') return undefined;
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    // «//evil.example» — это внешний адрес без схемы: допустим, он всё равно http(s).
    return raw.trim();
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!scheme) return raw.trim();
  return ALLOWED_PROTOCOLS.has(`${scheme[1].toLowerCase()}:`) ? raw.trim() : undefined;
}
