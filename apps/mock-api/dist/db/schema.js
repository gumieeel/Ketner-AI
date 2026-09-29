import { pgTable, text, timestamp, integer, uuid, boolean, json, numeric, index, } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
// ==================== BetterAuth Tables ====================
// Автоматически создаются BetterAuth, но дублируем для типизации
export const betterAuthUser = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').unique().notNull(),
    emailVerified: boolean('emailVerified').notNull(),
    image: text('image'),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
    // Кастомное поле BetterAuth
    plan: text('plan').default('free'),
}, (table) => ({
    emailIdx: index('idx_user_email').on(table.email),
}));
export const betterAuthSession = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt').notNull(),
    token: text('token').unique().notNull(),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
        .notNull()
        .references(() => betterAuthUser.id, { onDelete: 'cascade' }),
}, (table) => ({
    userIdIdx: index('idx_session_user_id').on(table.userId),
}));
export const betterAuthAccount = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
        .notNull()
        .references(() => betterAuthUser.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
}, (table) => ({
    userIdIdx: index('idx_account_user_id').on(table.userId),
}));
export const betterAuthVerification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt').notNull(),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
}, (table) => ({
    identifierIdx: index('idx_verification_identifier').on(table.identifier),
}));
// ==================== Ketner AI Tables ====================
export const users = pgTable('ketner_users', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Связь с BetterAuth user по email
    betterAuthId: text('better_auth_id').unique().references(() => betterAuthUser.id),
    email: text('email').unique().notNull(),
    name: text('name').notNull(),
    plan: text('plan').default('free').notNull(), // free, pro, ultra
    tokensUsedThisMonth: integer('tokens_used_this_month').default(0),
    totalTokensUsed: integer('total_tokens_used').default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 2 }).default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    emailIdx: index('idx_ketner_users_email').on(table.email),
    planIdx: index('idx_ketner_users_plan').on(table.plan),
}));
export const conversations = pgTable('conversations', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    selectedModel: text('selected_model').default('claude-3-5-sonnet-20241022'),
    systemPrompt: text('system_prompt'),
    archived: boolean('archived').default(false),
    metadata: json('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_conversations_user_id').on(table.userId),
    createdAtIdx: index('idx_conversations_created_at').on(table.createdAt),
}));
export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
        .notNull()
        .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    model: text('model'), // какая модель обработала сообщение
    tokensUsed: integer('tokens_used').default(0),
    tokensInput: integer('tokens_input').default(0),
    tokensOutput: integer('tokens_output').default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
    // Для edit/regenerate функционала
    parentMessageId: uuid('parent_message_id'),
    isEdited: boolean('is_edited').default(false),
    editedAt: timestamp('edited_at'),
    metadata: json('metadata'), // для доп. info (стриминг статус и т.д.)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    conversationIdIdx: index('idx_messages_conversation_id').on(table.conversationId),
    createdAtIdx: index('idx_messages_created_at').on(table.createdAt),
}));
export const subscriptions = pgTable('subscriptions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(), // 'free', 'pro', 'ultra'
    status: text('status').default('active').notNull(), // active, canceled, past_due, incomplete
    stripeCustomerId: text('stripe_customer_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    stripeProductId: text('stripe_product_id'),
    stripePriceId: text('stripe_price_id'),
    currentPeriodStart: timestamp('current_period_start'),
    currentPeriodEnd: timestamp('current_period_end'),
    canceledAt: timestamp('canceled_at'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    metadata: json('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_subscriptions_user_id').on(table.userId),
    statusIdx: index('idx_subscriptions_status').on(table.status),
}));
export const billingEvents = pgTable('billing_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'payment', 'refund', 'upgrade', 'downgrade', 'usage_overage'
    amountUsd: numeric('amount_usd', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').default('usd'),
    description: text('description'),
    stripeEventId: text('stripe_event_id').unique(),
    stripeInvoiceId: text('stripe_invoice_id'),
    metadata: json('metadata'), // {conversationId, model, tokensUsed, etc}
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_billing_events_user_id').on(table.userId),
    createdAtIdx: index('idx_billing_events_created_at').on(table.createdAt),
}));
export const usageMetrics = pgTable('usage_metrics', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
        onDelete: 'set null',
    }),
    model: text('model').notNull(),
    tokensInput: integer('tokens_input').notNull(),
    tokensOutput: integer('tokens_output').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_usage_metrics_user_id').on(table.userId),
    timestampIdx: index('idx_usage_metrics_timestamp').on(table.timestamp),
}));
// ==================== Relations (для удобства в коде) ====================
export const usersRelations = relations(users, ({ many }) => ({
    conversations: many(conversations),
    subscriptions: many(subscriptions),
    billingEvents: many(billingEvents),
    usageMetrics: many(usageMetrics),
}));
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
    user: one(users, {
        fields: [conversations.userId],
        references: [users.id],
    }),
    messages: many(messages),
}));
export const messagesRelations = relations(messages, ({ one }) => ({
    conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id],
    }),
}));
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
    user: one(users, {
        fields: [subscriptions.userId],
        references: [users.id],
    }),
}));
export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
    user: one(users, {
        fields: [billingEvents.userId],
        references: [users.id],
    }),
}));
export const usageMetricsRelations = relations(usageMetrics, ({ one }) => ({
    user: one(users, {
        fields: [usageMetrics.userId],
        references: [users.id],
    }),
    conversation: one(conversations, {
        fields: [usageMetrics.conversationId],
        references: [conversations.id],
    }),
}));
