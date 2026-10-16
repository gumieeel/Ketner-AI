import nodemailer from 'nodemailer';
import { config, isProduction } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Отправка писем (коды привязки Telegram и уведомления).
 *
 * - `smtp` — настоящий почтовый сервер из SMTP_* (подходит любой: Яндекс, Gmail, Mail.ru, Resend…);
 * - `console` — без SMTP вне production: письмо печатается в лог сервера, чтобы локально было
 *   видно код;
 * - `none` — в production без SMTP письма не уходят, вызывающий код сообщает об этом человеку.
 */
export interface Mailer {
  readonly kind: 'smtp' | 'console' | 'none';
  send(message: MailMessage): Promise<void>;
}

export function createMailer(): Mailer {
  const smtp = config.smtp;
  if (smtp.host && smtp.from) {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      // Не висеть на недоступном сервере: человек ждёт ответа в Telegram.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return {
      kind: 'smtp',
      async send(message) {
        await transport.sendMail({ from: smtp.from, ...message });
      },
    };
  }
  if (!isProduction) {
    return {
      kind: 'console',
      async send(message) {
        console.log(`[mailer:dev] письмо для ${message.to} — ${message.subject}\n${message.text}`);
      },
    };
  }
  return {
    kind: 'none',
    async send() {
      throw new Error('Отправка писем не настроена (SMTP_HOST, MAIL_FROM)');
    },
  };
}

export const mailer = createMailer();
