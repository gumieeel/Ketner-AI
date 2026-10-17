import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { config } from '../config.js';
import {
  apiKeyStore,
  conversationStore,
  revokedTokenStore,
  githubConnectionStore,
  userStore,
  subscriptionStore,
  feedbackStore,
} from '../store/index.js';
import type { StoredGithubConnection } from '../github/connection-store.js';
import { invoiceStore } from '../store/invoice-store.js';
import { billingLedger } from '../billing/index.js';
import { supportStore, usageStore } from '../store/index.js';
import { contactStore } from '../store/contact-store.js';
import type { DocStore } from '../store/doc-store.js';
import type { CryptoInvoice } from '../types.js';
import type { ApiKeyRecord } from '../store/api-key-store.js';
import type { Conversation, Message, Subscription } from '../types.js';
import type { StoredUser } from '../store/user-store.js';
import {
  sanitizeAttribution,
  SIGNUP_METHODS,
  type SignupMethod,
} from '../services/signup-attribution.js';
import { signupMethodFromProvider } from '../auth/better-auth-sync.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';
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
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "signup_method" text;
    ALTER TABLE "ketner_users" ADD COLUMN IF NOT EXISTS "signup_attribution" jsonb;
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

/**
 * Способ регистрации из БД. У аккаунтов, созданных до учёта, он восстанавливается:
 * служебная почта Telegram — Telegram; есть привязка Google/GitHub в Better Auth — этот провайдер;
 * есть только пароль Better Auth — почта.
 */
export function resolveStoredSignupMethod(
  stored: string | null | undefined,
  email: string,
  firstProvider: string | null | undefined,
): SignupMethod | undefined {
  if (stored && (SIGNUP_METHODS as readonly string[]).includes(stored)) {
    return stored as SignupMethod;
  }
  if (isTelegramAccountEmail(email)) return 'telegram';
  if (firstProvider) {
    const method = signupMethodFromProvider(firstProvider);
    return method === 'unknown' ? undefined : method;
  }
  return undefined;
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
      signup_method: string | null;
      signup_attribution: unknown;
      first_provider: string | null;
    }[]
  >`
    SELECT ku.id, ku.email, ku.name, ku.plan, ku.password_hash, ku.salt, ku.is_vip, ku.is_admin,
      ku.telegram_chat_id, ku.telegram_username, ku.created_at, ku.signup_method, ku.signup_attribution,
      (
        SELECT a."providerId"
        FROM "user" bu
        JOIN "account" a ON a."userId" = bu.id
        WHERE lower(bu.email) = lower(ku.email)
        ORDER BY (a."providerId" = 'credential'), a."createdAt" ASC
        LIMIT 1
      ) AS first_provider
    FROM "ketner_users" ku
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
    signupMethod: resolveStoredSignupMethod(r.signup_method, r.email, r.first_provider),
    signupAttribution: sanitizeAttribution(r.signup_attribution),
  }));

  // Если локально были зарегистрированы пользователи, которых ещё нет в БД, переносим их в БД
  const localUsers = userStore.getAllStoredUsers?.() || [];
  const dbEmailSet = new Set(dbUsers.map((u) => u.email.toLowerCase()));

  for (const localUser of localUsers) {
    if (!dbEmailSet.has(localUser.email.toLowerCase())) {
      try {
        await sql`
          INSERT INTO "ketner_users" (
            "id", "email", "name", "plan", "password_hash", "salt", "is_vip", "is_admin", "telegram_chat_id", "telegram_username", "created_at", "updated_at, "signup_method", "signup_attribution"
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
            NOW(),
            ${localUser.signupMethod ?? null},
            ${localUser.signupAttribution ? sql.json(localUser.signupAttribution as never) : null}
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
        WHERE "conversations"."user_id" = EXCLUDED."user_id"
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
          WHERE "messages"."conversation_id" = EXCLUDED."conversation_id"
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
          "id", "email", "name", "plan", "password_hash", "salt", "is_vip", "is_admin", "telegram_chat_id", "telegram_username", "created_at", "updated_at, "signup_method", "signup_attribution"
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
          NOW(),
          ${user.signupMethod ?? null},
          ${user.signupAttribution ? sql.json(user.signupAttribution as never) : null}
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

/**
 * API-ключи для CLI и IDE: в Postgres лежит только SHA-256 секрета. Без этой таблицы ключи
 * пропадали бы при каждом деплое — диск Render временный.
 */
async function syncApiKeys(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "api_keys" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "name" text NOT NULL,
      "prefix" text NOT NULL,
      "hash" text UNIQUE NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "last_used_at" timestamptz,
      "revoked_at" timestamptz
    );
    CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" ("user_id");
  `);
  const rows = await sql<
    {
      id: string;
      user_id: string;
      name: string;
      prefix: string;
      hash: string;
      created_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }[]
  >`SELECT id, user_id, name, prefix, hash, created_at, last_used_at, revoked_at FROM "api_keys"`;
  apiKeyStore.loadExternal(
    rows.map((r): ApiKeyRecord => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      prefix: r.prefix,
      hash: r.hash,
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    })),
  );
  apiKeyStore.setDbDriver({
    async upsert(record) {
      await sql`
        INSERT INTO "api_keys" ("id", "user_id", "name", "prefix", "hash", "created_at", "last_used_at", "revoked_at")
        VALUES (${record.id}, ${record.userId}, ${record.name}, ${record.prefix}, ${record.hash},
                ${record.createdAt}, ${record.lastUsedAt}, ${record.revokedAt})
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "last_used_at" = EXCLUDED."last_used_at",
          "revoked_at" = EXCLUDED."revoked_at"
      `;
    },
  });
}

/**
 * Токены входа, отозванные при выходе. Истёкшие записи не нужны: удаляются при старте.
 */
async function syncRevokedTokens(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "revoked_tokens" (
      "token_hash" text PRIMARY KEY NOT NULL,
      "expires_at" bigint NOT NULL
    );
  `);
  await sql`DELETE FROM "revoked_tokens" WHERE "expires_at" <= ${Math.floor(Date.now() / 1000)}`;
  const rows = await sql<
    { token_hash: string; expires_at: string | number }[]
  >`SELECT token_hash, expires_at FROM "revoked_tokens"`;
  revokedTokenStore.loadExternal(
    rows.map((r) => ({ hash: r.token_hash, expiresAt: Number(r.expires_at) })),
  );
  revokedTokenStore.setDbDriver({
    async insert(record) {
      await sql`
        INSERT INTO "revoked_tokens" ("token_hash", "expires_at")
        VALUES (${record.hash}, ${record.expiresAt})
        ON CONFLICT ("token_hash") DO NOTHING
      `;
    },
  });
}

