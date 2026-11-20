/**
 * Предупреждения владельцу об объёме тарифа (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 3): письмо
 * один раз за период, когда засчитано 80% включённых обращений, и когда бот переходит в режим заявок
 * (включённые + льготные 10% исчерпаны). Строку в кабинете рисует панель бота по тому же решению
 * (TierDecision.state).
 *
 * Пока тарифы не включены (`TIER_ENFORCED = false`), писем нет: ограничения ещё не действуют, и
 * предупреждать не о чем.
 *
 * Каналы — почта и Telegram (если владелец привязал Telegram). У каждого канала своя отметка
 * «отправлено» в хранилище счётчиков (`claim`, ключ на аккаунт, период, вид письма и канал): после
 * перезапуска сервера предупреждение не уходит повторно, а сбой одного канала не мешает другому.
 *
 * Отметка ставится до отправки — она же не даёт двум параллельным ответам отправить письмо дважды.
 * Отправка не удалась — отметка снимается (`release`), и следующий ответ бота попробует снова.
 * Канал недоступен (нет адреса, почта не настроена, Telegram не привязан) — отметка не ставится:
 * предупреждение уйдёт, когда канал появится в этом же периоде. Ошибки не задерживают и не ломают
 * ответ посетителю — только строка в логе.
 */

import { tierById, type TierId } from '../services/tiers.js';
import { tierEnforced, type TierDecision } from './tier-usage.js';

export type TierAlertKind = 'warning' | 'leads_only';

/** Какое письмо положено по решению: 80% и льготный объём — предупреждение, режим заявок — свой. */
export function alertFor(decision: TierDecision): TierAlertKind | null {
  if (!decision.tier) return null;
  if (decision.state === 'leads_only') return 'leads_only';
  if (decision.state === 'warning' || decision.state === 'grace') return 'warning';
  return null;
}

export type TierAlertChannelName = 'email' | 'telegram';

/**
 * Ключ «уже отправлено»: аккаунт, период (конец месяца), вид письма и канал. У почты ключ без
 * суффикса — как до появления Telegram, чтобы уже отправленные письма не ушли второй раз.
 */
export function alertKey(
  userId: string,
  decision: TierDecision,
  kind: TierAlertKind,
  channel: TierAlertChannelName = 'email',
): string {
  const base = `tier-alert:${userId}:${decision.periodEnd.slice(0, 10)}:${kind}`;
  return channel === 'email' ? base : `${base}:${channel}`;
}

export interface TierAlertMail {
  subject: string;
  lines: string[];
}

const formatNumber = (value: number) => value.toLocaleString('ru-RU');

/** Последний день периода (конец месяца не включительно). */
function lastDay(periodEnd: string): string {
  const day = new Date(Date.parse(periodEnd) - 86_400_000);
  return day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Текст письма: что произошло, что будет дальше, что сделать. Числа — из решения и каталога. */
export function alertMail(
  kind: TierAlertKind,
  decision: TierDecision,
  links: { solutions: string; contacts: string },
): TierAlertMail {
  const tier = tierById(decision.tier as TierId);
  const used = formatNumber(decision.used);
  const included = formatNumber(decision.included ?? 0);
  const limit = formatNumber(decision.limit ?? 0);
  const until = lastDay(decision.periodEnd);
  if (kind === 'warning') {
    return {
      subject: `Ketner: использовано ${Math.floor((decision.used / (decision.included || 1)) * 100)}% обращений тарифа ${tier.name}`,
      lines: [
        `Ваши решения ответили посетителям ${used} раз из ${included}, включённых в тариф ${tier.name} на этот месяц.`,
        '',
        `Сверх объёма работают ещё 10% без доплаты — всего до ${limit} обращений. Дальше до конца ${until} бот не отвечает с помощью ИИ, а принимает заявки: клиенты оставляют контакт, заявки приходят вам.`,
        '',
        'Тариф выше подключается только с вашего согласия. Если нужен — напишите нам.',
        '',
        `Обращения и заявки: ${links.solutions}`,
        `Написать нам: ${links.contacts}`,
      ],
    };
  }
  return {
    subject: `Ketner: бот принимает только заявки до конца ${until}`,
    lines: [
      `Объём тарифа ${tier.name} на этот месяц исчерпан: ${used} обращений при ${included} включённых и ${formatNumber((decision.limit ?? 0) - (decision.included ?? 0))} льготных.`,
      '',
      `До конца ${until} ваши боты не отвечают с помощью ИИ: посетитель видит форму заявки, заявки приходят вам. Ссылки, QR-коды и кнопки на сайте работают. С нового месяца ответы возобновятся сами.`,
      '',
      'Чтобы бот снова отвечал сейчас, напишите нам — подключим тариф выше с вашего согласия.',
      '',
      `Заявки: ${links.solutions}`,
      `Написать нам: ${links.contacts}`,
    ],
  };
}

/** Сообщение в Telegram: тема жирным, затем строки письма (HTML Telegram, текст экранирован). */
export function alertTelegramText(mail: TierAlertMail): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [`<b>${escape(mail.subject)}</b>`, '', ...mail.lines.map(escape)].join('\n');
}

export interface TierAlertChannel {
  name: TierAlertChannelName;
  /** Есть ли куда отправить сейчас: адрес, настроенная почта, привязанный Telegram. */
  available: (userId: string) => boolean;
  /** Отправить; не получилось — исключение (отметка снимется, будет повтор). */
  send: (userId: string, kind: TierAlertKind, decision: TierDecision) => Promise<void>;
}

export interface TierAlertsDeps {
  /** Поставить отметку «отправлено»; false — уже стоит (отправлено или отправляется). */
  claim: (key: string) => Promise<boolean>;
  /** Снять отметку после неудачной отправки. */
  release: (key: string) => Promise<void>;
  channels: readonly TierAlertChannel[];
  log?: (line: string) => void;
}

export class TierAlerts {
  constructor(private readonly deps: TierAlertsDeps) {}

  /**
   * Решение после ответа (или при отказе в режиме заявок): нужно ли предупреждение — отправить один
   * раз в каждый доступный канал. Возвращает вид, если сейчас ушло хотя бы в один канал.
   */
  async check(userId: string, decision: TierDecision): Promise<TierAlertKind | null> {
    if (!tierEnforced()) return null;
    const kind = alertFor(decision);
    if (!kind) return null;
    const results = await Promise.all(
      this.deps.channels.map((channel) => this.deliver(channel, userId, kind, decision)),
    );
    return results.some(Boolean) ? kind : null;
  }

  private async deliver(
    channel: TierAlertChannel,
    userId: string,
    kind: TierAlertKind,
    decision: TierDecision,
  ): Promise<boolean> {
    const log = this.deps.log ?? console.info;
    if (!channel.available(userId)) return false;
    const key = alertKey(userId, decision, kind, channel.name);
    if (!(await this.deps.claim(key))) return false;
    try {
      await channel.send(userId, kind, decision);
    } catch (error) {
      log(
        `[tiers] alert failed user=${userId} kind=${kind} channel=${channel.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.deps.release(key).catch((releaseError: unknown) => {
        log(
          `[tiers] alert release failed key=${key}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      });
      return false;
    }
    log(
      `[tiers] alert user=${userId} kind=${kind} channel=${channel.name} used=${decision.used}/${decision.included ?? 0} tier=${decision.tier}`,
    );
    return true;
  }
}
