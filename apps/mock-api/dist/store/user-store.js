import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
function hashPassword(password, salt) {
    return pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
}
function toPublicUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        createdAt: user.createdAt,
    };
}
const DEFAULT_DEMO_USER = (() => {
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
function readSnapshot(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const users = Array.isArray(parsed.users) ? parsed.users : [];
        if (users.length === 0) {
            return { users: [DEFAULT_DEMO_USER] };
        }
        return { users };
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('[mock-api] хранилище пользователей не прочитано, создаём демо:', error);
        }
        return { users: [DEFAULT_DEMO_USER] };
    }
}
function writeSnapshot(file, snapshot) {
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
export function createUserStore(file) {
    const snapshot = readSnapshot(file);
    const persist = () => writeSnapshot(file, snapshot);
    // Если файл создаётся впервые или пустой, сохраняем дефолтного пользователя
    try {
        persist();
    }
    catch {
        // В некоторых тестовых средах запись может быть опциональной
    }
    return {
        list() {
            return snapshot.users.map(toPublicUser);
        },
        findById(id) {
            const user = snapshot.users.find((candidate) => candidate.id === id);
            return user ? toPublicUser(user) : null;
        },
        findByEmail(email) {
            const normalized = email.trim().toLowerCase();
            const user = snapshot.users.find((candidate) => candidate.email.toLowerCase() === normalized);
            return user ? toPublicUser(user) : null;
        },
        create(email, password, name) {
            const normalizedEmail = email.trim().toLowerCase();
            const resolvedName = name?.trim() || normalizedEmail.split('@')[0] || 'User';
            const salt = randomBytes(16).toString('hex');
            const passwordHash = hashPassword(password, salt);
            const newUser = {
                id: randomUUID(),
                email: normalizedEmail,
                name: resolvedName,
                plan: 'free',
                createdAt: new Date().toISOString(),
                salt,
                passwordHash,
            };
            snapshot.users.push(newUser);
            persist();
            return toPublicUser(newUser);
        },
        verifyPassword(email, password) {
            const normalizedEmail = email.trim().toLowerCase();
            const stored = snapshot.users.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
            if (!stored) {
                return null;
            }
            const hash = hashPassword(password, stored.salt);
            if (hash !== stored.passwordHash) {
                return null;
            }
            return toPublicUser(stored);
        },
        updatePlan(id, plan) {
            const user = snapshot.users.find((candidate) => candidate.id === id);
            if (!user) {
                return null;
            }
            user.plan = plan;
            persist();
            return toPublicUser(user);
        },
    };
}
