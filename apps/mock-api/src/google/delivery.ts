/**
 * Доставка заявок в Google Таблицу владельца (этап F, шаг 4; docs/STAGE_F_SHEETS.md, разделы 5–7).
 *
 * - Заявка сохранена → исполнение и шаг `sheet_append` (google/delivery-journal.ts) → попытка сразу,
 *   в фоне: посетитель ничего не ждёт, а сбой Google заявку не теряет (она уже в Ketner).
 * - Временный сбой (429, 5xx, нет сети до отправки) → повтор через 1, 5, 30 минут, всего 4 попытки.
 * - Неясный исход (запрос ушёл, ответа нет) → сверка по колонке «ID заявки», без слепого повтора.
 * - Доступ отозван (`invalid_grant`, 403) → подключение `reconnect_required`; таблица удалена или в
 *   корзине → `sheet_missing`. Такие записи не повторяются, ждут исправления и «дописать пропущенные».
 *   Владельцу — письмо и Telegram один раз за поломку (переход из `connected`).
 *
 * Всё выключено, пока закрыт переключатель `googleSheets` или не настроен клиент Google.
 * В журнал и лог — только коды и id, без данных заявки и токенов.
 */

import type { BotLead, Solution } from '../builder/types.js';
import type { GoogleConnection, GoogleConnectionStore } from './connection-store.js';
import {
  MAX_ATTEMPTS,
  isFinalFailure,
  nextStepKey,
  type DeliveryEffect,
  type DeliveryJournal,
  type DeliveryMeta,
} from './delivery-journal.js';
import { GoogleOAuthError, refreshGoogleAccessToken, type GoogleOAuthSettings } from './oauth.js';
import {
  GoogleSheetsError,
  appendLeadRow,
  createLeadSpreadsheet,
  leadRow,
  sheetHasLead,
  spreadsheetTrashed,
} from './sheets.js';

export type LeadDeliveryState = 'written' | 'writing' | 'failed' | 'waiting';

export type RetryResult =
  'started' | 'retrying' | 'written' | 'in_progress' | 'limit' | 'not_found' | 'not_connected';

/** Сбои, которые ждут действия владельца (подключить снова, новая таблица), а не повтора. */
const WAITING_CODES = new Set([
  'reconnect_required',
  'sheet_missing',
  'disconnected',
  'invalid_grant',
  'token_unreadable',
  'forbidden',
  'not_found',
  'trashed',
]);

export const RECONCILE_RESOLVER = 'reconcile:sheet_id_column';
const TOKEN_MARGIN_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
/**
 * Перед записью — не в корзине ли таблица, не чаще раза в 10 минут на аккаунт: Sheets API пишет и в
 * файл из корзины, и без этой проверки заявки уходили бы в корзину до суточной проверки.
 */
const TRASH_BEFORE_WRITE_MS = 10 * 60_000;

export interface LeadSource {
  getLead(ownerId: string, leadId: string): Promise<BotLead | null>;
  getSolution(ownerId: string, id: string): Promise<Solution | null>;
}

export interface SheetsDeliveryDeps {
  journal: () => DeliveryJournal | null;
  leads: () => LeadSource | null;
  connections: GoogleConnectionStore;
  settings: () => GoogleOAuthSettings | null;
  /**
   * Включено ли для аккаунта: переключатель `googleSheets` или пилот. Без аккаунта — есть ли хоть
   * кто-то, для кого включено (обход).
   */
  enabled: (userId?: string) => boolean;
  /** Адрес сайта для ссылки «Диалог». */
  siteUrl: () => string;
  /** Часовой пояс владельца (дата в таблице); нет — UTC с пометкой. */
  timeZoneOf?: (userId: string) => string | null;
  /** Письмо и Telegram владельцу: доступ отозван или таблица пропала (один раз за поломку). */
  notifyBroken?: (userId: string, status: 'reconnect_required' | 'sheet_missing') => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}

class AccessError extends Error {
  constructor(
    readonly code: string,
    readonly retry: boolean,
  ) {
    super(code);
  }
}

