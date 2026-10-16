import { pbkdf2Sync, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, isProduction } from '../config.js';
import type { PlanId, User } from '../types.js';
import { isVipEmail, isAdminEmail } from '../services/vip.js';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  salt: string;
  passwordHash: string;
  isVip?: boolean;
  isAdmin?: boolean;
  telegramChatId?: number | string;
  telegramUsername?: string;
}

export interface UserStore {
  list(): User[];
  findById(id: string): User | null;
  findByEmail(email: string): User | null;
  findByTelegramChatId(chatId: number | string): User | null;
  create(email: string, password: string, name?: string): User;
  verifyPassword(email: string, password: string): User | null;
  setPassword(email: string, password: string): User | null;
  updatePlan(id: string, plan: PlanId): User | null;
  setVip(id: string, isVip: boolean): User | null;
  setAdmin(id: string, isAdmin: boolean): User | null;
  linkTelegram(id: string, chatId: number | string, username?: string): User | null;
  unlinkTelegram(id: string): User | null;
  /**
   * Создаёт первичного администратора из SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
   * Вызывать после загрузки пользователей из БД.
   */
  ensureSeedAdmin?(): void;
  /** Загрузить пользователей из внешнего источника (БД). */
  loadExternalUsers?(users: StoredUser[]): void;
  /** Установить драйвер персистентности в БД. */
  setDbDriver?(driver: UserDbDriver | null): void;
  /** Получить всех сохранённых пользователей со всеми техническими полями. */
  getAllStoredUsers?(): StoredUser[];
}

export interface UserDbDriver {
  onUserCreated?: (user: StoredUser) => Promise<void> | void;
  onPlanUpdated?: (userId: string, plan: PlanId) => Promise<void> | void;
  onVipUpdated?: (userId: string, isVip: boolean) => Promise<void> | void;
  onAdminUpdated?: (userId: string, isAdmin: boolean) => Promise<void> | void;
  onTelegramUpdated?: (
    userId: string,
    chatId: number | string | null,
    username?: string | null,
  ) => Promise<void> | void;
  onPasswordUpdated?: (
    userId: string,
    salt: string,
    passwordHash: string,
  ) => Promise<void> | void;
}

interface Snapshot {
  users: StoredUser[];
}

/**
 * Прежний формат хеша: PBKDF2-SHA256 на 1000 итераций (в сотни раз слабее рекомендаций OWASP).
 * Остаётся только для проверки старых паролей: после удачного входа хеш пересчитывается в scrypt.
 */
function hashPasswordLegacy(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
}

