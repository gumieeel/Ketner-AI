import type { MailMessage } from '../services/mailer.js';

/** Письма с кодами (регистрация и вход) по адресу тестового сервера. */
const mailsByServer = new Map<string, MailMessage[]>();

export function rememberCodeMails(baseUrl: string, mails: MailMessage[]): void {
  mailsByServer.set(baseUrl, mails);
}

/** Письмо с кодом регистрации или входа: его перехватывает тестовый почтовик. */
export function isCodeMail(message: MailMessage): boolean {
  return /код (подтверждения|входа)/.test(message.subject);
}

/** Код из последнего письма регистрации или входа на этот адрес. */
export function codeFor(baseUrl: string, email: string): string {
  const target = email.trim().toLowerCase();
  const mail = [...(mailsByServer.get(baseUrl) ?? [])].reverse().find((item) => item.to === target);
  const code = mail ? /\b(\d{6})\b/.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`Письмо с кодом для ${email} не найдено`);
  return code;
}

async function withCode(
  baseUrl: string,
  flow: 'signup' | 'login',
  init: RequestInit,
): Promise<Response> {
  const start = await fetch(`${baseUrl}/api/auth/${flow}`, init);
  if (start.status !== 202) return start;
  const { challengeId } = (await start.json()) as { challengeId: string };
  const { email } = JSON.parse(String(init.body)) as { email: string };
  return fetch(`${baseUrl}/api/auth/${flow}/verify`, {
    method: 'POST',
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ challengeId, code: codeFor(baseUrl, email) }),
  });
}

/**
 * Регистрация целиком: форма → код из письма → аккаунт. Возвращает ответ подтверждения (201 и сессия)
 * или ответ формы, если она отклонена (400, 409, 429…).
 */
export function signupAndVerify(baseUrl: string, init: RequestInit): Promise<Response> {
  return withCode(baseUrl, 'signup', init);
}

/** Вход целиком: почта и пароль → код из письма → сессия (200) или ответ формы (401, 429…). */
export function loginAndVerify(baseUrl: string, init: RequestInit): Promise<Response> {
  return withCode(baseUrl, 'login', init);
}
