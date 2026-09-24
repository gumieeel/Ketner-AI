import { defaultBetterAuth, initAuthDatabase } from './auth/better-auth.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { telegramBotService } from './telegram/bot.js';
await initAuthDatabase(defaultBetterAuth);
const app = createApp({ botService: telegramBotService });
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
});
