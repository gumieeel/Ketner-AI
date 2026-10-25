import { defaultBetterAuth, initAuthDatabase } from './auth/better-auth.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { telegramBotService } from './telegram/bot.js';
import { telegramSupportBotService } from './telegram/support-bot.js';
import { initDatabaseSync } from './db/sync.js';
// 1. Синхронизируем базу данных Supabase / PostgreSQL и таблицы
await initDatabaseSync();
// 2. Инициализируем Better Auth
await initAuthDatabase(defaultBetterAuth);
const app = createApp({
    botService: telegramBotService,
    supportBotService: telegramSupportBotService,
});
app.listen(config.port, async () => {
    console.log(`[mock-api] ${config.serviceName} слушает http://127.0.0.1:${config.port}`);
    console.log(`[mock-api] контракт API: http://127.0.0.1:${config.port}/api`);
    if (telegramBotService.isConfigured) {
        try {
            await telegramBotService.initRuntime();
        }
        catch (error) {
            console.error('[mock-api] Ошибка инициализации Telegram бота:', error);
        }
    }
    if (telegramSupportBotService.isConfigured) {
        try {
            await telegramSupportBotService.initRuntime();
        }
        catch (error) {
            console.error('[mock-api] Ошибка инициализации Telegram Support бота:', error);
        }
    }
});
