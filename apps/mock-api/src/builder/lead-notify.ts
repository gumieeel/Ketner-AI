/**
 * Шаг автоматизации «заявка → менеджер»: уведомление владельцу бота о новой заявке по почте и в
 * Telegram (бот Ketner, которому владелец привязал аккаунт). Настройка у каждого бота
 * (`BotSettings.leadNotify`); риск — действие `owner.notify` из platform/risk.ts (внутреннее,
 * одному получателю, обычное).
 *
 * Значения по умолчанию:
 * - новые боты — оба канала включены (решение владельца 23.11.2026);
 * - боты, созданные до шага (поля нет), — как раньше: письмо да, Telegram нет. Владелец включает
 *   Telegram сам, внезапных сообщений после обновления нет.
 *
 * Уведомление — «по возможности»: заявка уже сохранена и видна в кабинете, сбой канала не
 * повторяется (как письмо о заявке до шага). На каждый канал — строка в логе с итогом, без адреса,
 * имени и контакта клиента.
 */

import type { Mailer } from '../services/mailer.js';
import type { BotLead, BotSettings, LeadNotifySettings, Solution } from './types.js';

export const NEW_BOT_LEAD_NOTIFY: LeadNotifySettings = { email: true, telegram: true };
/** Боты, созданные до шага: как раньше — только письмо. */
export const LEGACY_LEAD_NOTIFY: LeadNotifySettings = { email: true, telegram: false };

export function leadNotifyOf(bot: Pick<BotSettings, 'leadNotify'> | null | undefined) {
  const value = bot?.leadNotify;
  if (!value) return { ...LEGACY_LEAD_NOTIFY };
  return { email: value.email === true, telegram: value.telegram === true };
}

export interface LeadNotifyChannels {
  mailer?: Mailer;
  telegram?: {
    canNotify: (userId: string) => boolean;
    notifyOwner: (userId: string, text: string) => Promise<unknown>;
  };
  siteUrl: () => string;
  log?: (message: string) => void;
}

export type LeadNotifyResult =
  | 'sent'
  | 'off'
  | 'mail_not_configured'
  | 'no_email'
  | 'telegram_not_configured'
  | 'telegram_not_linked'
  | `failed:${string}`;

const LOG_TEXT: Record<string, string> = {
  sent: 'отправлено',
  off: 'выключено в настройках бота',
  mail_not_configured: 'не отправлено: почта на сервере не настроена (SMTP_HOST, MAIL_FROM)',
  no_email: 'не отправлено: у аккаунта нет адреса почты',
  telegram_not_configured: 'не отправлено: Telegram на сервере не подключён',
  telegram_not_linked: 'не отправлено: Telegram не привязан к аккаунту или бот не настроен',
};

function logText(result: LeadNotifyResult): string {
  return result.startsWith('failed:')
    ? `ошибка отправки (${result.slice('failed:'.length)})`
    : (LOG_TEXT[result] ?? result);
}

/** Код ошибки без текста: в тексте SMTP бывает адрес получателя. */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  if (error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)) return error.name;
  return 'error';
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Строки письма и сообщения: имя, контакт, вопрос и ссылка на заявки в кабинете. */
export function leadNoticeLines(
  solution: Pick<Solution, 'id' | 'name'>,
  lead: BotLead,
  site: string,
) {
  return {
    title: `Новая заявка от бота «${solution.name}».`,
    details: [
      `Имя: ${lead.name}`,
      `Контакт: ${lead.contact}`,
      ...(lead.question ? [`Вопрос: ${lead.question}`] : []),
    ],
    link: `${site}/solutions/${solution.id}`,
  };
}

/** Текст для Telegram (parse_mode HTML): всё, что ввёл посетитель, экранировано. */
export function leadTelegramText(
  solution: Pick<Solution, 'id' | 'name'>,
  lead: BotLead,
  site: string,
) {
  const { title, details, link } = leadNoticeLines(solution, lead, site);
  return [
    `<b>${escapeHtml(title)}</b>`,
    '',
    ...details.map(escapeHtml),
    '',
    `Все заявки и диалоги: ${escapeHtml(link)}`,
  ].join('\n');
}

export async function notifyLead(
  channels: LeadNotifyChannels,
  owner: { userId: string; email?: string },
  solution: Pick<Solution, 'id' | 'name' | 'bot'>,
  lead: BotLead,
): Promise<{ email: LeadNotifyResult; telegram: LeadNotifyResult }> {
  const log = channels.log ?? ((message: string) => console.warn(message));
  const settings = leadNotifyOf(solution.bot);
  const site = channels.siteUrl();
  const line = (channel: string, result: LeadNotifyResult) =>
    log(
      `[bot] уведомление о заявке ${lead.id} (бот ${solution.id}): ${channel} — ${logText(result)}`,
    );

  let email: LeadNotifyResult;
  if (!settings.email) {
    email = 'off';
  } else if (!channels.mailer || channels.mailer.kind === 'none') {
    email = 'mail_not_configured';
  } else if (!owner.email) {
    email = 'no_email';
  } else {
    const { title, details, link } = leadNoticeLines(solution, lead, site);
    const lines = [title, '', ...details, '', `Все заявки и диалоги: ${link}`];
    try {
      await channels.mailer.send({
        to: owner.email,
        subject: `Новая заявка: ${lead.name.replace(/\s+/g, ' ')}`,
        text: lines.join('\n'),
        html: lines.map((part) => `<p>${escapeHtml(part)}</p>`).join(''),
      });
      email = 'sent';
    } catch (error) {
      email = `failed:${failureCode(error)}`;
    }
  }
  line('письмо', email);

  let telegram: LeadNotifyResult;
  if (!settings.telegram) {
    telegram = 'off';
  } else if (!channels.telegram) {
    telegram = 'telegram_not_configured';
  } else if (!channels.telegram.canNotify(owner.userId)) {
    telegram = 'telegram_not_linked';
  } else {
    try {
      await channels.telegram.notifyOwner(owner.userId, leadTelegramText(solution, lead, site));
      telegram = 'sent';
    } catch (error) {
      telegram = `failed:${failureCode(error)}`;
    }
  }
  line('Telegram', telegram);
  return { email, telegram };
}
