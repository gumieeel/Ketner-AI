import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { config } from '../config.js';
import { conversationStore, userStore, subscriptionStore, feedbackStore } from '../store/index.js';
import type { Conversation, Message, Subscription } from '../types.js';
import type { StoredUser } from '../store/user-store.js';
import type { FeedbackRecord } from '../store/feedback-store.js';
import { createPostgresProjectDriver, ensureCodeSchema } from '../code/postgres-driver.js';
import { ensureImagesSchema } from '../images/image-store.js';
import { attachImageDriver } from '../images/runtime.js';
import { attachProjectDriver } from '../code/runtime.js';

export function hasPostgresConfig(): boolean {
  const url = (config.databaseUrl || process.env.DATABASE_URL || '').trim();
  return Boolean(
    url &&
      !url.includes('postgres:postgres@localhost') &&
      !url.includes('user:password@localhost') &&
      (url.startsWith('postgres://') || url.startsWith('postgresql://')),
  );
}

let activeSqlClient: postgres.Sql | null = null;

export function getDatabaseSqlClient(): postgres.Sql | null {
  if (activeSqlClient) {
    return activeSqlClient;
  }
  if (!hasPostgresConfig()) {
    return null;
  }
  const connectionString = (config.databaseUrl || process.env.DATABASE_URL || '').trim();
  activeSqlClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return activeSqlClient;
}

