/**
 * Предупреждения владельцу об объёме тарифа (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 3): письмо
 * один раз за период, когда засчитано 80% включённых обращений, и когда бот переходит в режим заявок
 * (включённые + льготные 10% исчерпаны). Строку в кабинете рисует панель бота по тому же решению
 * (TierDecision.state).
 *
 * Пока тарифы не включены (`TIER_ENFORCED = false`), писем нет: ограничения ещё не действуют, и
 * предупреждать не о чем.
 *
 * «Один раз» — запись в хранилище счётчиков (`claim`, ключ на аккаунт, период и вид письма): после
 * перезапуска сервера письмо не уходит повторно. Ошибка письма или хранилища ответ посетителю не
 * задерживает и не ломает — только строка в логе.
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

/** Ключ «уже отправлено»: аккаунт, период (конец месяца) и вид письма. */
export function alertKey(userId: string, decision: TierDecision, kind: TierAlertKind): string {
  return `tier-alert:${userId}:${decision.periodEnd.slice(0, 10)}:${kind}`;
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

export interface TierAlertsDeps {
  /** Записать «отправлено»; false — уже было. */
  claim: (key: string) => Promise<boolean>;
  /** Письмо владельцу; нет адреса — тихо пропустить. */
  send: (userId: string, kind: TierAlertKind, decision: TierDecision) => Promise<void>;
  log?: (line: string) => void;
}

export class TierAlerts {
  constructor(private readonly deps: TierAlertsDeps) {}

  /** Решение после ответа (или при отказе в режиме заявок): нужно ли письмо — отправить один раз. */
  async check(userId: string, decision: TierDecision): Promise<TierAlertKind | null> {
    if (!tierEnforced()) return null;
    const kind = alertFor(decision);
    if (!kind) return null;
    if (!(await this.deps.claim(alertKey(userId, decision, kind)))) return null;
    await this.deps.send(userId, kind, decision);
    (this.deps.log ?? console.info)(
      `[tiers] alert user=${userId} kind=${kind} used=${decision.used}/${decision.included ?? 0} tier=${decision.tier}`,
    );
    return kind;
  }
}
