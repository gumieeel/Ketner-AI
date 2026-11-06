/**
 * Поэтапное включение готовых функций — один источник для всех, кто от них зависит (каталог
 * возможностей и рецепты анализа, реестр шаблонов Builder, галерея). Значения — из config; тесты
 * задают их явно через `setRolloutForTests` (каждый файл тестов идёт в своём процессе).
 */
import { config } from '../config.js';

export interface Rollout {
  /** Учебный помощник: шаблон study_assistant и возможность «документы в инструментах». */
  studyAssistant: boolean;
}

let override: Partial<Rollout> | null = null;

export function rollout(): Rollout {
  return { studyAssistant: override?.studyAssistant ?? config.studyAssistantEnabled };
}

/** Только для тестов: `null` возвращает значения из config. */
export function setRolloutForTests(value: Partial<Rollout> | null): void {
  override = value;
}
