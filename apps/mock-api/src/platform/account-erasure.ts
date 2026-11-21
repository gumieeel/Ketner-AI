/**
 * Удаление аккаунта: одна функция `eraseAccount(userId)`, у которой каждая возможность
 * регистрирует свою очистку. Пока аккаунт удаляет поддержка по запросу владельца
 * (scripts/erase-account.ts, по умолчанию — только сводка без удаления).
 *
 * Шаги независимы: сбой одного не останавливает остальные, отчёт говорит, что не удалось. Шаг сам
 * решает, что можно сделать «по возможности» (например, отзыв доступа у Google): такой сбой он
 * пишет в лог и продолжает, а в отчёт попадает заметка.
 *
 * В сводке и отчёте — только счётчики и описания, без токенов и содержимого.
 */

export interface ErasureItem {
  /** Что удаляется: «строка google_connections», «отзыв доступа Google»… */
  what: string;
  count: number;
}

export interface ErasureStep {
  /** Имя возможности, уникально: `google`, `github`… */
  name: string;
  /** Что будет удалено у аккаунта. Ничего не меняет. */
  preview(userId: string): Promise<ErasureItem[]> | ErasureItem[];
  /** Удаляет и говорит, что удалено; заметки — о том, что сделано не полностью. */
  erase(userId: string): Promise<{ items: ErasureItem[]; notes?: string[] }>;
}

export interface ErasureStepReport {
  name: string;
  items: ErasureItem[];
  notes: string[];
  /** Шаг упал: сообщение ошибки (без данных аккаунта). */
  error?: string;
}

export interface ErasureReport {
  userId: string;
  dryRun: boolean;
  steps: ErasureStepReport[];
  /** Все шаги прошли без ошибки. */
  complete: boolean;
}

const USER_ID = /^[A-Za-z0-9_.:@-]{1,200}$/;

export class AccountErasure {
  private readonly steps = new Map<string, ErasureStep>();

  register(step: ErasureStep): void {
    if (this.steps.has(step.name)) {
      throw new Error(`очистка «${step.name}» уже зарегистрирована`);
    }
    this.steps.set(step.name, step);
  }

  /** Только для тестов и замены зависимостей при старте. */
  unregister(name: string): void {
    this.steps.delete(name);
  }

  registered(): string[] {
    return [...this.steps.keys()];
  }

  /** Сводка: что будет удалено. Ничего не меняет. */
  async preview(userId: string): Promise<ErasureReport> {
    return this.run(userId, true);
  }

  /** Удаляет данные аккаунта во всех зарегистрированных возможностях. */
  async erase(userId: string): Promise<ErasureReport> {
    return this.run(userId, false);
  }

  private async run(userId: string, dryRun: boolean): Promise<ErasureReport> {
    if (!USER_ID.test(userId)) throw new Error('некорректный id аккаунта');
    const steps: ErasureStepReport[] = [];
    for (const step of this.steps.values()) {
      try {
        if (dryRun) {
          steps.push({ name: step.name, items: await step.preview(userId), notes: [] });
        } else {
          const result = await step.erase(userId);
          steps.push({ name: step.name, items: result.items, notes: result.notes ?? [] });
        }
      } catch (error) {
        steps.push({
          name: step.name,
          items: [],
          notes: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { userId, dryRun, steps, complete: steps.every((step) => !step.error) };
  }
}

/** Реестр процесса: возможности регистрируют очистку при старте. */
export const accountErasure = new AccountErasure();

/** Удаляет данные аккаунта во всех возможностях, зарегистрированных в `registry`. */
export function eraseAccount(
  userId: string,
  registry: AccountErasure = accountErasure,
): Promise<ErasureReport> {
  return registry.erase(userId);
}

/** Сводка удаления без изменений. */
export function previewAccountErasure(
  userId: string,
  registry: AccountErasure = accountErasure,
): Promise<ErasureReport> {
  return registry.preview(userId);
}

/** Текст сводки для поддержки. */
export function formatErasureReport(report: ErasureReport): string {
  const lines = [
    report.dryRun
      ? `Проверка (ничего не удалено) для аккаунта ${report.userId}:`
      : `Удалено у аккаунта ${report.userId}:`,
  ];
  for (const step of report.steps) {
    lines.push(`- ${step.name}${step.error ? ` — ОШИБКА: ${step.error}` : ''}`);
    for (const item of step.items) lines.push(`    ${item.what}: ${item.count}`);
    for (const note of step.notes) lines.push(`    заметка: ${note}`);
  }
  if (report.steps.length === 0) lines.push('- зарегистрированных очисток нет');
  lines.push(report.complete ? 'Все шаги без ошибок.' : 'Есть шаги с ошибками — см. выше.');
  return lines.join('\n');
}
