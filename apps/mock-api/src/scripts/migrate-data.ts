import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, queryClient } from '../db/client.js';
import * as schema from '../db/schema.js';
import { config } from '../config.js';

interface StoredUserJson {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt?: string;
  salt?: string;
  passwordHash?: string;
  isVip?: boolean;
  isAdmin?: boolean;
}

interface StoredSubscriptionJson {
  userId: string;
  plan: string;
  status?: string;
  renewsAt?: string | null;
  createdAt?: string;
}

interface StoredMessageJson {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  createdAt?: string;
}

interface StoredConversationJson {
  id: string;
  userId: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

interface StoredStoreJson {
  conversations?: StoredConversationJson[];
  messages?: StoredMessageJson[];
}

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function migrateData() {
  console.log('====================================================');
  console.log('🚀 Ketner AI: Миграция данных (JSON → Supabase / PostgreSQL)');
  console.log('====================================================\n');

  if (!config.databaseUrl) {
    console.error('❌ ОШИБКА: Переменная DATABASE_URL не задана!');
    console.error('Для запуска миграции укажите строку подключения в .env:');
    console.error('DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres\n');
    process.exit(1);
  }

  const stats = {
    usersMigrated: 0,
    usersSkipped: 0,
    subscriptionsMigrated: 0,
    conversationsMigrated: 0,
    messagesMigrated: 0,
  };

  try {
    // 1. Миграция пользователей (users.json)
    console.log('📦 1/3: Чтение и перенос пользователей...');
    const userMap = new Map<string, string>(); // oldId -> ketner_users.id (UUID)
    const emailMap = new Map<string, string>(); // email -> ketner_users.id (UUID)

    if (existsSync(config.userStoreFile)) {
      const rawUsers = JSON.parse(readFileSync(config.userStoreFile, 'utf8'));
      const userList: StoredUserJson[] = Array.isArray(rawUsers.users) ? rawUsers.users : [];

      console.log(`Найдено записей пользователей в JSON: ${userList.length}`);

      for (const u of userList) {
        try {
          const email = u.email.trim().toLowerCase();
          const authId = u.id || randomUUID();
          const now = new Date();
          const createdAt = u.createdAt ? new Date(u.createdAt) : now;

          // 1.1 Better Auth User
          const existingAuthUser = await db
            .select()
            .from(schema.betterAuthUser)
            .where(eq(schema.betterAuthUser.email, email))
            .limit(1);

          let finalAuthId = authId;

          if (existingAuthUser.length === 0) {
            await db.insert(schema.betterAuthUser).values({
              id: authId,
              name: u.name || 'Пользователь',
              email,
              emailVerified: true,
              plan: u.plan || 'free',
              createdAt,
              updatedAt: now,
            });

            if (u.passwordHash) {
              // Сохраняем хеш пароля в таблицу account Better Auth
              await db.insert(schema.betterAuthAccount).values({
                id: randomUUID(),
                accountId: email,
                providerId: 'credential',
                userId: authId,
                password: u.passwordHash,
                createdAt,
                updatedAt: now,
              });
            }
          } else {
            finalAuthId = existingAuthUser[0].id;
          }

          // 1.2 Ketner Users
          const existingKetnerUser = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .limit(1);

          let ketnerUserId: string;

          if (existingKetnerUser.length === 0) {
            const inserted = await db
              .insert(schema.users)
              .values({
                betterAuthId: finalAuthId,
                email,
                name: u.name || 'Пользователь',
                plan: u.plan || 'free',
                createdAt,
                updatedAt: now,
              })
              .returning({ id: schema.users.id });

            ketnerUserId = inserted[0].id;
            stats.usersMigrated++;
            console.log(`  ✓ Добавлен пользователь: ${email} (ID: ${ketnerUserId})`);
          } else {
            ketnerUserId = existingKetnerUser[0].id;
            stats.usersSkipped++;
            console.log(`  ℹ Пропущен (уже существует): ${email}`);
          }

          userMap.set(u.id, ketnerUserId);
          emailMap.set(email, ketnerUserId);
        } catch (err) {
          console.error(`  ⚠ Ошибка при переносе пользователя ${u.email}:`, err);
        }
      }
    } else {
      console.log(`  ℹ Файл пользователей ${config.userStoreFile} не найден, пропускаем.`);
    }

    // 2. Миграция подписок (subscriptions.json)
    console.log('\n💳 2/3: Чтение и перенос подписок...');
    if (existsSync(config.subscriptionStoreFile)) {
      const rawSubs = JSON.parse(readFileSync(config.subscriptionStoreFile, 'utf8'));
      const subList: StoredSubscriptionJson[] = Array.isArray(rawSubs.subscriptions)
        ? rawSubs.subscriptions
        : [];

      for (const s of subList) {
        try {
          const ketnerUserId = userMap.get(s.userId) || emailMap.get(s.userId.toLowerCase());
          if (!ketnerUserId) {
            console.log(`  ⚠ Не найден пользователь для подписки: ${s.userId}, пропускаем.`);
            continue;
          }

          const existingSub = await db
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.userId, ketnerUserId))
            .limit(1);

          if (existingSub.length === 0) {
            await db.insert(schema.subscriptions).values({
              userId: ketnerUserId,
              plan: s.plan || 'free',
              status: s.status || 'active',
              currentPeriodEnd: s.renewsAt ? new Date(s.renewsAt) : null,
              createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
              updatedAt: new Date(),
            });
            stats.subscriptionsMigrated++;
            console.log(`  ✓ Перенесена подписка для ${s.userId} -> план ${s.plan}`);
          }
        } catch (err) {
          console.error(`  ⚠ Ошибка переноса подписки:`, err);
        }
      }
    } else {
      console.log(`  ℹ Файл подписок ${config.subscriptionStoreFile} не найден, пропускаем.`);
    }

