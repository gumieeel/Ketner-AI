/**
 * Лимиты платформы решений (анализ задач, планы, помощники Builder) — в одном месте.
 *
 * Отсюда их берут сервер (discovery/limits.ts, discovery/schemas.ts, discovery/prompts.ts,
 * builder/schemas.ts, builder/service.ts) и сайт: страница «Кредиты» показывает те же числа из
 * plan-facts.json, а тест services/plan-facts.test.ts сверяет его с этим файлом и с ценами
 * моделей. Меняете лимит здесь — поправьте plan-facts.json.
 *
 * Деньги лимиты не заменяют: всё, что за кредиты, списывается по реальной цене через AI Gateway,
 * а бесплатные анализы ограничены ещё и суточным бюджетом сервиса (DISCOVERY_FREE_DAILY_USD).
 */
export const PLATFORM_LIMITS = {
  analyses: {
    /** Бесплатных анализов в сутки на аккаунт или гостевой id. */
    freePerDay: 1,
    /** Бесплатных анализов в сутки с одного адреса — для гостей и новых аккаунтов. */
    freePerIpPerDay: 5,
    /** До какого возраста аккаунт считается новым, дней. */
    youngAccountDays: 7,
    /** Любых анализов в сутки на владельца. */
    perDay: 20,
    /** Запусков анализа в минуту. */
    startsPerMinute: 3,
    /** Уточняющих вопросов за раз. */
    maxQuestions: 3,
    /** Длина описания задачи, символов. */
    textChars: 8000,
  },
  plans: {
    /** Бесплатных кратких планов на бесплатный анализ. */
    freeBriefPerAnalysis: 1,
    briefSteps: 5,
    fullSteps: 10,
  },
  assistants: {
    /** Помощников на пользователя. */
    perUser: 20,
    testCases: 10,
    criteriaPerCase: 5,
    instructionsChars: 3000,
    knowledgeChars: 8000,
    examples: 6,
    restrictions: 8,
    messageChars: 4000,
  },
} as const;
