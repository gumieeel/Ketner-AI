import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { config } from '../config.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseSyncClass = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlite = (await import('node:sqlite'));
    DatabaseSyncClass = sqlite.DatabaseSync ?? null;
}
catch {
    DatabaseSyncClass = null;
}
export function createBetterAuth(options = {}) {
    const dbPath = options.dbPath ?? config.authDbFile;
    const isMemory = dbPath === ':memory:';
    let db;
    if (DatabaseSyncClass) {
        if (!isMemory) {
            mkdirSync(dirname(dbPath), { recursive: true });
        }
        const realDb = new DatabaseSyncClass(dbPath);
        try {
            realDb.exec(`
        CREATE TABLE IF NOT EXISTS "user" (
          "id" text not null primary key,
          "name" text not null,
          "email" text not null unique,
          "emailVerified" integer not null,
          "image" text,
          "createdAt" date not null,
          "updatedAt" date not null,
          "plan" text not null
        );
        CREATE TABLE IF NOT EXISTS "session" (
          "id" text not null primary key,
          "expiresAt" date not null,
          "token" text not null unique,
          "createdAt" date not null,
          "updatedAt" date not null,
          "ipAddress" text,
          "userAgent" text,
          "userId" text not null references "user" ("id") on delete cascade
        );
        CREATE TABLE IF NOT EXISTS "account" (
          "id" text not null primary key,
          "accountId" text not null,
          "providerId" text not null,
          "userId" text not null references "user" ("id") on delete cascade,
          "accessToken" text,
          "refreshToken" text,
          "idToken" text,
          "accessTokenExpiresAt" date,
          "refreshTokenExpiresAt" date,
          "scope" text,
          "password" text,
          "createdAt" date not null,
          "updatedAt" date not null
        );
        CREATE TABLE IF NOT EXISTS "verification" (
          "id" text not null primary key,
          "identifier" text not null,
          "value" text not null,
          "expiresAt" date not null,
          "createdAt" date not null,
          "updatedAt" date not null
        );
      `);
        }
        catch {
            // Игнорируем ошибки создания таблиц
        }
        db = realDb;
    }
    else {
        // Режим совместимости для сред без встроенного node:sqlite (Node 20):
        db = {
            exec: () => { },
            prepare: () => ({
                run: () => ({ changes: 0 }),
                get: () => null,
                all: () => [],
            }),
            close: () => { },
        };
    }
    const baseURL = options.baseURL ?? config.betterAuthUrl;
    const secret = options.secret ?? config.betterAuthSecret;
    const auth = betterAuth({
        baseURL,
        secret,
        ...(DatabaseSyncClass ? { database: db } : {}),
        emailAndPassword: {
            enabled: true,
            autoSignIn: true,
        },
        socialProviders: {
            ...(config.googleClientId && config.googleClientSecret
                ? {
                    google: {
                        clientId: config.googleClientId,
                        clientSecret: config.googleClientSecret,
                    },
                }
                : {}),
            ...(config.githubClientId && config.githubClientSecret
                ? {
                    github: {
                        clientId: config.githubClientId,
                        clientSecret: config.githubClientSecret,
                    },
                }
                : {}),
        },
        user: {
            additionalFields: {
                plan: {
                    type: 'string',
                    defaultValue: 'free',
                    input: false,
                },
            },
        },
        trustedOrigins: (request) => {
            const origin = request?.headers?.get('origin');
            if (!origin) {
                return [baseURL, config.corsOrigin];
            }
            if (origin.startsWith('http://localhost:') ||
                origin.startsWith('http://127.0.0.1:') ||
                origin.includes('ketner-ai') ||
                origin.includes('onrender.com') ||
                origin.includes('google.com')) {
                return [origin];
            }
            return [config.corsOrigin, baseURL];
        },
    });
    return { auth, db };
}
/**
 * Инициализирует базу данных Better Auth: выполняет миграции и сидирует демо-пользователя.
 */
export async function initAuthDatabase(authInstance) {
    if (DatabaseSyncClass) {
        try {
            const { runMigrations } = await getMigrations(authInstance.options);
            await runMigrations();
        }
        catch {
            // Миграции уже применены
        }
    }
    try {
        await authInstance.api.signUpEmail({
            body: {
                email: 'demo@ketner.ai',
                password: 'password123',
                name: 'Ketner Demo',
            },
        });
    }
    catch {
        // Демо-пользователь уже существует
    }
    try {
        defaultAuthDb?.prepare?.('UPDATE user SET plan = ? WHERE email = ?')?.run?.('ultra', 'artemsinyakov09@gmail.com');
    }
    catch {
        // База данных может быть in-memory в тестах или без sqlite
    }
}
export const { auth: defaultBetterAuth, db: defaultAuthDb } = createBetterAuth();
