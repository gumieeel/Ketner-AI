/**
 * Анализ по плану (docs/AUTOMATION_PLAN.md, этап A).
 *
 * Карта анализа — пять областей, которые модель проходит всегда, в одном порядке: так отчёт не
 * зависит от того, о чём модель вспомнила, а человек видит, что проверено и что нашлось. Рецепт —
 * готовая автоматизация Ketner, к которой сводится возможность; кнопка «Приступить к автоматизации»
 * есть только у возможности с доступным рецептом. Доступность рецептов — проверяемый код, как
 * каталог возможностей: модель не может предложить рецепт, которого у Ketner ещё нет.
 */

import type { Language } from '../types.js';
import { rollout } from '../services/rollout.js';
import type { CapabilityId } from './capabilities.js';
import type { FeasibilityStatus } from './feasibility.js';

export const AREA_IDS = ['clients', 'sales', 'content', 'documents', 'routine'] as const;
export type AreaId = (typeof AREA_IDS)[number];

export const AREAS: Readonly<
  Record<AreaId, { label: Record<Language, string>; scope: Record<Language, string> }>
> = {
  clients: {
    label: { ru: 'Клиенты и переписка', en: 'Customers and messages' },
    scope: {
      ru: 'вопросы клиентов, запись, заявки, ответы в мессенджерах и на сайте',
      en: 'customer questions, bookings, requests, replies in messengers and on the website',
    },
  },
  sales: {
    label: { ru: 'Продажи', en: 'Sales' },
    scope: {
      ru: 'коммерческие предложения, напоминания клиентам, обработка заявок, повторные продажи',
      en: 'proposals, follow-ups, handling leads, repeat sales',
    },
  },
  content: {
    label: { ru: 'Контент и реклама', en: 'Content and marketing' },
    scope: {
      ru: 'посты, сторис, описания товаров, ответы на отзывы, картинки',
      en: 'posts, stories, product descriptions, replies to reviews, images',
    },
  },
  documents: {
    label: { ru: 'Документы и отчёты', en: 'Documents and reports' },
    scope: {
      ru: 'договоры, отчёты, таблицы, письма, перевод',
      en: 'contracts, reports, spreadsheets, letters, translation',
    },
  },
  routine: {
    label: { ru: 'Рутина и учёба', en: 'Routine and learning' },
    scope: {
      ru: 'планирование, заметки, поиск информации, обучение, личные задачи',
      en: 'planning, notes, research, learning, personal tasks',
    },
  },
};

export type CoverageStatus = 'found' | 'not_relevant' | 'unclear';

export interface AreaCoverage {
  area: AreaId;
  status: CoverageStatus;
  /** Сколько возможностей отчёта относится к области. */
  opportunities: number;
  note: string;
}

export const RECIPE_IDS = [
  'personal_assistant',
  'customer_bot',
  'study_assistant',
  'weekly_content',
] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export interface Recipe {
  id: RecipeId;
  /** Рецепт уже можно запустить. Пока `false`, модель его не видит, а сервер его снимает. */
  available: boolean;
  label: Record<Language, string>;
  description: Record<Language, string>;
  /**
   * Возможности каталога, без которых рецепт к возможности не подходит: модель могла приписать
   * рецепт, но сервер принимает его, только если возможность действительно их требует.
   */
  needs?: readonly CapabilityId[];
}

export const RECIPES: Readonly<Record<RecipeId, Recipe>> = {
  personal_assistant: {
    id: 'personal_assistant',
    available: true,
    label: { ru: 'Личный помощник', en: 'Personal assistant' },
    description: {
      ru: 'помощник в чате Ketner со знаниями и стилем человека: пишет письма, КП, документы, ответы, посты по запросу',
      en: "an assistant in Ketner chat with the person's knowledge and style: writes letters, proposals, documents, replies, posts on request",
    },
  },
  customer_bot: {
    id: 'customer_bot',
    available: true,
    label: { ru: 'Бот для клиентов', en: 'Customer bot' },
    description: {
      ru: 'бот на странице Ketner отвечает клиентам бизнеса и собирает заявки',
      en: "a bot on a Ketner page answers the business's customers and collects requests",
    },
  },
  study_assistant: {
    id: 'study_assistant',
    get available() {
      return rollout().studyAssistant;
    },
    label: { ru: 'Учебный помощник', en: 'Study assistant' },
    description: {
      ru: 'инструмент для учёбы по своим учебным файлам (PDF, DOCX, PPTX, XLSX, TXT): конспекты, таблицы, тесты с вариантами и открытыми вопросами, самопроверка с разбором ошибок и прогресс по темам. Подходит, только если у человека есть учебные материалы в файлах (учебник, лекции, конспекты, методички) и цель — выучить, подготовиться к экзамену (ЕНТ, сессия, сертификация) или проверить знания. Не подходит для общих советов по учёбе, поиска курсов, расписания и навыков без учебных материалов (спорт, музыка, разговорная практика)',
      en: 'a tool for studying from your own study files (PDF, DOCX, PPTX, XLSX, TXT): notes, tables, quizzes with multiple-choice and open questions, self-checks with feedback on mistakes and progress by topic. Fits only if the person has study materials in files (textbook, lectures, notes, handouts) and the goal is to learn, prepare for an exam (school finals, university exams, certification) or check their knowledge. Does not fit general study advice, finding courses, schedules or skills without study materials (sports, music, conversation practice)',
    },
    needs: ['document_tools'],
  },
  weekly_content: {
    id: 'weekly_content',
    available: false,
    label: { ru: 'Контент на неделю', en: 'Content for the week' },
    description: {
      ru: 'раз в неделю готовит посты и картинки под бизнес',
      en: 'prepares posts and images for the business once a week',
    },
  },
};

export function availableRecipes(): Recipe[] {
  return RECIPE_IDS.map((id) => RECIPES[id]).filter((recipe) => recipe.available);
}

/** Рецепт возможности: только доступный и только если возможность вообще можно сделать в Ketner. */
export function acceptedRecipe(
  recipe: RecipeId | null | undefined,
  status: FeasibilityStatus,
  requires: readonly CapabilityId[] = [],
): RecipeId | null {
  if (!recipe || !RECIPES[recipe].available || status === 'not_supported') return null;
  // Рецепт со своими требованиями — только для возможности, которой они действительно нужны.
  if (RECIPES[recipe].needs?.some((need) => !requires.includes(need))) return null;
  return recipe;
}

/**
 * Карта анализа всегда из пяти областей, в одном порядке. Статус области, где есть возможности
 * отчёта, — «нашли», что бы ни ответила модель; область без возможностей не может быть «нашли».
 */
export function normalizeCoverage(
  reported: ReadonlyArray<{ area: AreaId; status: CoverageStatus; note: string }>,
  opportunityAreas: ReadonlyArray<AreaId | null>,
): AreaCoverage[] {
  return AREA_IDS.map((area) => {
    const count = opportunityAreas.filter((item) => item === area).length;
    const fromModel = reported.find((item) => item.area === area);
    const status: CoverageStatus =
      count > 0 ? 'found' : fromModel?.status === 'not_relevant' ? 'not_relevant' : 'unclear';
    return { area, status, opportunities: count, note: fromModel?.note ?? '' };
  });
}

export function areasForPrompt(language: Language): string {
  return AREA_IDS.map(
    (id) => `- ${id}: ${AREAS[id].label[language]} — ${AREAS[id].scope[language]}`,
  ).join('\n');
}

export function recipesForPrompt(language: Language): string {
  return availableRecipes()
    .map((recipe) => `- ${recipe.id}: ${recipe.description[language]}`)
    .join('\n');
}
