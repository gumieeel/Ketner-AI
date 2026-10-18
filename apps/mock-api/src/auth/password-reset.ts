import { createHash, randomBytes } from 'node:crypto';

/**
 * Разрешение задать новый пароль после верного кода из письма (восстановление пароля).
 *
 * Код подтверждает, что человек владеет почтой, но новый пароль он вводит уже на следующем экране.
 * Между шагами браузер держит одноразовый токен: он живёт 15 минут, хранится только его хеш, после
 * смены пароля сгорают все токены этого аккаунта. В памяти процесса, как и заявки с кодами.
 */

export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

interface Grant {
  userId: string;
  email: string;
  expiresAt: number;
}

export interface IssuedGrant {
  token: string;
  expiresAt: number;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class PasswordResetGrants {
  private byHash = new Map<string, Grant>();

  issue(userId: string, email: string, now = Date.now()): IssuedGrant {
    this.sweep(now);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = now + PASSWORD_RESET_TTL_MS;
    this.byHash.set(hashToken(token), { userId, email, expiresAt });
    return { token, expiresAt };
  }

  /** Действующий токен (null — неизвестен или истёк). Не расходует его. */
  peek(token: string, now = Date.now()): Grant | null {
    const grant = this.byHash.get(hashToken(token));
    if (!grant) return null;
    if (grant.expiresAt <= now) {
      this.byHash.delete(hashToken(token));
      return null;
    }
    return grant;
  }

  /** Пароль сменён: все токены аккаунта больше не действуют. */
  revokeUser(userId: string): void {
    for (const [hash, grant] of this.byHash) {
      if (grant.userId === userId) this.byHash.delete(hash);
    }
  }

  private sweep(now: number): void {
    for (const [hash, grant] of this.byHash) {
      if (grant.expiresAt <= now) this.byHash.delete(hash);
    }
  }
}
