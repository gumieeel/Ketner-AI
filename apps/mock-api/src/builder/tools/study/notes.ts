/**
 * Конспект: разделы с главными мыслями и терминами по учебным материалам. Каждый раздел ссылается на
 * части материалов, из которых взят.
 */
import { z } from 'zod';
import type { Language } from '../../../types.js';
import type { SourceText, ToolOperation } from '../operations.js';
import {
  dataRules,
  firstSentence,
  JSON_RULE,
  modelList,
  renderRequest,
  requiredModelText,
  sourceRefs,
  studyInputSchema,
  studyMaterials,
  studyPolicy,
  type StudyInput,
} from './common.js';

export function notesSchema({ refs }: { refs: ReadonlySet<string> }) {
  return z.object({
    title: requiredModelText(160),
    summary: requiredModelText(1200),
    sections: modelList(
      z.object({
        heading: requiredModelText(160),
        points: modelList(requiredModelText(400), 1, 12),
        keyTerms: modelList(
          z.object({ term: requiredModelText(80), definition: requiredModelText(300) }),
          0,
          8,
        ).default([]),
        sources: sourceRefs(refs, 6),
      }),
      1,
      12,
    ),
  });
}

export type NotesResult = z.infer<ReturnType<typeof notesSchema>>;

function systemPrompt(language: Language): string {
  if (language === 'en') {
    return `You are the study notes tool of Ketner AI. From the person's study materials, write concise, well-structured notes to learn from: the key ideas grouped into sections, with the important terms and their definitions.

${dataRules('en')}

Rules:
- "title": the topic of the notes; "summary": 2–4 sentences — what the material is about and what matters most.
- "sections": 3–10 sections in the logical order of the topic; each has a "heading", 2–8 short "points" (one idea each, in your own words, no filler) and up to 6 "keyTerms" with definitions taken from the materials.
- Write in English. Respect the person's wishes about what to focus on, if they do not contradict these rules.

${JSON_RULE.en}
Format: {"title": "...", "summary": "...", "sections": [{"heading": "...", "points": ["..."], "keyTerms": [{"term": "...", "definition": "..."}], "sources": ["S1"]}]}`;
  }
  return `Ты — инструмент конспектов Ketner AI. По учебным материалам человека напиши краткий структурированный конспект, по которому можно учить: главные мысли по разделам и важные термины с определениями.

${dataRules('ru')}

Правила:
- "title" — тема конспекта; "summary" — 2–4 предложения: о чём материал и что в нём главное.
- "sections" — 3–10 разделов в логическом порядке темы; у каждого "heading", 2–8 коротких "points" (одна мысль в пункте, своими словами, без воды) и до 6 "keyTerms" с определениями из материалов.
- Пиши по-русски. Учитывай пожелания человека, на что обратить внимание, если они не противоречат этим правилам.

${JSON_RULE.ru}
Формат: {"title": "...", "summary": "...", "sections": [{"heading": "...", "points": ["..."], "keyTerms": [{"term": "...", "definition": "..."}], "sources": ["S1"]}]}`;
}

function templateOutput(input: StudyInput, sources: readonly SourceText[]): string {
  return JSON.stringify({
    title: input.subject,
    summary: firstSentence(sources[0]?.text ?? input.subject) || input.subject,
    sections: sources.slice(0, 4).map((source) => ({
      heading: source.label,
      points: [firstSentence(source.text) || source.label],
      keyTerms: [],
      sources: [source.ref],
    })),
  });
}

export const notesOperation: ToolOperation<StudyInput, NotesResult> = {
  id: 'notes',
  template: 'study_assistant',
  label: { ru: 'Конспект', en: 'Notes' },
  policy: studyPolicy(4000),
  inputSchema: studyInputSchema,
  materials: studyMaterials,
  subject: (input) => input.subject,
  systemPrompt,
  userMessage: renderRequest,
  outputSchema: notesSchema,
  templateOutput,
};
