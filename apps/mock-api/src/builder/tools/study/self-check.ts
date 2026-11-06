/**
 * Самопроверка по выбранной теме: открытые вопросы на понимание, с эталонным ответом и пунктами,
 * по которым ответ потом разбирается (операция `grade`). Вопросы — только из материалов.
 */
import { z } from 'zod';
import type { Language } from '../../../types.js';
import type { SourceText, ToolOperation } from '../operations.js';
import {
  dataRules,
  JSON_RULE,
  materialsField,
  neutralize,
  renderRequest,
  studyPolicy,
  subjectField,
} from './common.js';
import {
  presentQuestions,
  QUESTION_LIMITS,
  questionSetSchema,
  type QuestionSet,
} from './questions.js';
import { demoQuestions, questionRules } from './quiz.js';

export const selfCheckInputSchema = z
  .object({
    subject: subjectField,
    topic: z.string().trim().min(1).max(120),
    materials: materialsField,
    count: z
      .number()
      .int()
      .min(QUESTION_LIMITS.selfCheck.min)
      .max(QUESTION_LIMITS.selfCheck.max)
      .default(5),
  })
  .strict();

export type SelfCheckInput = z.infer<typeof selfCheckInputSchema>;

function systemPrompt(language: Language): string {
  const format = `{"title": "...", "questions": [{"type": "open", "question": "...", "answer": "...", "keyPoints": ["..."], "topic": "...", "evidence": "...", "explanation": "...", "sources": ["S1"]}]}`;
  if (language === 'en') {
    return `You are the self-check tool of Ketner AI. The person wants to check how well they understand one topic of their study materials. Write open questions that make them explain the idea in their own words: what it is, why, how it connects to other ideas, how to apply it — not word-for-word recall.

${dataRules('en')}

${questionRules('en')}
All questions are "open". If the materials say little about the topic, ask only what they do cover.
Write in English.

${JSON_RULE.en}
Format: ${format}`;
  }
  return `Ты — инструмент самопроверки Ketner AI. Человек хочет проверить, насколько понимает одну тему своих учебных материалов. Составь открытые вопросы, которые заставляют объяснить своими словами: что это, почему так, как связано с другим, как применить, — а не пересказать дословно.

${dataRules('ru')}

${questionRules('ru')}
Все вопросы — "open". Если о теме в материалах сказано мало, спрашивай только о том, что в них есть.
Пиши по-русски.

${JSON_RULE.ru}
Формат: ${format}`;
}

function userMessage(
  input: SelfCheckInput,
  sources: readonly SourceText[],
  language: Language,
): string {
  const en = language === 'en';
  return `${en ? 'Questions needed' : 'Нужно вопросов'}: ${input.count}.
${en ? 'Topic to check' : 'Тема для самопроверки'}: <user_data>${neutralize(input.topic)}</user_data>
${renderRequest({ subject: input.subject, focus: '', materials: input.materials }, sources, language)}`;
}

export const selfCheckOperation: ToolOperation<SelfCheckInput, QuestionSet> = {
  id: 'self_check',
  template: 'study_assistant',
  label: { ru: 'Самопроверка', en: 'Self-check' },
  policy: studyPolicy(4000),
  inputSchema: selfCheckInputSchema,
  materials: (input) => input.materials,
  subject: (input) => `${input.subject}: ${input.topic}`,
  systemPrompt,
  userMessage,
  outputSchema: (context) =>
    questionSetSchema(context, { allowed: ['open'], requested: context.input.count }),
  templateOutput: (input, sources, language) =>
    JSON.stringify({
      title: input.topic,
      questions: demoQuestions(sources, input.count, ['open'], language),
    }),
  present: presentQuestions,
};