export async function ensureDatabaseSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "user" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "email" text UNIQUE NOT NULL,
      "emailVerified" boolean NOT NULL DEFAULT false,
      "image" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "plan" text DEFAULT 'free'
    );

    CREATE TABLE IF NOT EXISTS "session" (
      "id" text PRIMARY KEY NOT NULL,
      "expiresAt" timestamp NOT NULL,
      "token" text UNIQUE NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "ipAddress" text,
      "userAgent" text,
      "userId" text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "account" (
      "id" text PRIMARY KEY NOT NULL,
      "accountId" text NOT NULL,
      "providerId" text NOT NULL,
      "userId" text NOT NULL,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamp,
      "refreshTokenExpiresAt" timestamp,
      "scope" text,
      "password" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      "id" text PRIMARY KEY NOT NULL,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expiresAt" timestamp NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "ketner_users" (
      "id" text PRIMARY KEY NOT NULL,
      "better_auth_id" text UNIQUE,
      "email" text UNIQUE NOT NULL,
      "name" text NOT NULL,
      "plan" text DEFAULT 'free' NOT NULL,
      "password_hash" text,
      "salt" text,
      "is_vip" boolean DEFAULT false,
      "is_admin" boolean DEFAULT false,
      "telegram_chat_id" text,
      "telegram_username" text,
      "tokens_used_this_month" integer DEFAULT 0,
      "total_tokens_used" integer DEFAULT 0,
      "total_cost_usd" numeric(10, 2) DEFAULT '0',
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "conversations" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "title" text,
      "selected_model" text DEFAULT 'claude-3-5-sonnet-20241022',
      "system_prompt" text,
      "context_summary" text,
      "archived" boolean DEFAULT false,
      "metadata" jsonb,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "messages" (
      "id" text PRIMARY KEY NOT NULL,
      "conversation_id" text NOT NULL,
      "role" text NOT NULL,
      "content" text NOT NULL,
      "model" text,
      "status" text DEFAULT 'complete',
      "finish_reason" text,
      "can_continue" boolean DEFAULT false,
      "feedback" text,
      "tokens_used" integer DEFAULT 0,
      "tokens_input" integer DEFAULT 0,
      "tokens_output" integer DEFAULT 0,
      "cost_usd" numeric(10, 6) DEFAULT '0',
      "parent_message_id" text,
      "is_edited" boolean DEFAULT false,
      "edited_at" timestamp,
      "metadata" jsonb,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "subscriptions" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text UNIQUE NOT NULL,
      "plan" text NOT NULL,
      "status" text DEFAULT 'active' NOT NULL,
      "stripe_customer_id" text,
      "stripe_subscription_id" text,
      "stripe_product_id" text,
      "stripe_price_id" text,
      "current_period_start" timestamp,
      "current_period_end" timestamp,
      "renews_at" timestamp,
      "canceled_at" timestamp,
      "cancel_at_period_end" boolean DEFAULT false,
      "metadata" jsonb,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "feedbacks" (
      "id" text PRIMARY KEY NOT NULL,
      "message_id" text UNIQUE NOT NULL,
      "conversation_id" text NOT NULL,
      "user_id" text,
      "rating" text NOT NULL,
      "model" text,
      "engine" text,
      "prompt_complexity" text,
      "reason" text,
      "comment" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "usage_metrics" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "conversation_id" text,
      "model" text NOT NULL,
      "tokens_input" integer NOT NULL,
      "tokens_output" integer NOT NULL,
      "cost_usd" numeric(10, 6) NOT NULL,
      "timestamp" timestamp DEFAULT now() NOT NULL
    );

    -- Миграции добавления недостающих колонок для обратной совместимости
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "password_hash" text;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "salt" text;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "is_vip" boolean DEFAULT false;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "telegram_username" text;
    ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "context_summary" text;
    ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'complete';
    ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "finish_reason" text;
    ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "can_continue" boolean DEFAULT false;
    ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "feedback" text;
    ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renews_at" timestamp;
  `);
}

/**
 * Сидирование БД. Администратор больше не создаётся с паролем из репозитория:
 * его заводит userStore.ensureSeedAdmin() из SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Публичный демо-аккаунт добавляется только когда он разрешён (вне production или ENABLE_DEMO_ACCOUNT=true).
 */
async function seedDefaultUsers(sql: postgres.Sql): Promise<void> {
  if (!config.enableDemoAccount) {
    return;
  }

  await sql`
    INSERT INTO "ketner_users" (
      "id", "email", "name", "plan", "password_hash", "salt", "is_vip", "is_admin", "created_at", "updated_at"
    ) VALUES (
      'demo-user',
      'demo@ketner.ai',
      'Ketner Demo',
      'free',
      '4578b665fa9cf4514ba4523c91a03ef9cb0fe216893e36eb104f21cf4f0ff019',
      '00000000000000000000000000000000',
      false,
      false,
      NOW(),
      NOW()
    ) ON CONFLICT ("email") DO NOTHING
  `;
}

async function loadAndSyncUsers(sql: postgres.Sql): Promise<void> {
  const rows = await sql<
    {
      id: string;
      email: string;
      name: string;
      plan: string;
      password_hash: string | null;
      salt: string | null;
      is_vip: boolean | null;
      is_admin: boolean | null;
      telegram_chat_id: string | null;
      telegram_username: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, email, name, plan, password_hash, salt, is_vip, is_admin, telegram_chat_id, telegram_username, created_at
    FROM "ketner_users"
  `;

  const dbUsers: StoredUser[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    plan: r.plan as StoredUser['plan'],
    salt: r.salt || '00000000000000000000000000000000',
    passwordHash: r.password_hash || '',
    isVip: Boolean(r.is_vip),
    isAdmin: Boolean(r.is_admin),
    telegramChatId: r.telegram_chat_id || undefined,
    telegramUsername: r.telegram_username || undefined,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));

  // Если локально были зарегистрированы пользователи, которых ещё нет в БД, переносим их в БД
  const localUsers = userStore.getAllStoredUsers?.() || [];
  const dbEmailSet = new Set(dbUsers.map((u) => u.email.toLowerCase()));

  for (const localUser of localUsers) {
    if (!dbEmailSet.has(localUser.email.toLowerCase())) {
      try {
        await sql`
          INSERT INTO "ketner_users" (
            "id", "email", "name", "plan", "password_hash", "salt", "is_vip", "is_admin", "telegram_chat_id", "telegram_username", "created_at", "updated_at"
          ) VALUES (
            ${localUser.id},
            ${localUser.email},
            ${localUser.name},
            ${localUser.plan},
            ${localUser.passwordHash},
            ${localUser.salt},
            ${Boolean(localUser.isVip)},
            ${Boolean(localUser.isAdmin)},
            ${localUser.telegramChatId ? String(localUser.telegramChatId) : null},
            ${localUser.telegramUsername || null},
            ${new Date(localUser.createdAt)},
            NOW()
          ) ON CONFLICT ("email") DO NOTHING
        `;
        dbUsers.push(localUser);
        dbEmailSet.add(localUser.email.toLowerCase());
      } catch (err) {
        console.error(`[db] Ошибка импорта локального пользователя ${localUser.email}:`, err);
      }
    }
  }

  userStore.loadExternalUsers?.(dbUsers);
  console.log(`[db] Пользователи синхронизированы: ${dbUsers.length} аккаунтов загружено в память`);
}

async function loadAndSyncConversations(sql: postgres.Sql): Promise<void> {
  const convRows = await sql<
    {
      id: string;
      user_id: string;
      title: string | null;
      context_summary: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    SELECT id, user_id, title, context_summary, created_at, updated_at
    FROM "conversations"
  `;

  const msgRows = await sql<
    {
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      model: string | null;
      status: string | null;
      finish_reason: string | null;
      can_continue: boolean | null;
      feedback: string | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }[]
  >`
    SELECT id, conversation_id, role, content, model, status, finish_reason, can_continue, feedback, metadata, created_at
    FROM "messages"
    ORDER BY created_at ASC
  `;

  const dbConversations: Conversation[] = convRows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title || 'Новый диалог',
    contextSummary: r.context_summary || undefined,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  }));

  const dbMessages: Message[] = msgRows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: (r.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
    content: r.content,
    modelId: r.model || undefined,
    status: (r.status as Message['status']) || 'complete',
    finishReason: (r.finish_reason as Message['finishReason']) || undefined,
    canContinue: Boolean(r.can_continue),
    feedback: (r.feedback as Message['feedback']) || undefined,
    attachments: (r.metadata?.attachments as Message['attachments']) || undefined,
    workspaceContext: (r.metadata?.workspaceContext as Message['workspaceContext']) || undefined,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));

  // Если локально были диалоги, которых нет в БД, переносим их в БД
  const localSnapshot = conversationStore.getAllSnapshot?.() || { conversations: [], messages: [] };
  const dbConvIds = new Set(dbConversations.map((c) => c.id));

  for (const localConv of localSnapshot.conversations) {
    if (!dbConvIds.has(localConv.id)) {
      try {
        await sql`
          INSERT INTO "conversations" (
            "id", "user_id", "title", "context_summary", "created_at", "updated_at"
          ) VALUES (
            ${localConv.id},
            ${localConv.userId},
            ${localConv.title},
            ${localConv.contextSummary || null},
            ${new Date(localConv.createdAt)},
            ${new Date(localConv.updatedAt)}
          ) ON CONFLICT ("id") DO NOTHING
        `;
        dbConversations.push(localConv);
        dbConvIds.add(localConv.id);

        const convMsgs = localSnapshot.messages.filter((m) => m.conversationId === localConv.id);
        for (const msg of convMsgs) {
          await sql`
            INSERT INTO "messages" (
              "id", "conversation_id", "role", "content", "model", "status", "finish_reason", "can_continue", "feedback", "metadata", "created_at", "updated_at"
            ) VALUES (
              ${msg.id},
              ${msg.conversationId},
              ${msg.role},
              ${msg.content},
              ${msg.modelId || null},
              ${msg.status || 'complete'},
              ${msg.finishReason || null},
              ${Boolean(msg.canContinue)},
              ${msg.feedback || null},
              ${JSON.stringify({ attachments: msg.attachments || null, workspaceContext: msg.workspaceContext || null })}::jsonb,
              ${new Date(msg.createdAt)},
              NOW()
            ) ON CONFLICT ("id") DO NOTHING
          `;
          dbMessages.push(msg);
        }
      } catch (err) {
        console.error(`[db] Ошибка импорта диалога ${localConv.id}:`, err);
      }
    }
  }

  conversationStore.loadExternalSnapshot?.(dbConversations, dbMessages);
  console.log(
    `[db] Диалоги синхронизированы: ${dbConversations.length} диалогов, ${dbMessages.length} сообщений`,
  );
}

async function loadAndSyncSubscriptions(sql: postgres.Sql): Promise<void> {
  const rows = await sql<
    {
      id: string;
      user_id: string;
      plan: string;
      status: string;
      renews_at: Date | null;
    }[]
  >`
    SELECT id, user_id, plan, status, renews_at
    FROM "subscriptions"
  `;

  const dbSubs: Subscription[] = rows.map((r) => ({
    userId: r.user_id,
    plan: r.plan as Subscription['plan'],
    status: (r.status as Subscription['status']) || 'active',
    renewsAt: r.renews_at ? new Date(r.renews_at).toISOString() : null,
  }));

  subscriptionStore.loadExternalSubscriptions?.(dbSubs);
}

async function loadAndSyncFeedbacks(sql: postgres.Sql): Promise<void> {
  const rows = await sql<
    {
      id: string;
      message_id: string;
      conversation_id: string;
      user_id: string | null;
      rating: string;
      model: string | null;
      engine: string | null;
      prompt_complexity: string | null;
      reason: string | null;
      comment: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, message_id, conversation_id, user_id, rating, model, engine, prompt_complexity, reason, comment, created_at
    FROM "feedbacks"
  `;

  const dbFeedbacks: FeedbackRecord[] = rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    conversationId: r.conversation_id,
    userId: r.user_id || undefined,
    rating: (r.rating as FeedbackRecord['rating']) || 'like',
    modelId: r.model || 'auto',
    engineModelId: r.engine || undefined,
    complexityLevel: (r.prompt_complexity as FeedbackRecord['complexityLevel']) || undefined,
    reason: r.reason || undefined,
    comment: r.comment || undefined,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));

  feedbackStore.loadExternalFeedbacks(dbFeedbacks);
}

