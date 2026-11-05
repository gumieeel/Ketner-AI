/**
 * Таблица по учебным материалам: термины и определения, даты и события, сравнение понятий — по
 * пожеланию человека. Каждая строка ссылается на части материалов; число ячеек в строке равно
 * числу колонок (иначе ответ не принимается).
 */
import { z } from 'zod';
import type { Language } from '../../../types.js';
import type { SourceText, ToolOperation } from '../operations.js';
import {
  dataRules,
  firstSentence,
  JSON_RULE,
  modelList,
  modelText,
  renderRequest,
  requiredModelText,
  sourceRefs,
  studyInputSchema,
  studyMaterials,
  studyPolicy,
  type StudyInput,
} from './common.js';

export const TABLE_LIMITS = { columns: 8, rows: 40 } as const;

export function tableSchema(refs: ReadonlySet<string>) {
  return z
    .object({
      title: requiredModelText(160),
      description: modelText(400).default(''),
      columns: z.array(requiredModelText(60)).min(2).max(TABLE_LIMITS.columns),
      rows: modelList(
        z.object({
          cells: z.array(modelText(300)),
          sources: sourceRefs(refs, 4),
        }),
        1,
        TABLE_LIMITS.rows,
      ),
    })
    .superRefine((table, context) => {
      table.rows.forEach((row, index) => {
        if (row.cells.length !== table.columns.length) {
          context.addIssue({
            code: 'custom',
            path: ['rows', index, 'cells'],
            message: `expected ${table.columns.length} cells, got ${row.cells.length}`,
          });
        }
        if (row.cells.every((cell) => cell === '')) {
          context.addIssue({ code: 'custom', path: ['rows', index], message: 'empty row' });
        }
      });
    });
}

export type TableResult = z.infer<ReturnType<typeof tableSchema>>;

function systemPrompt(language: Language): string {
  if (language === 'en') {
    return `You are the study tables tool of Ketner AI. From the person's study materials, build one table that helps to learn the topic: for example terms and definitions, dates and events, formulas and their meaning, or a comparison of concepts — whatever suits the material and the person's wishes best.

${dataRules('en')}

Rules:
- "columns": 2–${TABLE_LIMITS.columns} short column names; every row has exactly as many "cells" as there are columns, in the same order.
- "rows": up to ${TABLE_LIMITS.rows} rows, each a separate fact from the materials, short cells (no long paragraphs).
- "title": what the table is about; "description": one sentence on how to use it (optional).
- Write in English.

${JSON_RULE.en}
Format: {"title": "...", "description": "...", "columns": ["...", "..."], "rows": [{"cells": ["...", "..."], "sources": ["S1"]}]}`;
  }
  return `Ты — инструмент учебных таблиц Ketner AI. По учебным материалам человека составь одну таблицу, по которой удобно учить тему: например, термины и определения, даты и события, формулы и их смысл или сравнение понятий — что лучше подходит материалу и пожеланиям человека.

${dataRules('ru')}

Правила:
- "columns" — 2–${TABLE_LIMITS.columns} коротких названий колонок; в каждой строке ровно столько "cells", сколько колонок, в том же порядке.
- "rows" — до ${TABLE_LIMITS.rows} строк, каждая — отдельный факт из материалов, ячейки короткие (без длинных абзацев).
- "title" — о чём таблица; "description" — одно предложение, как ей пользоваться (можно пусто).
- Пиши по-русски.

${JSON_RULE.ru}
Формат: {"title": "...", "description": "...", "columns": ["...", "..."], "rows": [{"cells": ["...", "..."], "sources": ["S1"]}]}`;
}

function templateOutput(
  input: StudyInput,
  sources: readonly SourceText[],
  language: Language,
): string {
  return JSON.stringify({
    title: input.subject,
    description: '',
    columns: language === 'en' ? ['Part', 'Main idea'] : ['Часть', 'Главная мысль'],
    rows: sources.slice(0, 6).map((source) => ({
      cells: [source.label, firstSentence(source.text) || source.label],
      sources: [source.ref],
    })),
  });
}

export const tableOperation: ToolOperation<StudyInput, TableResult> = {
  id: 'table',
  template: 'study_assistant',
  label: { ru: 'Таблица', en: 'Table' },
  policy: studyPolicy(3000),
  inputSchema: studyInputSchema,
  materials: studyMaterials,
  subject: (input) => input.subject,
  systemPrompt,
  userMessage: renderRequest,
  outputSchema: tableSchema,
  templateOutput,
};