    // 3. Миграция диалогов и сообщений (store.json)
    console.log('\n💬 3/3: Чтение и перенос диалогов и сообщений...');
    if (existsSync(config.storeFile)) {
      const rawStore = JSON.parse(readFileSync(config.storeFile, 'utf8')) as StoredStoreJson;
      const conversations = rawStore.conversations ?? [];
      const messages = rawStore.messages ?? [];

      const conversationIdMap = new Map<string, string>(); // oldId -> new UUID

      for (const conv of conversations) {
        try {
          const ketnerUserId =
            userMap.get(conv.userId) ||
            emailMap.get(conv.userId.toLowerCase()) ||
            userMap.get(config.demoUserId);

          if (!ketnerUserId) {
            continue;
          }

          const targetConvId = isValidUuid(conv.id) ? conv.id : randomUUID();
          conversationIdMap.set(conv.id, targetConvId);

          const existingConv = await db
            .select()
            .from(schema.conversations)
            .where(eq(schema.conversations.id, targetConvId))
            .limit(1);

          if (existingConv.length === 0) {
            await db.insert(schema.conversations).values({
              id: targetConvId,
              userId: ketnerUserId,
              title: conv.title || 'Новый диалог',
              createdAt: conv.createdAt ? new Date(conv.createdAt) : new Date(),
              updatedAt: conv.updatedAt ? new Date(conv.updatedAt) : new Date(),
            });
            stats.conversationsMigrated++;
          }
        } catch (err) {
          console.error(`  ⚠ Ошибка переноса диалога ${conv.id}:`, err);
        }
      }

      for (const msg of messages) {
        try {
          const convId = conversationIdMap.get(msg.conversationId) || msg.conversationId;
          if (!isValidUuid(convId)) continue;

          const targetMsgId = isValidUuid(msg.id) ? msg.id : randomUUID();

          const existingMsg = await db
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.id, targetMsgId))
            .limit(1);

          if (existingMsg.length === 0) {
            await db.insert(schema.messages).values({
              id: targetMsgId,
              conversationId: convId,
              role: msg.role || 'user',
              content: msg.content || '',
              model: msg.modelId || null,
              createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
              updatedAt: new Date(),
            });
            stats.messagesMigrated++;
          }
        } catch (err) {
          console.error(`  ⚠ Ошибка переноса сообщения ${msg.id}:`, err);
        }
      }
      console.log(`  ✓ Диалогов перенесено: ${stats.conversationsMigrated}`);
      console.log(`  ✓ Сообщений перенесено: ${stats.messagesMigrated}`);
    } else {
      console.log(`  ℹ Файл диалогов ${config.storeFile} не найден, пропускаем.`);
    }

    console.log('\n====================================================');
    console.log('🎉 Миграция успешно завершена!');
    console.log(`Пользователи: перенесено ${stats.usersMigrated}, пропущено ${stats.usersSkipped}`);
    console.log(`Подписки: перенесено ${stats.subscriptionsMigrated}`);
    console.log(`Диалоги: перенесено ${stats.conversationsMigrated}`);
    console.log(`Сообщения: перенесено ${stats.messagesMigrated}`);
    console.log('====================================================\n');
  } catch (error) {
    console.error('❌ Критическая ошибка при миграции данных:', error);
    process.exitCode = 1;
  } finally {
    try {
      await queryClient.end();
    } catch {
      // ignore
    }
  }
}

migrateData();