function attachDatabaseDrivers(sql: postgres.Sql): void {
  // 1. Conversation driver
  conversationStore.setDbDriver?.({
    async onConversationCreated(conv) {
      await sql`
        INSERT INTO "conversations" (
          "id", "user_id", "title", "context_summary", "created_at", "updated_at"
        ) VALUES (
          ${conv.id},
          ${conv.userId},
          ${conv.title},
          ${conv.contextSummary || null},
          ${new Date(conv.createdAt)},
          ${new Date(conv.updatedAt)}
        ) ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "context_summary" = EXCLUDED."context_summary",
          "updated_at" = EXCLUDED."updated_at"
      `;
    },

    async onConversationRenamed(conv) {
      await sql`
        UPDATE "conversations"
        SET "title" = ${conv.title}, "updated_at" = NOW()
        WHERE "id" = ${conv.id}
      `;
    },

    async onConversationRemoved(_userId, conversationId) {
      await sql`
        DELETE FROM "messages" WHERE "conversation_id" = ${conversationId}
      `;
      await sql`
        DELETE FROM "conversations" WHERE "id" = ${conversationId}
      `;
    },

    async onTurnSaved(conv, history, assistant) {
      // Upsert conversation
      await sql`
        INSERT INTO "conversations" (
          "id", "user_id", "title", "context_summary", "created_at", "updated_at"
        ) VALUES (
          ${conv.id},
          ${conv.userId},
          ${conv.title},
          ${conv.contextSummary || null},
          ${new Date(conv.createdAt)},
          NOW()
        ) ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "context_summary" = EXCLUDED."context_summary",
          "updated_at" = NOW()
      `;

      // Insert all messages in the turn
      const allMessages = [...history, assistant];
      for (const msg of allMessages) {
        await sql`
          INSERT INTO "messages" (
            "id", "conversation_id", "role", "content", "model", "status", "finish_reason", "can_continue", "feedback", "metadata", "created_at", "updated_at"
          ) VALUES (
            ${msg.id},
            ${msg.conversationId},
            ${msg.role},
            ${msg.content},
            ${msg.modelId || null},
            ${msg.status || 'complete'},
            ${msg.finishReason || null},
            ${Boolean(msg.canContinue)},
            ${msg.feedback || null},
            ${JSON.stringify({ attachments: msg.attachments || null, workspaceContext: msg.workspaceContext || null })}::jsonb,
            ${new Date(msg.createdAt)},
            NOW()
          ) ON CONFLICT ("id") DO UPDATE SET
            "content" = EXCLUDED."content",
            "model" = EXCLUDED."model",
            "status" = EXCLUDED."status",
            "finish_reason" = EXCLUDED."finish_reason",
            "can_continue" = EXCLUDED."can_continue",
            "feedback" = EXCLUDED."feedback",
            "metadata" = EXCLUDED."metadata",
            "updated_at" = NOW()
        `;
      }
    },

    async onContextSummaryUpdated(_userId, conversationId, summary) {
      await sql`
        UPDATE "conversations"
        SET "context_summary" = ${summary}, "updated_at" = NOW()
        WHERE "id" = ${conversationId}
      `;
    },

    async onMessageFeedbackUpdated(_userId, _conversationId, messageId, feedback) {
      await sql`
        UPDATE "messages"
        SET "feedback" = ${feedback || null}, "updated_at" = NOW()
        WHERE "id" = ${messageId}
      `;
    },
  });

  // 2. User driver
  userStore.setDbDriver?.({
    async onUserCreated(user) {
      await sql`
        INSERT INTO "ketner_users" (
          "id", "email", "name", "plan", "password_hash", "salt", "is_vip", "is_admin", "telegram_chat_id", "telegram_username", "created_at", "updated_at"
        ) VALUES (
          ${user.id},
          ${user.email},
          ${user.name},
          ${user.plan},
          ${user.passwordHash},
          ${user.salt},
          ${Boolean(user.isVip)},
          ${Boolean(user.isAdmin)},
          ${user.telegramChatId ? String(user.telegramChatId) : null},
          ${user.telegramUsername || null},
          ${new Date(user.createdAt)},
          NOW()
        ) ON CONFLICT ("email") DO UPDATE SET
          "name" = EXCLUDED."name",
          "plan" = EXCLUDED."plan",
          "password_hash" = EXCLUDED."password_hash",
          "salt" = EXCLUDED."salt",
          "is_vip" = EXCLUDED."is_vip",
          "is_admin" = EXCLUDED."is_admin",
          "updated_at" = NOW()
      `;
    },

    async onPlanUpdated(userId, plan) {
      await sql`
        UPDATE "ketner_users"
        SET "plan" = ${plan}, "updated_at" = NOW()
        WHERE "id" = ${userId} OR lower("email") = lower(${userId})
      `;
    },

    async onVipUpdated(userId, isVip) {
      await sql`
        UPDATE "ketner_users"
        SET "is_vip" = ${isVip}, "updated_at" = NOW()
        WHERE "id" = ${userId} OR lower("email") = lower(${userId})
      `;
    },

    async onAdminUpdated(userId, isAdmin) {
      await sql`
        UPDATE "ketner_users"
        SET "is_admin" = ${isAdmin}, "updated_at" = NOW()
        WHERE "id" = ${userId} OR lower("email") = lower(${userId})
      `;
    },

    async onTelegramUpdated(userId, chatId, username) {
      await sql`
        UPDATE "ketner_users"
        SET "telegram_chat_id" = ${chatId ? String(chatId) : null},
            "telegram_username" = ${username || null},
            "updated_at" = NOW()
        WHERE "id" = ${userId} OR lower("email") = lower(${userId})
      `;
    },

    async onPasswordUpdated(userId, salt, passwordHash) {
      await sql`
        UPDATE "ketner_users"
        SET "salt" = ${salt}, "password_hash" = ${passwordHash}, "updated_at" = NOW()
        WHERE "id" = ${userId} OR lower("email") = lower(${userId})
      `;
    },
  });

  // 3. Subscription driver
  subscriptionStore.setDbDriver?.({
    async onSubscriptionUpdated(sub) {
      const renewsAt = sub.renewsAt ? new Date(sub.renewsAt) : null;
      await sql`
        INSERT INTO "subscriptions" (
          "id", "user_id", "plan", "status", "renews_at", "created_at", "updated_at"
        ) VALUES (
          ${randomUUID()},
          ${sub.userId},
          ${sub.plan},
          ${sub.status},
          ${renewsAt},
          NOW(),
          NOW()
        ) ON CONFLICT ("user_id") DO UPDATE SET
          "plan" = EXCLUDED."plan",
          "status" = EXCLUDED."status",
          "renews_at" = EXCLUDED."renews_at",
          "updated_at" = NOW()
      `;
    },
  });

  // 4. Feedback driver
  feedbackStore.setDbDriver({
    async onFeedbackRecorded(record) {
      await sql`
        INSERT INTO "feedbacks" (
          "id", "message_id", "conversation_id", "user_id", "rating", "model", "engine", "prompt_complexity", "reason", "comment", "created_at"
        ) VALUES (
          ${record.id},
          ${record.messageId},
          ${record.conversationId},
          ${record.userId || null},
          ${record.rating},
          ${record.modelId},
          ${record.engineModelId || null},
          ${record.complexityLevel || null},
          ${record.reason || null},
          ${record.comment || null},
          ${new Date(record.createdAt)}
        ) ON CONFLICT ("message_id") DO UPDATE SET
          "rating" = EXCLUDED."rating",
          "reason" = EXCLUDED."reason",
          "comment" = EXCLUDED."comment",
          "model" = EXCLUDED."model",
          "engine" = EXCLUDED."engine",
          "prompt_complexity" = EXCLUDED."prompt_complexity"
      `;
    },
  });
}

