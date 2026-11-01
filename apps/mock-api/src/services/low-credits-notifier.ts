/**
 * Письмо «кредиты на исходе» (docs/AUTOMATION_PLAN.md, этап C).
 *
 * После каждого списания проверяется остаток: когда он опускается до 20% кредитов, выданных
 * действующими грантами, владельцу один раз уходит письмо — до того, как боты для клиентов
 * перестанут отвечать сами. Повторно письмо приходит только после нового начисления (набор
 * действующих грантов изменился). Отметка об отправке хранится в `ketner_docs`, поэтому деплой не
 * вызывает повторных писем. Выключенные напоминания (настройки уведомлений) письмо отменяют.
 */

import type { DocStore } from '../store/doc-store.js';
import type { CreditStore } from '../store/credit-store.js';
import type { UserStore } from '../store/user-store.js';
import { toCredits } from './entitlement.js';
import type { Mailer } from './mailer.js';

/** С этой доли выданных кредитов уходит письмо. */
export const LOW_CREDITS_EMAIL_RATIO = 0.2;

export interface LowCreditsNotice {
  /** id пользователя. */
  id: string;
  /** Набор действующих грантов, о котором уже предупредили. */
  grantsKey: string;
  sentAt: string;
}

export interface LowCreditsNotifierDeps {
  credits: CreditStore;
  notices: DocStore<LowCreditsNotice>;
  users: Pick<UserStore, 'findById'>;
  mailer: Mailer;
  /** Напоминания выключены в настройках уведомлений. */
  remindersOff?: (userId: string) => boolean;
  siteUrl: string;
  now?: () => number;
}

const NO_EMAIL = /@telegram\.invalid$/i;

export class LowCreditsNotifier {
  private readonly sending = new Set<string>();

  constructor(private readonly deps: LowCreditsNotifierDeps) {}

  /** Проверить остаток после списания; письмо уходит в фоне и не задерживает ответ. */
  check(userId: string): void {
    void this.run(userId).catch((error: unknown) => {
      console.error(`[credits] письмо об остатке для ${userId} не отправлено`, error);
    });
  }

  async run(userId: string): Promise<boolean> {
    const now = this.deps.now?.() ?? Date.now();
    const live = this.deps.credits.liveOf(userId, now);
    const grantedUsd = live.reduce((sum, grant) => sum + grant.amountUsd, 0);
    const remainingUsd = live.reduce((sum, grant) => sum + Math.max(0, grant.remainingUsd), 0);
    if (grantedUsd <= 0 || remainingUsd > grantedUsd * LOW_CREDITS_EMAIL_RATIO) return false;

    const grantsKey = live
      .map((grant) => grant.id)
      .sort()
      .join(',');
    if (this.deps.notices.get(userId)?.grantsKey === grantsKey) return false;
    if (this.sending.has(userId)) return false;
    if (this.deps.remindersOff?.(userId)) return false;
    const user = this.deps.users.findById(userId);
    if (!user?.email || NO_EMAIL.test(user.email)) return false;

    this.sending.add(userId);
    try {
      // Отметка — до отправки: два списания подряд не дают двух писем.
      this.deps.notices.put({ id: userId, grantsKey, sentAt: new Date(now).toISOString() });
      const left = toCredits(remainingUsd).toLocaleString('ru-RU');
      const link = `${this.deps.siteUrl}/pricing`;
      const lines = [
        `Здравствуйте${user.name ? `, ${user.name}` : ''}!`,
        '',
        `На балансе Ketner AI осталось ${left} кр. — меньше 20% начисленных.`,
        'Когда кредиты закончатся, боты для клиентов перестанут отвечать сами и будут только собирать заявки, а платные анализы и проверки не запустятся.',
        '',
        `Пополнить баланс: ${link}`,
        '',
        'Напоминания можно выключить в настройках аккаунта.',
      ];
      const escape = (value: string) =>
        value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
      try {
        await this.deps.mailer.send({
          to: user.email,
          subject: `Кредиты на исходе: осталось ${left}`,
          text: lines.join('\n'),
          html: lines.map((line) => (line ? `<p>${escape(line)}</p>` : '')).join(''),
        });
      } catch (error) {
        // Письмо не ушло — следующее списание попробует снова.
        this.deps.notices.remove(userId);
        throw error;
      }
      return true;
    } finally {
      this.sending.delete(userId);
    }
  }
}
