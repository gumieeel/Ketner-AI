import type { Language } from '@/features/preferences/preferences-store';

/**
 * Примеры запросов для пустого состояния.
 *
 * На этапе 2 они подставляются в поле ввода, а не отправляются сразу —
 * так пользователь может поправить формулировку перед отправкой.
 */
export const EXAMPLE_PROMPTS: Record<Language, readonly string[]> = {
  ru: [
    'Объясни разницу между SQL и NoSQL простыми словами',
    'Составь план запуска продукта на 4 недели',
    'Отрефактори этот код и объясни, что изменилось',
  ],
  en: [
    'Explain the difference between SQL and NoSQL in simple terms',
    'Draft a 4-week product launch plan',
    'Refactor this code and explain what changed',
  ],
};