/**
 * Привязанные аккаунты GitHub: токен лежит зашифрованным (AES-256-GCM), расшифровать его можно
 * только ключом из BETTER_AUTH_SECRET. Таблица нужна по той же причине: диск Render временный.
 */
async function syncGithubConnections(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "github_connections" (
      "user_id" text PRIMARY KEY NOT NULL,
      "github_id" bigint NOT NULL,
      "login" text NOT NULL,
      "avatar_url" text,
      "scopes" text NOT NULL DEFAULT '',
      "token_enc" text NOT NULL,
      "connected_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  const rows = await sql<
    {
      user_id: string;
      github_id: string | number;
      login: string;
      avatar_url: string | null;
      scopes: string;
      token_enc: string;
      connected_at: Date;
    }[]
  >`SELECT user_id, github_id, login, avatar_url, scopes, token_enc, connected_at FROM "github_connections"`;
  githubConnectionStore.loadExternal(
    rows.map((r): StoredGithubConnection => ({
      userId: r.user_id,
      githubId: Number(r.github_id),
      login: r.login,
      avatarUrl: r.avatar_url,
      scopes: r.scopes.split(',').filter(Boolean),
      tokenEnc: r.token_enc,
      connectedAt: new Date(r.connected_at).toISOString(),
    })),
  );
  githubConnectionStore.setDbDriver({
    async upsert(record) {
      await sql`
        INSERT INTO "github_connections" ("user_id", "github_id", "login", "avatar_url", "scopes", "token_enc", "connected_at")
        VALUES (${record.userId}, ${record.githubId}, ${record.login}, ${record.avatarUrl},
                ${record.scopes.join(',')}, ${record.tokenEnc}, ${record.connectedAt})
        ON CONFLICT ("user_id") DO UPDATE SET
          "github_id" = EXCLUDED."github_id",
          "login" = EXCLUDED."login",
          "avatar_url" = EXCLUDED."avatar_url",
          "scopes" = EXCLUDED."scopes",
          "token_enc" = EXCLUDED."token_enc",
          "connected_at" = EXCLUDED."connected_at"
      `;
    },
    async remove(userId) {
      await sql`DELETE FROM "github_connections" WHERE "user_id" = ${userId}`;
    },
  });
}

/**
 * Крипто-счета (Trybit): postback может прийти после деплоя, а диск Render временный. Без таблицы
 * сервер не нашёл бы счёт и не выдал тариф за уже оплаченный заказ.
 */
async function syncCryptoInvoices(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "crypto_invoices" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "status" text NOT NULL,
      "data" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  const rows = await sql<{ data: CryptoInvoice }[]>`
    SELECT data FROM "crypto_invoices" WHERE created_at > now() - interval '60 days'
  `;
  invoiceStore.loadCryptoExternal?.(rows.map((row) => row.data));
  invoiceStore.setCryptoDbDriver?.({
    async upsert(invoice) {
      await sql`
        INSERT INTO "crypto_invoices" ("id", "user_id", "status", "data", "created_at", "updated_at")
        VALUES (${invoice.id}, ${invoice.userId}, ${invoice.status}, ${sql.json(invoice as never)}, ${invoice.createdAt}, now())
        ON CONFLICT ("id") DO UPDATE SET
          "status" = EXCLUDED."status",
          "data" = EXCLUDED."data",
          "updated_at" = now()
      `;
    },
  });
}

/**
 * Небольшие хранилища документов (журнал платежей, подписки со звёздами, настройки уведомлений,
 * счета в звёздах): одна таблица с пространствами имён, документы — JSON.
 */
async function syncDocStores(
  sql: postgres.Sql,
  stores: Array<DocStore<{ id: string }>>,
): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "ketner_docs" (
      "namespace" text NOT NULL,
      "id" text NOT NULL,
      "data" jsonb NOT NULL,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespace", "id")
    );
  `);
  const driver = {
    async upsert(namespace: string, doc: { id: string }) {
      await sql`
        INSERT INTO "ketner_docs" ("namespace", "id", "data", "updated_at")
        VALUES (${namespace}, ${doc.id}, ${sql.json(doc as never)}, now())
        ON CONFLICT ("namespace", "id") DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()
      `;
    },
    async remove(namespace: string, id: string) {
      await sql`DELETE FROM "ketner_docs" WHERE "namespace" = ${namespace} AND "id" = ${id}`;
    },
  };
  for (const store of stores) {
    const rows = await sql<
      { data: { id: string } }[]
    >`SELECT data FROM "ketner_docs" WHERE "namespace" = ${store.namespace}`;
    store.loadExternal(rows.map((row) => row.data));
    store.setDbDriver(driver);
  }
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
    const codeRunner = {
      query: (text: string, params?: unknown[]) =>
        sql.unsafe(text, params as never[]) as unknown as Promise<never[]>,
    };
    await ensureCodeSchema(codeRunner);
    attachProjectDriver(createPostgresProjectDriver(codeRunner));
    // Картинки: диск Render временный, поэтому храним их в Postgres.
    await ensureImagesSchema(codeRunner);
    attachImageDriver(codeRunner);
    // API-ключи — отдельно: сбой этой таблицы не должен отключать остальные хранилища.
    try {
      await syncApiKeys(sql);
    } catch (error) {
      console.error('❌ [db] API-ключи не синхронизированы с PostgreSQL:', error);
    }
    try {
      await syncDocStores(sql, [
        billingLedger.payments,
        billingLedger.starsSubscriptions,
        billingLedger.prefs,
        billingLedger.credits,
        usageStore,
        contactStore,
      ] as unknown as Array<DocStore<{ id: string }>>);
    } catch (error) {
      console.error('❌ [db] Журнал платежей не синхронизирован с PostgreSQL:', error);
    }
    // Обращения в поддержку: файл на Render стирается при деплое, база — нет.
    try {
      await syncDocStores(sql, [
        supportStore.mirror.tickets,
        supportStore.mirror.meta,
      ] as unknown as Array<DocStore<{ id: string }>>);
      supportStore.hydrateFromMirror();
    } catch (error) {
      console.error('❌ [db] Обращения в поддержку не синхронизированы с PostgreSQL:', error);
    }
    try {
      await syncCryptoInvoices(sql);
    } catch (error) {
      console.error('❌ [db] Крипто-счета не синхронизированы с PostgreSQL:', error);
    }
    try {
      await syncRevokedTokens(sql);
    } catch (error) {
      console.error('❌ [db] Отозванные токены не синхронизированы с PostgreSQL:', error);
    }
    try {
      await syncGithubConnections(sql);
    } catch (error) {
      console.error('❌ [db] Подключения GitHub не синхронизированы с PostgreSQL:', error);
    }
    console.log('🎉 [db] Все данные успешно синхронизированы с PostgreSQL / Supabase!');
    return true;
  } catch (error) {
    console.error('❌ [db] Ошибка синхронизации с PostgreSQL:', error);
    return false;
  }
}
