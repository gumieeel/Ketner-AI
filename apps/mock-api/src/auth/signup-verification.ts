import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { SignupAttribution } from '../services/signup-attribution.js';

/**
 * Регистрация по почте с подтверждением кодом из письма.
 *
 * Форма регистрации не создаёт аккаунт сразу: сервер запоминает введённые данные, отправляет на
 * почту 6-значный код и отдаёт браузеру секретный `signupId`. Аккаунт появляется только когда тот же
 * браузер присылает `signupId` вместе с кодом — так подтверждается владение почтой.
 *
 * Код привязан к своей заявке, а не к адресу: если посторонний отправит форму с чужой почтой и своим
 * паролем, код придёт владельцу почты, а заявку постороннего им не подтвердить (у него её `signupId`,
 * у владельца — код от неё, но владелец его просто проигнорирует). Хранится только хеш кода; после
 * 5 неверных попыток код сгорает, новый можно запросить не чаще раза в минуту.
 *
 * Заявки живут в памяти процесса (пароль — до подтверждения, не дольше часа): после перезапуска
 * достаточно зарегистрироваться заново.
 */

export const SIGNUP_CODE_TTL_MS = 10 * 60 * 1000;
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;
export const SIGNUP_CODE_RESEND_MS = 60 * 1000;
/** Сколько живёт сама заявка: за это время можно несколько раз запросить новый код. */
export const SIGNUP_PENDING_TTL_MS = 60 * 60 * 1000;

export interface PendingSignupData {
  email: string;
  password: string;
  name?: string;
  attribution?: SignupAttribution;
}

interface PendingSignup extends PendingSignupData {
  /** null — код сгорел после неверных попыток, нужен новый. */
  codeHash: Buffer | null;
  codeExpiresAt: number;
  codeIssuedAt: number;
  attempts: number;
  expiresAt: number;
}

export interface IssuedSignupCode {
  signupId: string;
  code: string;
  email: string;
  codeExpiresAt: number;
}

export type SignupCodeCheck =
  | { ok: true; data: PendingSignupData }
  | { ok: false; reason: 'missing' | 'expired' | 'used_up' }
  | { ok: false; reason: 'invalid'; attemptsLeft: number };

const hashCode = (code: string): Buffer => createHash('sha256').update(code).digest();
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export class PendingSignups {
  private byId = new Map<string, PendingSignup>();

  /** Новая заявка на регистрацию и первый код к ней. */
  create(data: PendingSignupData, now = Date.now()): IssuedSignupCode {
    this.sweep(now);
    const signupId = randomBytes(24).toString('base64url');
    const code = newCode();
    this.byId.set(signupId, {
      ...data,
      codeHash: hashCode(code),
      codeExpiresAt: now + SIGNUP_CODE_TTL_MS,
      codeIssuedAt: now,
      attempts: 0,
      expiresAt: now + SIGNUP_PENDING_TTL_MS,
    });
    return { signupId, code, email: data.email, codeExpiresAt: now + SIGNUP_CODE_TTL_MS };
  }

  /** Почта заявки (null — заявки нет или она истекла). */
  emailOf(signupId: string, now = Date.now()): string | null {
    return this.live(signupId, now)?.email ?? null;
  }

  /** Через сколько миллисекунд можно прислать новый код (0 — уже можно). */
  resendIn(signupId: string, now = Date.now()): number {
    const pending = this.live(signupId, now);
    if (!pending) return 0;
    return Math.max(0, pending.codeIssuedAt + SIGNUP_CODE_RESEND_MS - now);
  }

  /** Новый код для заявки; прежний перестаёт действовать. null — заявки нет. */
  reissue(signupId: string, now = Date.now()): IssuedSignupCode | null {
    const pending = this.live(signupId, now);
    if (!pending) return null;
    const code = newCode();
    pending.codeHash = hashCode(code);
    pending.codeExpiresAt = now + SIGNUP_CODE_TTL_MS;
    pending.codeIssuedAt = now;
    pending.attempts = 0;
    return { signupId, code, email: pending.email, codeExpiresAt: pending.codeExpiresAt };
  }

  /** Проверка кода. Верный код закрывает заявку и возвращает её данные. */
  check(signupId: string, raw: string, now = Date.now()): SignupCodeCheck {
    const pending = this.live(signupId, now);
    if (!pending) return { ok: false, reason: 'missing' };
    if (!pending.codeHash) return { ok: false, reason: 'used_up' };
    if (pending.codeExpiresAt <= now) return { ok: false, reason: 'expired' };
    const code = raw.replace(/\D/g, '');
    if (code.length === 6 && timingSafeEqual(hashCode(code), pending.codeHash)) {
      this.byId.delete(signupId);
      const { email, password, name, attribution } = pending;
      return { ok: true, data: { email, password, name, attribution } };
    }
    pending.attempts += 1;
    if (pending.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) {
      pending.codeHash = null;
      return { ok: false, reason: 'used_up' };
    }
    return {
      ok: false,
      reason: 'invalid',
      attemptsLeft: SIGNUP_CODE_MAX_ATTEMPTS - pending.attempts,
    };
  }

  private live(signupId: string, now: number): PendingSignup | null {
    const pending = this.byId.get(signupId);
    if (!pending) return null;
    if (pending.expiresAt <= now) {
      this.byId.delete(signupId);
      return null;
    }
    return pending;
  }

  private sweep(now: number): void {
    for (const [id, pending] of this.byId) {
      if (pending.expiresAt <= now) this.byId.delete(id);
    }
  }
}

/**
 * Письмо с кодом подтверждения регистрации. Имя из формы в письмо не попадает: форму может отправить
 * кто угодно с чужой почтой, и письмо не должно нести его текст.
 */
export function signupCodeMail(to: string, code: string) {
  const minutes = Math.round(SIGNUP_CODE_TTL_MS / 60_000);
  const text = [
    'Здравствуйте!',
    '',
    `Код подтверждения регистрации в Ketner AI: ${code}`,
    '',
    `Введите его на странице регистрации, чтобы завершить создание аккаунта. Код действует ${minutes} минут.`,
    '',
    'Никому не сообщайте этот код. Сотрудники Ketner никогда его не спрашивают.',
    '',
    'Если вы не регистрировались в Ketner AI, просто проигнорируйте письмо — без кода аккаунт не будет создан.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b1f1d">
<p>Здравствуйте!</p>
<p>Код подтверждения регистрации в Ketner AI:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>Введите его на странице регистрации, чтобы завершить создание аккаунта. Код действует ${minutes} минут.</p>
<p><b>Никому не сообщайте этот код.</b> Сотрудники Ketner никогда его не спрашивают.</p>
<p style="color:#5d6762">Если вы не регистрировались в Ketner AI, просто проигнорируйте письмо — без кода аккаунт не будет создан.</p>
</div>`;
  return { to, subject: `${code} — код подтверждения Ketner AI`, text, html };
}
