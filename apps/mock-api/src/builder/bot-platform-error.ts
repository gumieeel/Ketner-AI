/**
 * Отдельный модуль без зависимостей: bot-service.ts ловит эту ошибку, а bot-agent.ts её бросает.
 * Если бы bot-service.ts брал класс из bot-agent.ts, возник бы круг импортов
 * bot-service → bot-agent → platform/agent-spec → bot-service, и константы бота были бы ещё не готовы.
 */

/**
 * Путь платформы недоступен до первого вызова модели (журнал не записался): ничего не списано, и
 * bot-service.ts отвечает прежним путём.
 */
export class PlatformUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `bot platform runtime unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'PlatformUnavailableError';
  }
}
