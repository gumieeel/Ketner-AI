/** Длина заголовка диалога: то же правило, что в mock-API (см. docs/data-model.md). */
export const TITLE_MAX_LENGTH = 60;

/**
 * Заголовок диалога по первому сообщению.
 *
 * Сервер применяет это же правило, когда заголовок не пришёл с клиентом.
 * Считаем символы, а не код-юниты: иначе обрезка разорвёт эмодзи.
 */
export function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  if (characters.length <= TITLE_MAX_LENGTH) {
    return flat;
  }
  return `${characters
    .slice(0, TITLE_MAX_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}
