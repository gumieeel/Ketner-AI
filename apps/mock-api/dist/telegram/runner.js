import { config } from '../config.js';
import { invoiceStore, subscriptionStore, userStore } from '../store/index.js';
import { TelegramBotService } from './bot.js';
async function main() {
    console.log('🤖 Запуск Telegram Bot Ketner AI...');
    const botService = new TelegramBotService({
        subscriptionStore,
        userStore,
        invoiceStore,
        botToken: config.telegramBotToken,
        botUsername: config.telegramBotUsername,
    });
    console.log(`Имя бота: @${botService.botUsername}`);
    if (!botService.isConfigured) {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN не задан! Бот работает в режиме заглушки (mock). Запросы логируются в консоль.');
        console.log('💡 Для реального подключения добавьте TELEGRAM_BOT_TOKEN в apps/mock-api/.env');
        return;
    }
    console.log('✅ Запуск long-polling прослушивания Telegram...');
    let offset = 0;
    while (true) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=${offset}&timeout=25`);
            const data = (await response.json());
            if (data.ok && Array.isArray(data.result)) {
                for (const update of data.result) {
                    offset = update.update_id + 1;
                    await botService.processUpdate(update);
                }
            }
        }
        catch (error) {
            console.error('[TelegramBot Runner] Ошибка long-polling:', error);
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }
}
main().catch((err) => {
    console.error('[TelegramBot Runner] Фатальная ошибка:', err);
    process.exit(1);
});
