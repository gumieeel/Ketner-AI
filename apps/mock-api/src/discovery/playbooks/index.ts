/**
 * Выбор отраслевого плейбука и его текст для поиска возможностей (docs/ANALYSIS_V2.md, раздел 2).
 */

import type { Language } from '../../types.js';
import { AUTO } from './auto.js';
import { B2B_SERVICES } from './b2b-services.js';
import { BEAUTY } from './beauty.js';
import { EDUCATION } from './education.js';
import { FOOD } from './food.js';
import { GENERAL } from './general.js';
import { MEDICAL } from './medical.js';
import { ONLINE_STORE } from './online-store.js';
import { REAL_ESTATE } from './real-estate.js';
import type { Playbook, PlaybookNeed } from './types.js';

export type { Playbook, PlaybookItem } from './types.js';

export const PLAYBOOKS: readonly Playbook[] = [
  MEDICAL,
  BEAUTY,
  AUTO,
  ONLINE_STORE,
  EDUCATION,
  REAL_ESTATE,
  B2B_SERVICES,
  FOOD,
  GENERAL,
];

/** Объём плейбука в промпте, символов. */
export const PLAYBOOK_PROMPT_MAX_CHARS = 4_000;

/** Плейбук по отрасли из разбора описания; нет отрасли или плейбука — общий. */
export function playbookFor(
  industry: string | null | undefined,
  businessModel: string | null | undefined,
): Playbook {
  switch (industry) {
    case 'medical':
      return MEDICAL;
    case 'beauty':
      return BEAUTY;
    case 'auto':
      return AUTO;
    case 'online_store':
      return ONLINE_STORE;
    case 'education':
      return EDUCATION;
    case 'real_estate':
      return REAL_ESTATE;
    case 'food':
      return FOOD;
    case 'services':
      return businessModel === 'b2b' || businessModel === 'mixed' ? B2B_SERVICES : GENERAL;
    default:
      return GENERAL;
  }
}

const HEADER: Record<Language, (name: string) => string> = {
  ru: (name) =>
    `Справка: типовые ценные автоматизации для отрасли «${name}». Это примеры, а не готовый ответ: выбери то, что подходит этому бизнесу, опиши словами человека, можно выйти за пределы списка. Числа в справке не приводятся: цифры — только из данных человека. «Нужно» — id каталога для "requires"; "other" — с описанием в "otherRequirement".`,
  en: (name) =>
    `Reference: typical high-value automations for the "${name}" industry. These are examples, not the answer: pick what fits this business, describe it in the person's words, and go beyond the list if needed. The reference gives no numbers: figures come only from the person's data. "Needs" are catalog ids for "requires"; "other" goes with a description in "otherRequirement".`,
};

const LABELS: Record<Language, { pain: string; flow: string; data: string; needs: string }> = {
  ru: { pain: 'Боль', flow: 'Процесс', data: 'Данные', needs: 'Нужно' },
  en: { pain: 'Pain', flow: 'Flow', data: 'Data', needs: 'Needs' },
};

function needText(need: PlaybookNeed, language: Language): string {
  return typeof need === 'string' ? need : `other (${need.other[language]})`;
}

/** Текст плейбука для промпта — не больше `PLAYBOOK_PROMPT_MAX_CHARS`. */
export function playbookForPrompt(playbook: Playbook, language: Language): string {
  const label = LABELS[language];
  const lines = [HEADER[language](playbook.name[language])];
  for (const item of playbook.items) {
    const flow = [item.trigger, ...item.steps, item.result]
      .map((text) => text[language])
      .join(' → ');
    const needs = [...new Set(item.needs.map((need) => needText(need, language)))].join(', ');
    const data = item.dataNeeded.map((text) => text[language]).join(', ');
    const line = `- ${item.title[language]}. ${label.pain}: ${item.pain[language]} ${label.flow}: ${flow}. ${label.data}: ${data}. ${label.needs}: ${needs}.`;
    if (lines.join('\n').length + line.length + 1 > PLAYBOOK_PROMPT_MAX_CHARS) break;
    lines.push(line);
  }
  return lines.join('\n');
}
