import type { MailMessage } from '../services/mailer.js';

/** Письма с кодами регистрации по адресу тестового сервера. */
const mailsByServer = new Map<string, MailMessage[]>();

export function rememberSignupMail(baseUrl: string, mails: MailMessage[]): void {
  mailsByServer.set(baseUrl, mails);
}

/** Код из последнего письма регистрации на этот адрес. */
export function signupCodeFor(baseUrl: string, email: string): string {
  const mail = [...(mailsByServer.get(baseUrl) ?? [])].reverse().find((item) => item.to === email);
  const code = mail ? /\b(\d{6})\b/.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`Письмо с кодом регистрации для ${email} не найдено`);
  return code;
}

/**
 * Регистрация целиком: форма → код из письма → аккаунт. Возвращает ответ подтверждения (201 и сессия)
 * или ответ формы, если она отклонена (400, 409, 429…).
 */
export async function signupAndVerify(baseUrl: string, init: RequestInit): Promise<Response> {
  const start = await fetch(`${baseUrl}/api/auth/signup`, init);
  if (start.status !== 202) return start;
  const { signupId, email } = (await start.json()) as { signupId: string; email: string };
  return fetch(`${baseUrl}/api/auth/signup/verify`, {
    method: 'POST',
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ signupId, code: signupCodeFor(baseUrl, email) }),
  });
}
