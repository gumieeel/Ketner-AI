import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
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
    passwordHash: hashPassword('password123', salt),
  };
})();

const DEFAULT_ADMIN_USER: StoredUser = (() => {
  const salt = '11111111111111111111111111111111';
  return {
    id: 'admin-artem-user',
    email: 'artemsinyakov09@gmail.com',
    name: 'Артем Синяков',
    plan: 'ultra',
    isVip: true,
    isAdmin: true,
    createdAt: '2026-09-22T00:00:00.000Z',
    salt,
    passwordHash: hashPassword('password123', salt),
  };
})();

function isTestEnvironment(file: string): boolean {
  return (
    file.includes('ketner-mock-api-') ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST)
  );
}

function readSnapshot(file: string): Snapshot {
  const isTest = isTestEnvironment(file);
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>;
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    if (!users.some((u) => u.email.toLowerCase() === 'demo@ketner.ai')) {
      users.push(DEFAULT_DEMO_USER);
    }
    if (!isTest && !users.some((u) => u.email.toLowerCase() === 'artemsinyakov09@gmail.com')) {
      users.unshift(DEFAULT_ADMIN_USER);
    }
    return { users };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище пользователей не прочитано, создаём демо:', error);
    }
    if (!isTest) {
      return { users: [DEFAULT_ADMIN_USER, DEFAULT_DEMO_USER] };
    }
    return { users: [DEFAULT_DEMO_USER] };
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

  return {
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
      if (!stored) {
        return null;
      }

      const hash = hashPassword(password, stored.salt);
      if (hash !== stored.passwordHash) {
        return null;
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
  };
}