export async function initDatabaseSync(): Promise<boolean> {
  if (!hasPostgresConfig()) {
    console.log(
      'ℹ [db] DATABASE_URL не задан или локальный — работаем в режиме совместимости (Local File / In-Memory)',
    );
    return false;
  }

  try {
    const sql = getDatabaseSqlClient();
    if (!sql) {
      return false;
    }

    console.log('🔄 [db] Подключение к PostgreSQL (Supabase)...');
    await ensureDatabaseSchema(sql);
    console.log('✅ [db] Схема базы данных проверена (таблицы готовы)');

    await seedDefaultUsers(sql);
    await loadAndSyncUsers(sql);
    await loadAndSyncConversations(sql);
    await loadAndSyncSubscriptions(sql);
    await loadAndSyncFeedbacks(sql);

    attachDatabaseDrivers(sql);

    // Ketner Code: проекты переживают перезапуск сервера (поднимаются из БД при первом обращении)
    const codeRunner = { query: (text: string, params?: unknown[]) => sql.unsafe(text, params as never[]) as unknown as Promise<never[]> };
    await ensureCodeSchema(codeRunner);
    attachProjectDriver(createPostgresProjectDriver(codeRunner));
    // Картинки: диск Render временный, поэтому храним их в Postgres.
    await ensureImagesSchema(codeRunner);
    attachImageDriver(codeRunner);
    console.log('🎉 [db] Все данные успешно синхронизированы с PostgreSQL / Supabase!');
    return true;
  } catch (error) {
    console.error('❌ [db] Ошибка синхронизации с PostgreSQL:', error);
    return false;
  }
}
