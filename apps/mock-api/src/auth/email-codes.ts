import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Подтверждение входа и регистрации кодом из письма.
 *
 * Сначала человек вводит данные (форма регистрации или почта с паролем), сервер запоминает их как
 * заявку, отправляет на почту 6-значный код и отдаёт браузеру секретный id заявки. Аккаунт создаётся
 * или сессия выдаётся только когда тот же браузер присылает id вместе с кодом.
 *
 * Код привязан к своей заявке, а не к адресу: если посторонний отправит форму с чужой почтой, код
 * придёт владельцу почты, а заявку постороннего этим кодом не подтвердить. Хранится только хеш кода;
 * код живёт 5 минут, после 5 неверных попыток сгорает, новый можно запросить не чаще раза в минуту.
 * Верный код сразу удаляет заявку.
 *
 * Заявки живут в памяти процесса (вместе с паролем — до подтверждения, не дольше получаса): после
 * перезапуска достаточно начать заново.
 */

export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MS = 5 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_MS = 60 * 1000;
/** Сколько живёт сама заявка: за это время можно несколько раз запросить новый код. */
export const EMAIL_CHALLENGE_TTL_MS = 30 * 60 * 1000;

interface Challenge<T> {
  data: T;
  /** null — код сгорел после неверных попыток, нужен новый. */
  codeHash: Buffer | null;
  codeExpiresAt: number;
  codeIssuedAt: number;
  attempts: number;
  expiresAt: number;
}

export interface IssuedCode {
  id: string;
  code: string;
  email: string;
  codeExpiresAt: number;
}

export type CodeCheck<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'missing' | 'expired' | 'used_up' }
  | { ok: false; reason: 'invalid'; attemptsLeft: number };

const hashCode = (code: string): Buffer => createHash('sha256').update(code).digest();
const newCode = (): string =>
  String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');

export class EmailCodeChallenges<T extends { email: string }> {
  private byId = new Map<string, Challenge<T>>();

  /** Новая заявка и первый код к ней. */
  create(data: T, now = Date.now()): IssuedCode {
    this.sweep(now);
    const id = randomBytes(24).toString('base64url');
    const code = newCode();
    this.byId.set(id, {
      data,
      codeHash: hashCode(code),
      codeExpiresAt: now + EMAIL_CODE_TTL_MS,
      codeIssuedAt: now,
      attempts: 0,
      expiresAt: now + EMAIL_CHALLENGE_TTL_MS,
    });
    return { id, code, email: data.email, codeExpiresAt: now + EMAIL_CODE_TTL_MS };
  }

  /** Почта заявки (null — заявки нет или она истекла). */
  emailOf(id: string, now = Date.now()): string | null {
    return this.live(id, now)?.data.email ?? null;
  }

  /** Через сколько миллисекунд можно прислать новый код (0 — уже можно). */
  resendIn(id: string, now = Date.now()): number {
    const challenge = this.live(id, now);
    if (!challenge) return 0;
    return Math.max(0, challenge.codeIssuedAt + EMAIL_CODE_RESEND_MS - now);
  }

  /** Новый код для заявки; прежний перестаёт действовать. null — заявки нет. */
  reissue(id: string, now = Date.now()): IssuedCode | null {
    const challenge = this.live(id, now);
    if (!challenge) return null;
    const code = newCode();
    challenge.codeHash = hashCode(code);
    challenge.codeExpiresAt = now + EMAIL_CODE_TTL_MS;
    challenge.codeIssuedAt = now;
    challenge.attempts = 0;
    return { id, code, email: challenge.data.email, codeExpiresAt: challenge.codeExpiresAt };
  }

  /** Проверка кода. Верный код закрывает заявку и возвращает её данные. */
  check(id: string, raw: string, now = Date.now()): CodeCheck<T> {
    const challenge = this.live(id, now);
    if (!challenge) return { ok: false, reason: 'missing' };
    if (!challenge.codeHash) return { ok: false, reason: 'used_up' };
    if (challenge.codeExpiresAt <= now) {
      challenge.codeHash = null;
      return { ok: false, reason: 'expired' };
    }
    const code = raw.replace(/\D/g, '');
    if (code.length === EMAIL_CODE_LENGTH && timingSafeEqual(hashCode(code), challenge.codeHash)) {
      this.byId.delete(id);
      return { ok: true, data: challenge.data };
    }
    challenge.attempts += 1;
    if (challenge.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      challenge.codeHash = null;
      return { ok: false, reason: 'used_up' };
    }
    return {
      ok: false,
      reason: 'invalid',
      attemptsLeft: EMAIL_CODE_MAX_ATTEMPTS - challenge.attempts,
    };
  }

  private live(id: string, now: number): Challenge<T> | null {
    const challenge = this.byId.get(id);
    if (!challenge) return null;
    if (challenge.expiresAt <= now) {
      this.byId.delete(id);
      return null;
    }
    return challenge;
  }

  private sweep(now: number): void {
    for (const [id, challenge] of this.byId) {
      if (challenge.expiresAt <= now) this.byId.delete(id);
    }
  }
}

/** Почта для показа на экране: `i***v@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const masked = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}${email.slice(at)}`;
}

export type EmailCodePurpose = 'signup' | 'login';

const PURPOSE_TEXT: Record<EmailCodePurpose, { lead: string; action: string; ignore: string }> = {
  signup: {
    lead: 'Код подтверждения регистрации в Ketner AI',
    action: 'Введите его на странице регистрации, чтобы завершить создание аккаунта.',
    ignore:
      'Если вы не регистрировались в Ketner AI, просто проигнорируйте письмо — без кода аккаунт не будет создан.',
  },
  login: {
    lead: 'Код для входа в Ketner AI',
    action: 'Введите его на странице входа.',
    ignore:
      'Если вы не входили в Ketner AI, кто-то знает ваш пароль: смените его в настройках. Без кода войти в аккаунт нельзя.',
  },
};

/**
 * Письмо с кодом. Имя из формы в письмо не попадает: форму может отправить кто угодно с чужой
 * почтой, и письмо не должно нести его текст.
 */
export function emailCodeMail(purpose: EmailCodePurpose, to: string, code: string) {
  const minutes = Math.round(EMAIL_CODE_TTL_MS / 60_000);
  const copy = PURPOSE_TEXT[purpose];
  const text = [
    'Здравствуйте!',
    '',
    `${copy.lead}: ${code}`,
    '',
    `${copy.action} Код действует ${minutes} минут.`,
    '',
    'Никому не сообщайте этот код. Сотрудники Ketner никогда его не спрашивают.',
    '',
    copy.ignore,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b1f1d">
<p>Здравствуйте!</p>
<p>${copy.lead}:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>${copy.action} Код действует ${minutes} минут.</p>
<p><b>Никому не сообщайте этот код.</b> Сотрудники Ketner никогда его не спрашивают.</p>
<p style="color:#5d6762">${copy.ignore}</p>
</div>`;
  const subject =
    purpose === 'signup'
      ? `${code} — код подтверждения Ketner AI`
      : `${code} — код входа в Ketner AI`;
  return { to, subject, text, html };
}
