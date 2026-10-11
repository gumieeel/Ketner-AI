/**
 * Лимиты Ketner Code по тарифам: проекты, размер файлов, число запусков агента и бюджет запуска.
 *
 * Лимиты агента лежат поверх общих (services/entitlement.ts): запуск агента расходует тот же
 * дневной бюджет себестоимости и месячный costBudget, поэтому здесь ограничивается то, чего общие
 * лимиты не видят: сколько проектов хранить, сколько запусков в сутки и сколько можно потратить
 * на один запуск (один запрос пользователя превращается в десятки обращений к модели).
 */
const MB = 1024 * 1024;
const KB = 1024;
export const CODE_LIMITS = {
    free: {
        maxProjects: 1,
        maxFiles: 200,
        maxProjectBytes: 1 * MB,
        maxFileBytes: 200 * KB,
        runsPerDay: 3,
        maxSteps: 8,
        maxRunCostUsd: 0.02,
        commands: false,
        commandTimeoutSec: 30,
        maxTaskChars: 4_000,
    },
    plus: {
        maxProjects: 5,
        maxFiles: 1_000,
        maxProjectBytes: 10 * MB,
        maxFileBytes: 1 * MB,
        runsPerDay: 15,
        maxSteps: 25,
        maxRunCostUsd: 0.1,
        commands: false,
        commandTimeoutSec: 60,
        maxTaskChars: 8_000,
    },
    pro: {
        maxProjects: 20,
        maxFiles: 3_000,
        maxProjectBytes: 25 * MB,
        maxFileBytes: 2 * MB,
        runsPerDay: 40,
        maxSteps: 50,
        maxRunCostUsd: 0.4,
        commands: true,
        commandTimeoutSec: 120,
        maxTaskChars: 16_000,
    },
    ultra: {
        maxProjects: 100,
        maxFiles: 10_000,
        maxProjectBytes: 100 * MB,
        maxFileBytes: 5 * MB,
        runsPerDay: 120,
        maxSteps: 100,
        maxRunCostUsd: 1.0,
        commands: true,
        commandTimeoutSec: 300,
        maxTaskChars: 32_000,
    },
};
export function getCodeLimits(plan) {
    switch (plan) {
        case 'ultra':
            return CODE_LIMITS.ultra;
        case 'pro':
        case 'gpt-pro':
        case 'claude-pro':
        case 'gemini-pro':
            return CODE_LIMITS.pro;
        case 'plus':
            return CODE_LIMITS.plus;
        default:
            return CODE_LIMITS.free;
    }
}
export function quotaOf(limits) {
    return {
        maxFiles: limits.maxFiles,
        maxFileBytes: limits.maxFileBytes,
        maxProjectBytes: limits.maxProjectBytes,
    };
}