/** Параметры scrypt: N=2^15, r=8, p=1 (≈ 32 МБ памяти и десятки миллисекунд на попытку). */
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_PREFIX = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`;

function hashPassword(password: string, salt: string): string {
  const derived = scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `${SCRYPT_PREFIX}${derived.toString('hex')}`;
}

/** Проверка пароля против хеша любого поддерживаемого формата. */
function passwordMatches(password: string, salt: string, storedHash: string): boolean {
  if (storedHash.startsWith('scrypt$')) {
    const [, n, r, p, hex] = storedHash.split('$');
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P) || !hex) return false;
    const derived = scryptSync(password, salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
    return hashesEqual(derived.toString('hex'), hex);
  }
  return hashesEqual(hashPasswordLegacy(password, salt), storedHash);
}

/** Фиктивная проверка для несуществующего email: время ответа не выдаёт, есть ли такой аккаунт. */
const DUMMY_SALT = randomBytes(16).toString('hex');
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'), DUMMY_SALT);

/** Сравнение хешей за константное время. */
function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function toPublicUser(user: StoredUser): User {
  const isVip = user.isVip ?? isVipEmail(user.email);
  const isAdmin = user.isAdmin ?? isAdminEmail(user.email);
  const plan: PlanId = isVip ? 'ultra' : user.plan;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan,
    createdAt: user.createdAt,
    isVip,
    isAdmin,
    telegramChatId: user.telegramChatId,
    telegramUsername: user.telegramUsername,
  };
}

const DEFAULT_DEMO_USER: StoredUser = (() => {
  const salt = '00000000000000000000000000000000';
  return {
    id: 'demo-user',
    email: 'demo@ketner.ai',
    name: 'Ketner Demo',
    plan: 'free',
    createdAt: '2026-09-22T00:00:00.000Z',
    salt,
    passwordHash: hashPasswordLegacy('password123', salt),
  };
})();

/**
 * Соли, зашитые в код прежних версий (демо-аккаунт и админ с паролем из репозитория).
 * Аккаунты с такими солями считаются скомпрометированными: в production войти в них нельзя,
 * пока пароль не сменён (см. ensureSeedAdmin / setPassword).
 */
const COMPROMISED_SALTS: ReadonlySet<string> = new Set([
  '00000000000000000000000000000000',
  '11111111111111111111111111111111',
]);

const DEMO_EMAIL = 'demo@ketner.ai';
/** Длиннее пароли не хешируются: защита от DoS дорогим KDF на мегабайтных строках. */
export const MAX_PASSWORD_LENGTH = 256;
const MIN_SEED_PASSWORD_LENGTH = 12;
const SEED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSnapshot(file: string): Snapshot {
  const demo = config.enableDemoAccount ? [DEFAULT_DEMO_USER] : [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>;
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    if (config.enableDemoAccount && !users.some((u) => u.email.toLowerCase() === DEMO_EMAIL)) {
      users.push(DEFAULT_DEMO_USER);
    }
    return { users };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище пользователей не прочитано, начинаем заново:', error);
    }
    return { users: demo };
  }
}

function writeSnapshot(file: string, snapshot: Snapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

/**
 * Хранилище пользователей в файле.
 *
 * Сохраняет пользователей и хеши паролей для mock-аутентификации.
 * Настоящая система в будущем заменится на Supabase / Auth0.
 */
export function createUserStore(file: string): UserStore {
  const snapshot = readSnapshot(file);
  let dbDriver: UserDbDriver | null = null;

  const persist = (): void => writeSnapshot(file, snapshot);

  // Если файл создаётся впервые или пустой, сохраняем дефолтного пользователя
  try {
    persist();
  } catch {
    // В некоторых тестовых средах запись может быть опциональной
  }

  const store: UserStore = {
    list() {
      return snapshot.users.map(toPublicUser);
    },

    findById(id: string) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      return user ? toPublicUser(user) : null;
    },

    findByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      const user = snapshot.users.find((candidate) => candidate.email.toLowerCase() === normalized);
      return user ? toPublicUser(user) : null;
    },

    create(email: string, password: string, name?: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const resolvedName = name?.trim() || normalizedEmail.split('@')[0] || 'User';
      const salt = randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);

      const isVip = isVipEmail(normalizedEmail);
      const isAdmin = isAdminEmail(normalizedEmail);
      const plan: PlanId = isVip ? 'ultra' : 'free';

      const newUser: StoredUser = {
        id: randomUUID(),
        email: normalizedEmail,
        name: resolvedName,
        plan,
        createdAt: new Date().toISOString(),
        salt,
        passwordHash,
        isVip,
        isAdmin,
      };

      snapshot.users.push(newUser);
      persist();
      dbDriver?.onUserCreated?.({ ...newUser })?.catch?.((err) =>
        console.error('[db] Error persisting created user:', err),
      );

      return toPublicUser(newUser);
    },

    verifyPassword(email: string, password: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const stored = snapshot.users.find(
        (candidate) => candidate.email.toLowerCase() === normalizedEmail,
      );
      if (!stored || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
        passwordMatches(String(password).slice(0, MAX_PASSWORD_LENGTH), DUMMY_SALT, DUMMY_HASH);
        return null;
      }

      // В production аккаунты с публично известным паролем из старых версий закрыты.
      const isDemo = stored.email.toLowerCase() === DEMO_EMAIL && config.enableDemoAccount;
      if (isProduction && COMPROMISED_SALTS.has(stored.salt) && !isDemo) {
        return null;
      }

      if (!stored.passwordHash || !stored.salt || !passwordMatches(password, stored.salt, stored.passwordHash)) {
        return null;
      }

      // Старый хеш (PBKDF2, 1000 итераций) прозрачно заменяется на scrypt при первом удачном входе.
      if (!stored.passwordHash.startsWith('scrypt$') && !COMPROMISED_SALTS.has(stored.salt)) {
        stored.salt = randomBytes(16).toString('hex');
        stored.passwordHash = hashPassword(password, stored.salt);
        persist();
        dbDriver?.onPasswordUpdated?.(stored.id, stored.salt, stored.passwordHash)?.catch?.((err) =>
          console.error('[db] Error persisting upgraded password hash:', err),
        );
      }

      return toPublicUser(stored);
    },

    setPassword(email: string, password: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.email.toLowerCase() === normalizedEmail,
      );
      if (!user) {
        return null;
      }
      user.salt = randomBytes(16).toString('hex');
      user.passwordHash = hashPassword(password, user.salt);
      persist();
      dbDriver?.onPasswordUpdated?.(user.id, user.salt, user.passwordHash)?.catch?.((err) =>
        console.error('[db] Error persisting updated password:', err),
      );
      return toPublicUser(user);
    },

    updatePlan(id: string, plan: PlanId) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      if (!user) {
        return null;
      }
      user.plan = plan;
      persist();
      dbDriver?.onPlanUpdated?.(user.id, plan)?.catch?.((err) =>
        console.error('[db] Error persisting plan update:', err),
      );
      return toPublicUser(user);
    },

    setVip(id: string, isVip: boolean) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      if (!user) {
        return null;
      }
      user.isVip = isVip;
      persist();
      dbDriver?.onVipUpdated?.(user.id, isVip)?.catch?.((err) =>
        console.error('[db] Error persisting VIP update:', err),
      );
      return toPublicUser(user);
    },

    setAdmin(id: string, isAdmin: boolean) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      if (!user) {
        return null;
      }
      user.isAdmin = isAdmin;
      persist();
      dbDriver?.onAdminUpdated?.(user.id, isAdmin)?.catch?.((err) =>
        console.error('[db] Error persisting admin update:', err),
      );
      return toPublicUser(user);
    },

    findByTelegramChatId(chatId: number | string) {
      const target = String(chatId);
      const user = snapshot.users.find(
        (candidate) =>
          candidate.telegramChatId !== undefined && String(candidate.telegramChatId) === target,
      );
      return user ? toPublicUser(user) : null;
    },

    linkTelegram(id: string, chatId: number | string, username?: string) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      if (!user) {
        return null;
      }
      user.telegramChatId = chatId;
      if (username) {
        user.telegramUsername = username.replace(/^@/, '');
      }
      persist();
      dbDriver?.onTelegramUpdated?.(user.id, chatId, user.telegramUsername)?.catch?.((err) =>
        console.error('[db] Error persisting Telegram link:', err),
      );
      return toPublicUser(user);
    },

    unlinkTelegram(id: string) {
      const normalized = id.trim().toLowerCase();
      const user = snapshot.users.find(
        (candidate) => candidate.id === id || candidate.email.toLowerCase() === normalized,
      );
      if (!user) {
        return null;
      }
      delete user.telegramChatId;
      delete user.telegramUsername;
      persist();
      dbDriver?.onTelegramUpdated?.(user.id, null, null)?.catch?.((err) =>
        console.error('[db] Error persisting Telegram unlink:', err),
      );
      return toPublicUser(user);
    },

    loadExternalUsers(users) {
      for (const inc of users) {
        const idx = snapshot.users.findIndex(
          (u) => u.id === inc.id || u.email.toLowerCase() === inc.email.toLowerCase(),
        );
        if (idx >= 0) {
          snapshot.users[idx] = inc;
        } else {
          snapshot.users.push(inc);
        }
      }
      try {
        persist();
      } catch {
        // ignore in memory/readonly environments
      }
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },

    getAllStoredUsers() {
      return [...snapshot.users];
    },

    ensureSeedAdmin() {
      const email = config.seedAdminEmail;
      const password = config.seedAdminPassword;
      if (!email || !password) {
        return;
      }
      if (!SEED_EMAIL_PATTERN.test(email)) {
        // Значение намеренно не печатаем: при ошибке конфигурации там может оказаться пароль.
        console.warn('[auth] SEED_ADMIN_EMAIL не похож на email: первичный администратор не создан');
        return;
      }
      if (password.length < MIN_SEED_PASSWORD_LENGTH) {
        console.warn(
          `[auth] SEED_ADMIN_PASSWORD короче ${MIN_SEED_PASSWORD_LENGTH} символов: админ не создан`,
        );
        return;
      }

      const existing = snapshot.users.find((u) => u.email.toLowerCase() === email);
      if (!existing) {
        const created = store.create(email, password, 'Administrator');
        store.setAdmin(created.id, true);
        store.setVip(created.id, true);
        console.log(`[auth] Создан первичный администратор ${email}`);
        return;
      }

      // Аккаунт со старым публичным паролем: восстанавливаем доступ владельцу новым паролем.
      if (COMPROMISED_SALTS.has(existing.salt)) {
        store.setPassword(email, password);
        store.setAdmin(existing.id, true);
        store.setVip(existing.id, true);
        console.log(`[auth] Пароль администратора ${email} заменён (старый был публичным)`);
        return;
      }

      // Аккаунт уже существует и его пароль не скомпрометирован: ничего не меняем.
      console.warn(`[auth] ${email} уже зарегистрирован: SEED_ADMIN_* проигнорирован`);
    },
  };
  return store;
}