export class SheetsDelivery {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly trashCheckedAt = new Map<string, number>();
  private readonly busy = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: SheetsDeliveryDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((message) => console.warn(message));
  }

  /** Работает ли доставка (для аккаунта — с учётом пилота). */
  available(userId?: string): boolean {
    return this.deps.enabled(userId) && this.deps.settings() !== null;
  }

  /** Сбросить access-токен из памяти (отключение, новое подключение). */
  forget(userId: string): void {
    this.tokens.delete(userId);
    this.trashCheckedAt.delete(userId);
  }

  // --- подключение ---------------------------------------------------------------------------

  private async accessToken(userId: string): Promise<string> {
    const cached = this.tokens.get(userId);
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > this.now()) return cached.token;
    const settings = this.deps.settings();
    if (!settings) throw new AccessError('unavailable', true);
    const refreshToken = this.deps.connections.refreshTokenOf(userId);
    if (!refreshToken) {
      // Токен есть, но не расшифровывается: сменился ключ (BETTER_AUTH_SECRET).
      if (this.deps.connections.hasStoredToken(userId)) {
        await this.broken(userId, 'reconnect_required', 'token_unreadable');
        throw new AccessError('token_unreadable', false);
      }
      throw new AccessError('disconnected', false);
    }
    try {
      const fresh = await refreshGoogleAccessToken(settings, refreshToken, this.fetchImpl);
      this.tokens.set(userId, {
        token: fresh.accessToken,
        expiresAt: this.now() + fresh.expiresInSec * 1000,
      });
      return fresh.accessToken;
    } catch (error) {
      if (error instanceof GoogleOAuthError && error.code === 'invalid_grant') {
        await this.broken(userId, 'reconnect_required', 'invalid_grant');
        throw new AccessError('invalid_grant', false);
      }
      throw new AccessError(
        error instanceof GoogleOAuthError && error.code === 'unavailable'
          ? 'unavailable'
          : 'token_refresh_failed',
        true,
      );
    }
  }

  /** Поломка подключения; уведомление — только при переходе из `connected`. */
  private async broken(
    userId: string,
    status: 'reconnect_required' | 'sheet_missing',
    code: string,
  ): Promise<void> {
    this.tokens.delete(userId);
    const changed = await this.deps.connections
      .update(userId, { status, lastErrorCode: code }, new Date(this.now()))
      .catch((error: unknown) => {
        this.log(`[sheets] статус подключения ${userId} не записан: ${String(error)}`);
        return undefined;
      });
    if (!changed || changed.before.status !== 'connected') return;
    this.log(`[sheets] подключение ${userId}: ${status} (${code})`);
    await this.deps.notifyBroken?.(userId, status).catch((error: unknown) => {
      this.log(`[sheets] уведомление владельцу ${userId} не отправлено: ${String(error)}`);
    });
  }

  /** Таблица в корзине — `sheet_missing`. Возвращает, можно ли писать. */
  private async checkTrash(connection: GoogleConnection, maxAgeMs = DAY_MS): Promise<boolean> {
    if (!connection.spreadsheetId) return false;
    const last = this.trashCheckedAt.get(connection.userId) ?? 0;
    if (this.now() - last < maxAgeMs) return true;
    let token: string;
    try {
      token = await this.accessToken(connection.userId);
    } catch {
      return false;
    }
    try {
      const trashed = await spreadsheetTrashed(token, connection.spreadsheetId, this.fetchImpl);
      this.trashCheckedAt.set(connection.userId, this.now());
      if (trashed) {
        await this.broken(connection.userId, 'sheet_missing', 'trashed');
        return false;
      }
      return true;
    } catch (error) {
      if (error instanceof GoogleSheetsError && error.code === 'not_found') {
        await this.broken(connection.userId, 'sheet_missing', 'not_found');
        return false;
      }
      return true;
    }
  }

  // --- одна попытка ----------------------------------------------------------------------------

  /** Новая заявка: исполнение и попытка сразу. Ошибки — только в лог. */
  async onLeadCreated(lead: BotLead): Promise<void> {
    if (!this.available(lead.ownerId)) return;
    const journal = this.deps.journal();
    const connection = this.deps.connections.get(lead.ownerId);
    if (!journal || !connection || connection.status === 'disconnected') return;
    try {
      const { created, effect } = await journal.start({
        userId: lead.ownerId,
        solutionId: lead.solutionId,
        leadId: lead.id,
      });
      if (created && effect) await this.attempt(effect);
    } catch (error) {
      this.log(`[sheets] заявка ${lead.id}: доставка не начата: ${String(error)}`);
    }
  }

  private async failBefore(journal: DeliveryJournal, effect: DeliveryEffect, meta: DeliveryMeta) {
    await journal.fail(effect, meta);
  }

  /** Попытка шага в статусе `reserved` (аренда — у этого процесса). */
  async attempt(effect: DeliveryEffect): Promise<void> {
    const journal = this.deps.journal();
    const source = this.deps.leads();
    if (!journal || !source || effect.status !== 'reserved') return;
    const key = `${effect.executionId}:${effect.stepKey}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      const connection = this.deps.connections.get(effect.userId);
      if (!connection || connection.status !== 'connected' || !connection.spreadsheetId) {
        const code =
          !connection || connection.status === 'disconnected'
            ? 'disconnected'
            : connection.status === 'connected'
              ? 'sheet_missing'
              : connection.status;
        await this.failBefore(journal, effect, { code, retry: false });
        return;
      }
      const lead = await source.getLead(effect.userId, effect.leadId);
      if (!lead) {
        await this.failBefore(journal, effect, { code: 'lead_missing', retry: false });
        return;
      }
      let token: string;
      try {
        token = await this.accessToken(effect.userId);
      } catch (error) {
        const access =
          error instanceof AccessError ? error : new AccessError('token_refresh_failed', true);
        await this.failBefore(journal, effect, { code: access.code, retry: access.retry });
        return;
      }
      if (!(await this.checkTrash(connection, TRASH_BEFORE_WRITE_MS))) {
        const after = this.deps.connections.get(effect.userId);
        await this.failBefore(journal, effect, {
          code: after?.lastErrorCode ?? 'sheet_missing',
          retry: false,
        });
        return;
      }
      const solution = await source.getSolution(effect.userId, lead.solutionId);
      const row = leadRow({
        createdAt: lead.createdAt,
        botName: solution?.name ?? '',
        name: lead.name,
        contact: lead.contact,
        question: lead.question,
        dialogUrl: `${this.deps.siteUrl()}/solutions/${encodeURIComponent(lead.solutionId)}`,
        leadId: lead.id,
        timeZone: this.deps.timeZoneOf?.(effect.userId) ?? null,
      });

      const dispatched = await journal.dispatch(effect);
      if (!dispatched) return;
      const outcome = await appendLeadRow(token, connection.spreadsheetId, row, this.fetchImpl);
      if (outcome.kind === 'ok') {
        await journal.commit(dispatched, outcome.updatedRange, { http: 200, rows: 1 });
        await this.deps.connections
          .update(effect.userId, { ok: true, lastErrorCode: null }, new Date(this.now()))
          .catch(() => undefined);
        return;
      }
      if (outcome.kind === 'unknown') {
        // Строка могла записаться: без слепого повтора, сверка при следующем обходе.
        await journal.markUnknown(dispatched);
        this.log(`[sheets] заявка ${effect.leadId}: исход записи неизвестен, будет сверка`);
        return;
      }
      await this.rejected(journal, dispatched, outcome.status, outcome.code, connection);
    } finally {
      this.busy.delete(key);
    }
  }

  private async rejected(
    journal: DeliveryJournal,
    effect: DeliveryEffect,
    status: number,
    code: string,
    connection: GoogleConnection,
  ) {
    if (status === 401) {
      // Access-токен не принят: следующая попытка получит новый (или узнает, что доступ отозван).
      this.tokens.delete(effect.userId);
      await journal.fail(effect, { http: status, code: 'unauthorized', retry: true });
      return;
    }
    if (status === 403) {
      await journal.fail(effect, { http: status, code: 'forbidden', retry: false });
      await this.broken(effect.userId, 'reconnect_required', 'forbidden');
      return;
    }
    if (status === 404) {
      await journal.fail(effect, { http: status, code: 'not_found', retry: false });
      await this.broken(effect.userId, 'sheet_missing', 'not_found');
      return;
    }
    const retry = status === 429 || status >= 500;
    await journal.fail(effect, { http: status, code, retry });
    await this.deps.connections
      .update(effect.userId, { lastErrorCode: code }, new Date(this.now()))
      .catch(() => undefined);
    // После сбоя — не в корзине ли таблица (Sheets API в файл из корзины пишет).
    await this.checkTrash(connection, 0);
  }

  /** Неясный исход: есть ли заявка в колонке «ID заявки». */
  async reconcile(effect: DeliveryEffect): Promise<void> {
    const journal = this.deps.journal();
    if (!journal || effect.status !== 'unknown') return;
    const connection = this.deps.connections.get(effect.userId);
    if (!connection || connection.status !== 'connected' || !connection.spreadsheetId) return;
    let token: string;
    try {
      token = await this.accessToken(effect.userId);
    } catch {
      return;
    }
    try {
      const found = await sheetHasLead(
        token,
        connection.spreadsheetId,
        effect.leadId,
        this.fetchImpl,
      );
      if (found) {
        await journal.commit(effect, '', { http: 200, rows: 1 }, RECONCILE_RESOLVER);
      } else {
        await journal.fail(effect, { code: 'not_written', retry: true }, RECONCILE_RESOLVER);
      }
    } catch (error) {
      if (error instanceof GoogleSheetsError && error.code === 'not_found') {
        await this.broken(effect.userId, 'sheet_missing', 'not_found');
      }
      // Иначе остаётся `unknown` до следующего обхода.
    }
  }

  // --- обход ---------------------------------------------------------------------------------

  /** Раз в минуту: продолжить шаги с истёкшей арендой, сверить неясные, повторить временные сбои. */
  async sweep(limit = 50): Promise<number> {
    if (!this.available()) return 0;
    const journal = this.deps.journal();
    if (!journal) return 0;
    let handled = 0;
    for (const effect of await journal.due(this.now(), limit)) {
      // Пилот: шаги аккаунтов, для которых Google Таблицы закрыты, не трогаем.
      if (!this.available(effect.userId)) continue;
      const connection = this.deps.connections.get(effect.userId);
      const connected = connection?.status === 'connected';
      try {
        if (effect.status === 'dispatched') {
          // Процесс умер после отправки: строка могла записаться.
          await journal.markUnknown(effect);
        } else if (effect.status === 'reserved') {
          if (!connected) {
            await journal.fail(effect, {
              code: connection?.status ?? 'disconnected',
              retry: false,
            });
          } else {
            const renewed = await journal.renewLease(effect);
            if (renewed) await this.attempt(renewed);
          }
        } else if (effect.status === 'unknown') {
          if (connected) await this.reconcile(effect);
        } else if (effect.status === 'failed' && connected) {
          const retried = await journal.retry(effect);
          if (retried) await this.attempt(retried);
        }
        handled += 1;
      } catch (error) {
        this.log(`[sheets] обход: заявка ${effect.leadId}: ${String(error)}`);
      }
    }
    // Раз в сутки — не в корзине ли таблицы подключённых аккаунтов.
    for (const connection of this.deps.connections.list()) {
      if (connection.status === 'connected' && this.available(connection.userId)) {
        await this.checkTrash(connection);
      }
    }
    return handled;
  }

  // --- владелец ------------------------------------------------------------------------------

  /** Кнопка «повторить» у заявки. */
  async retryLead(userId: string, leadId: string): Promise<RetryResult> {
    const journal = this.deps.journal();
    const source = this.deps.leads();
    if (!journal || !source) return 'not_found';
    const connection = this.deps.connections.get(userId);
    if (!connection || connection.status !== 'connected') return 'not_connected';
    const latest = await journal.latest(userId, leadId);
    if (!latest) {
      const lead = await source.getLead(userId, leadId);
      if (!lead) return 'not_found';
      const { effect } = await journal.start({ userId, solutionId: lead.solutionId, leadId });
      if (effect?.status === 'reserved') await this.attempt(effect);
      return 'started';
    }
    if (latest.status === 'committed') return 'written';
    if (latest.status !== 'failed') return 'in_progress';
    const next =
      latest.attempts < MAX_ATTEMPTS
        ? await journal.retry(latest)
        : await (async () => {
            const stepKey = nextStepKey(latest.stepKey);
            return stepKey ? journal.newStep(latest, stepKey) : null;
          })();
    if (!next) return latest.attempts < MAX_ATTEMPTS ? 'in_progress' : 'limit';
    await this.attempt(next);
    return 'retrying';
  }

  /** «Дописать пропущенные»: все заявки, чья запись не удалась, по одной. */
  async backfill(userId: string): Promise<number> {
    const journal = this.deps.journal();
    const connection = this.deps.connections.get(userId);
    if (!journal || !connection || connection.status !== 'connected') return 0;
    if (!(await this.checkTrash(connection, 0))) return 0;
    let retried = 0;
    for (const effect of await journal.failed(userId, 500)) {
      if (this.deps.connections.get(userId)?.status !== 'connected') break;
      const result = await this.retryLead(userId, effect.leadId);
      if (result === 'retrying' || result === 'started') retried += 1;
    }
    return retried;
  }

  /** Отметки у заявок в кабинете. */
  async states(userId: string, leadIds: string[]): Promise<Record<string, LeadDeliveryState>> {
    const journal = this.deps.journal();
    if (!journal) return {};
    const result: Record<string, LeadDeliveryState> = {};
    for (const [leadId, effect] of await journal.latestFor(userId, leadIds)) {
      result[leadId] = stateOf(effect);
    }
    return result;
  }

  /** Сколько заявок не записано (кнопка «дописать пропущенные»). */
  async pending(userId: string): Promise<number> {
    const journal = this.deps.journal();
    return journal ? (await journal.failed(userId, 500)).length : 0;
  }

  /**
   * «Проверить снова» после `sheet_missing`: владелец восстановил таблицу из корзины — если файл на
   * месте и не в корзине, подключение снова `connected` (таблица прежняя). Иначе — без изменений.
   */
  async recheck(userId: string): Promise<GoogleConnection | undefined> {
    const connection = this.deps.connections.get(userId);
    if (!connection || connection.status !== 'sheet_missing' || !connection.spreadsheetId) {
      return connection;
    }
    let token: string;
    try {
      token = await this.accessToken(userId);
    } catch {
      return this.deps.connections.get(userId);
    }
    try {
      const trashed = await spreadsheetTrashed(token, connection.spreadsheetId, this.fetchImpl);
      this.trashCheckedAt.set(userId, this.now());
      if (trashed) return connection;
    } catch {
      return connection;
    }
    const updated = await this.deps.connections.update(
      userId,
      { status: 'connected', lastErrorCode: null },
      new Date(this.now()),
    );
    this.log(`[sheets] подключение ${userId}: таблица снова доступна`);
    return updated?.after;
  }

  /** «Создать новую таблицу» после `sheet_missing`. */
  async newSheet(userId: string): Promise<GoogleConnection> {
    const connection = this.deps.connections.get(userId);
    if (!connection || connection.status === 'disconnected') {
      throw new GoogleSheetsError('disconnected');
    }
    let token: string;
    try {
      token = await this.accessToken(userId);
    } catch (error) {
      throw new GoogleSheetsError(error instanceof AccessError ? error.code : 'unavailable');
    }
    const spreadsheet = await createLeadSpreadsheet(
      token,
      this.fetchImpl,
      this.deps.timeZoneOf?.(userId) ?? null,
    );
    const updated = await this.deps.connections.update(
      userId,
      { status: 'connected', lastErrorCode: null, spreadsheet },
      new Date(this.now()),
    );
    this.trashCheckedAt.set(userId, this.now());
    if (!updated) throw new GoogleSheetsError('disconnected');
    return updated.after;
  }
}

export function stateOf(effect: DeliveryEffect): LeadDeliveryState {
  if (effect.status === 'committed') return 'written';
  if (effect.status !== 'failed' || !isFinalFailure(effect)) return 'writing';
  return effect.resultMeta.code && WAITING_CODES.has(effect.resultMeta.code) ? 'waiting' : 'failed';
}
