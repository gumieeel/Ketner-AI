/**
 * Отраслевой плейбук (docs/ANALYSIS_V2.md, раздел 2): типовые ценные автоматизации отрасли.
 *
 * Пишут и проверяют люди, в PR; модель его не генерирует. Поиск возможностей получает плейбук
 * своей отрасли как справку: подгоняет под человека и может выйти за его пределы.
 *
 * Правила:
 * - никаких чисел-бенчмарков («+30% записей», «экономит 10 часов»): числа в отчёте — только из данных
 *   человека; тест проверяет, что в текстах нет цифр;
 * - статуса («запускается сейчас» / «скоро») в плейбуке нет: его считает сервер по каталогу в момент
 *   анализа, поэтому плейбук не меняется, когда Ketner научится новому.
 */

import type { CapabilityId } from '../capabilities.js';
import type { Language } from '../../types.js';

export type Text = Readonly<Record<Language, string>>;

/** Чего нет в каталоге возможностей отдельным id — модель указывает "other" с этим описанием. */
export type PlaybookNeed = CapabilityId | { other: Text };

export interface PlaybookItem {
  id: string;
  title: Text;
  /** Что болит — словами владельца. */
  pain: Text;
  /** Событие, с которого начинается процесс. */
  trigger: Text;
  /** Два–шесть шагов агента. */
  steps: readonly Text[];
  result: Text;
  dataNeeded: readonly Text[];
  /** Что нужно от Ketner: id каталога или «other» с описанием. */
  needs: readonly PlaybookNeed[];
}

export interface Playbook {
  id: string;
  name: Text;
  items: readonly PlaybookItem[];
}
