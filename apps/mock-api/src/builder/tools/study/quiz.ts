/**
 * Тест по учебным материалам: вопросы с вариантами и открытые, у каждого — ключ, объяснение, тема и
 * дословная цитата из части материала. Ключи остаются на сервере до сдачи попытки (`present`).
 */
import { z } from 'zod';
import type { Language } from '../../../types.js';
import type { SourceText, ToolOperation } from '../operations.js';
import {
  dataRules,
  firstSentence,
  JSON_RULE,
  materialsField,
  renderRequest,
  studyPolicy,
  subjectField,
} from './common.js';
import {
  presentQuestions,
  QUESTION_LIMITS,
  questionSetSchema,
  type QuestionSet,
  type QuestionType,
} from './questions.js';

export const QUIZ_FORMATS = ['choice', 'open', 'mixed'] as const;
export type QuizFormat = (typeof QUIZ_FORMATS)[number];

export const quizInputSchema = z
  .object({
    subject: subjectField,
    focus: z.string().trim().max(300).default(''),
    materials: materialsField,
    count: z.number().int().min(QUESTION_LIMITS.quiz.min).max(QUESTION_LIMITS.quiz.max).default(8),
    format: z.enum(QUIZ_FORMATS).default('mixed'),
  })
  .strict();

export type QuizInput = z.infer<typeof quizInputSchema>;

export const allowedTypes = (format: QuizFormat): QuestionType[] =>
  format === 'mixed' ? ['choice', 'open'] : [format];

export function questionRules(language: Language): string {
  return language === 'en'
    ? `Every question:
- "type": "choice" (one correct option) or "open" (a short written answer);
- "question": clear and answerable from the materials alone;
- "topic": a short topic name (2–4 words) — questions on the same topic use exactly the same name;
- "evidence": an EXACT quote (copied character by character, 5–30 words) from the cited part that proves the answer;
- "explanation": why the answer is correct, in 1–3 sentences;
- "sources": refs of the parts the question is based on.
For "choice": "options" — 2–6 different plausible options, "correctIndex" — the index of the only correct one (from 0). Never use options like "all of the above" or "none of the above".
For "open": "answer" — a model answer in 1–4 sentences, "keyPoints" — 1–5 points a good answer must contain.`
    : `Каждый вопрос:
- "type": "choice" (один верный вариант) или "open" (короткий письменный ответ);
- "question": понятный, ответ на него есть в материалах;
- "topic": короткое название темы (2–4 слова) — у вопросов одной темы название одинаковое;
- "evidence": ДОСЛОВНАЯ цитата (скопированная символ в символ, 5–30 слов) из части, на которую ссылается вопрос, — она подтверждает ответ;
- "explanation": почему ответ верный, 1–3 предложения;
- "sources": ref частей, на которых основан вопрос.
Для "choice": "options" — 2–6 разных правдоподобных вариантов, "correctIndex" — индекс единственного верного (с 0). Никаких вариантов вроде «все вышеперечисленные» или «ни один из».
Для "open": "answer" — эталонный ответ в 1–4 предложения, "keyPoints" — 1–5 пунктов, которые должны быть в хорошем ответе.`;
}

function systemPrompt(language: Language): string {
  const format = `{"title": "...", "questions": [{"type": "choice", "question": "...", "options": ["...", "..."], "correctIndex": 0, "topic": "...", "evidence": "...", "explanation": "...", "sources": ["S1"]}, {"type": "open", "question": "...", "answer": "...", "keyPoints": ["..."], "topic": "...", "evidence": "...", "explanation": "...", "sources": ["S2"]}]}`;
  if (language === 'en') {
    return `You are the quiz tool of Ketner AI. From the person's study materials, write a test that checks understanding of the material, not trivia: key facts, definitions, causes and consequences, how to apply the ideas.

${dataRules('en')}

${questionRules('en')}

Cover different parts and topics of the materials. Write in English.

${JSON_RULE.en}
Format: ${format}`;
  }
  return `Ты — инструмент тестов Ketner AI. По учебным материалам человека составь тест, который проверяет понимание материала, а не мелочи: ключевые факты, определения, причины и следствия, применение.

${dataRules('ru')}

${questionRules('ru')}

Охвати разные части и темы материалов. Пиши по-русски.

${JSON_RULE.ru}
Формат: ${format}`;
}

function userMessage(input: QuizInput, sources: readonly SourceText[], language: Language): string {
  const en = language === 'en';
  const format = {
    choice: en ? 'only "choice" questions' : 'только вопросы "choice"',
    open: en ? 'only "open" questions' : 'только вопросы "open"',
    mixed: en ? 'both "choice" and "open" questions' : 'вопросы "choice" и "open"',
  }[input.format];
  return `${en ? 'Questions needed' : 'Нужно вопросов'}: ${input.count}; ${format}.\n${renderRequest(input, sources, language)}`;
}

/** Demo без модели: вопросы по настоящим частям, цитата — начало части. */
export function demoQuestions(
  sources: readonly SourceText[],
  count: number,
  types: readonly QuestionType[],
  language: Language,
): unknown[] {
  return Array.from({ length: count }, (_, index) => {
    const source = sources[index % sources.length]!;
    const fact = firstSentence(source.text) || source.label;
    const evidence = source.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const type = types[index % types.length]!;
    const question =
      language === 'en'
        ? `(${index + 1}) What does "${source.label}" say?`
        : `(${index + 1}) О чём говорится в части «${source.label}»?`;
    return type === 'choice'
      ? {
          type,
          question,
          options: [fact, language === 'en' ? 'Something else' : 'О другом'],
          correctIndex: 0,
          topic: source.label,
          evidence,
          explanation: fact,
          sources: [source.ref],
        }
      : {
          type,
          question,
          answer: fact,
          keyPoints: [fact],
          topic: source.label,
          evidence,
          explanation: fact,
          sources: [source.ref],
        };
  });
}

export const quizOperation: ToolOperation<QuizInput, QuestionSet> = {
  id: 'quiz',
  template: 'study_assistant',
  label: { ru: 'Тест', en: 'Quiz' },
  policy: studyPolicy(6000),
  inputSchema: quizInputSchema,
  materials: (input) => input.materials,
  subject: (input) => input.subject,
  systemPrompt,
  userMessage,
  outputSchema: (context) =>
    questionSetSchema(context, {
      allowed: allowedTypes(context.input.format),
      requested: context.input.count,
    }),
  templateOutput: (input, sources, language) =>
    JSON.stringify({
      title: input.subject,
      questions: demoQuestions(sources, input.count, allowedTypes(input.format), language),
    }),
  present: presentQuestions,
};
