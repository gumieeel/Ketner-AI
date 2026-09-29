import Stripe from 'stripe';
import { config } from '../config.js';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { subscriptionStore, userStore } from '../store/index.js';
export class StripeService {
    stripe = null;
    constructor() {
        if (config.stripeSecretKey && config.stripeSecretKey.trim() !== '') {
            this.stripe = new Stripe(config.stripeSecretKey, {
                typescript: true,
            });
        }
    }
    isAvailable() {
        return this.stripe !== null;
    }
    /**
     * Получить Stripe Price ID по названию тарифа.
     */
    getPriceIdForPlan(planId) {
        switch (planId) {
            case 'plus':
                return config.stripePricePlus || null;
            case 'pro':
            case 'gpt-pro':
            case 'claude-pro':
            case 'gemini-pro':
                return config.stripePricePro || null;
            case 'ultra':
                return config.stripePriceUltra || null;
            default:
                return null;
        }
    }
    /**
     * Создать Checkout сессию для оформления подписки.
     */
    async createCheckoutSession(options) {
        if (!this.stripe) {
            throw new Error('Stripe API не настроен: STRIPE_SECRET_KEY не задан.');
        }
        const priceId = this.getPriceIdForPlan(options.planId);
        const lineItems = priceId
            ? [{ price: priceId, quantity: 1 }]
            : [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Ketner AI: Подписка ${options.planId.toUpperCase()}`,
                            description: 'Ежемесячный доступ ко всем возможностям тарифа',
                        },
                        unit_amount: options.planId === 'ultra' ? 2499 : options.planId === 'pro' ? 1990 : 990,
                        recurring: { interval: 'month' },
                    },
                    quantity: 1,
                },
            ];
        const session = await this.stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: lineItems,
            customer_email: options.userEmail,
            client_reference_id: options.userId,
            metadata: {
                userId: options.userId,
                planId: options.planId,
            },
            subscription_data: {
                metadata: {
                    userId: options.userId,
                    planId: options.planId,
                },
            },
            success_url: options.successUrl,
            cancel_url: options.cancelUrl,
        });
        return {
            sessionId: session.id,
            url: session.url,
        };
    }
    /**
     * Создать ссылку на Customer Portal для управления подпиской клиентом.
     */
    async createPortalSession(customerId, returnUrl) {
        if (!this.stripe) {
            throw new Error('Stripe API не настроен.');
        }
        const session = await this.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
        return { url: session.url };
    }
    /**
     * Валидация подписи входящего вебхука Stripe.
     */
    constructEvent(payload, signature) {
        if (!this.stripe) {
            throw new Error('Stripe API не инициализирован');
        }
        return this.stripe.webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
    }
    /**
     * Обработка событий Stripe Webhook.
     */
    async handleWebhookEvent(event) {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.client_reference_id || session.metadata?.userId;
                const planId = session.metadata?.planId || 'pro';
                const customerId = session.customer;
                const subscriptionId = session.subscription;
                if (userId) {
                    console.log(`[Stripe] Оплата успешна! Пользователь: ${userId}, Тариф: ${planId}`);
                    // Обновляем локальное хранилище
                    subscriptionStore.checkout(userId, planId);
                    userStore.updatePlan(userId, planId);
                    // Обновляем PostgreSQL / Supabase если подключено
                    if (config.databaseUrl) {
                        try {
                            // Ищем пользователя в ketner_users
                            const ketnerUsers = await db
                                .select()
                                .from(schema.users)
                                .where(eq(schema.users.email, session.customer_email || ''))
                                .limit(1);
                            const dbUserId = ketnerUsers[0]?.id;
                            if (dbUserId) {
                                await db
                                    .insert(schema.subscriptions)
                                    .values({
                                    userId: dbUserId,
                                    plan: planId,
                                    status: 'active',
                                    stripeCustomerId: customerId,
                                    stripeSubscriptionId: subscriptionId,
                                    updatedAt: new Date(),
                                })
                                    .onConflictDoUpdate({
                                    target: schema.subscriptions.stripeSubscriptionId,
                                    set: {
                                        plan: planId,
                                        status: 'active',
                                        updatedAt: new Date(),
                                    },
                                });
                                await db
                                    .update(schema.users)
                                    .set({ plan: planId, updatedAt: new Date() })
                                    .where(eq(schema.users.id, dbUserId));
                            }
                        }
                        catch (err) {
                            console.error('[Stripe] Ошибка записи в Supabase:', err);
                        }
                    }
                }
                return { handled: true, message: 'Checkout session completed' };
            }
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                const userId = sub.metadata?.userId;
                if (userId) {
                    console.log(`[Stripe] Подписка отменена: ${userId}`);
                    subscriptionStore.cancel(userId);
                    userStore.updatePlan(userId, 'free');
                    if (config.databaseUrl && sub.id) {
                        try {
                            await db
                                .update(schema.subscriptions)
                                .set({ status: 'canceled', updatedAt: new Date() })
                                .where(eq(schema.subscriptions.stripeSubscriptionId, sub.id));
                        }
                        catch (err) {
                            console.error('[Stripe] Ошибка отмены в Supabase:', err);
                        }
                    }
                }
                return { handled: true, message: 'Subscription canceled' };
            }
            default:
                return { handled: true, message: `Ignored event ${event.type}` };
        }
    }
}
export const stripeService = new StripeService();
