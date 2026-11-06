/**
 * Вопросы по учебным материалам — общее для теста (`quiz`) и самопроверки (`self_check`), и
 * проверка открытых ответов (`grade`).
 *
 * Модель предлагает вопросы, сервер решает, какие показать. Вопрос принимается, только если:
 *   - ссылается на существующие части материалов и приводит дословную цитату (`evidence`), которая
 *     действительно есть в тексте одной из этих частей (вопрос по материалам, а не «из головы»);
 *   - у варианта ответа — 2–6 разных вариантов, ровно один верный с индексом в пределах, без
 *     «все вышеперечисленные» / «ни один из» (они делают ключ неоднозначным);
 *   - у открытого — эталонный ответ и 1–5 пунктов, по которым его проверяют;
 *   - есть объяснение и тема (по темам считается прогресс);
 *   - тип разрешён запуском (тест «только варианты» не получит открытых вопросов).
 * Непрошедшие отбрасываются; если осталось меньше минимума — ответ не принимается (одна попытка
 * исправить с описанием причин, как у других операций).
 */
import { z } from 'zod';
import type { OutputContext, SourceText } from '../operations.js';
import { modelText, requiredModelText } from './common.js';

export type QuestionType = 'choice' | 'open';

interface QuestionBase {
  id: string;
  question: string;
  explanation: string;
  topic: string;
  evidence: string;
  sources: string[];
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice';
  options: string[];
  correctIndex: number;
}

export interface OpenQuestion extends QuestionBase {
  type: 'open';
  answer: string;
  keyPoints: string[];
}

export type Question = ChoiceQuestion | OpenQuestion;

/** Принятый вопрос до нумерации. */
export type QuestionDraft = Omit<ChoiceQuestion, 'id'> | Omit<OpenQuestion, 'id'>;

export interface QuestionSet {
  title: string;
  questions: Question[];
  /** Сколько вопросов модели отброшено проверкой. */
  rejected: number;
}

/** Что видит сайт до сдачи попытки: без ключей, объяснений, цитат и эталонов. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  topic: string;
  sources: string[];
}

export const QUESTION_LIMITS = {
  quiz: { min: 3, max: 15 },
  selfCheck: { min: 3, max: 8 },
  options: { min: 2, max: 6 },
  keyPoints: { min: 1, max: 5 },
  /** Короче — цитата не доказывает, что вопрос взят из материала. */
  evidenceMinChars: 12,
} as const;

/** Сколько вопросов должно пройти проверку: не меньше 3 и не меньше 60% запрошенных. */
export function minimumQuestions(requested: number): number {
  return Math.min(requested, Math.max(3, Math.ceil(requested * 0.6)));
}

/** Текст для сравнения цитат: регистр, «ё», пунктуация и пробелы не важны. */
export function normalizeQuote(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function quoteInSources(evidence: string, sources: readonly SourceText[]): boolean {
  const quote = normalizeQuote(evidence);
  if (quote.length < QUESTION_LIMITS.evidenceMinChars) return false;
  return sources.some((source) => normalizeQuote(source.text).includes(quote));
}

const AMBIGUOUS_OPTION =
  /^(все (выше)?перечисленн|ни один из|нет (верного|правильного)|все ответы верны|all of the above|none of the above|both a and b)/i;

const rawQuestion = z.object({
  type: z.string(),
  question: z.string(),
  options: z.array(z.string()).optional(),
  correctIndex: z.number().optional(),
  answer: z.string().optional(),
  keyPoints: z.array(z.string()).optional(),
  explanation: z.string().optional(),
  topic: z.string().optional(),
  evidence: z.string().optional(),
  sources: z.array(z.string()).optional(),
});

type RawQuestion = z.infer<typeof rawQuestion>;

const clip = (value: string | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Проверка одного вопроса: принятый вопрос (без id) или причина отказа. */
export function checkQuestion(
  raw: RawQuestion,
  context: Pick<OutputContext, 'refs' | 'sources'>,
  allowed: readonly QuestionType[],
): QuestionDraft | { reason: string } {
  const type = raw.type.trim().toLowerCase();
  if (type !== 'choice' && type !== 'open') return { reason: `unsupported type "${raw.type}"` };
  if (!allowed.includes(type)) return { reason: `type ${type} is not allowed in this run` };
  const question = clip(raw.question, 400);
  if (!question) return { reason: 'empty question' };
  const explanation = clip(raw.explanation, 600);
  if (!explanation) return { reason: 'no explanation' };
  const topic = clip(raw.topic, 80);
  if (!topic) return { reason: 'no topic' };
  const sources = [...new Set((raw.sources ?? []).map((ref) => ref.trim().toUpperCase()))].filter(
    (ref) => context.refs.has(ref),
  );
  if (sources.length === 0) return { reason: 'no existing source ref' };
  const evidence = clip(raw.evidence, 300);
  const cited = context.sources.filter((source) => sources.includes(source.ref));
  if (!quoteInSources(evidence, cited)) {
    return { reason: 'evidence is not a quote from the cited parts' };
  }
  const base = { question, explanation, topic, evidence, sources: sources.slice(0, 4) };

  if (type === 'choice') {
    const options = (raw.options ?? []).map((option) => clip(option, 200));
    if (
      options.length < QUESTION_LIMITS.options.min ||
      options.length > QUESTION_LIMITS.options.max
    ) {
      return {
        reason: `choice needs ${QUESTION_LIMITS.options.min}-${QUESTION_LIMITS.options.max} options`,
      };
    }
    if (options.some((option) => !option)) return { reason: 'empty option' };
    if (new Set(options.map(normalizeQuote)).size !== options.length) {
      return { reason: 'duplicate options' };
    }
    if (options.some((option) => AMBIGUOUS_OPTION.test(option))) {
      return { reason: 'ambiguous option like "all of the above"' };
    }
    const index = raw.correctIndex;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= options.length
    ) {
      return { reason: 'correctIndex is not a valid option index' };
    }
    return { type: 'choice', ...base, options, correctIndex: index };
  }

  const answer = clip(raw.answer, 800);
  if (!answer) return { reason: 'open question needs a model answer' };
  const keyPoints = (raw.keyPoints ?? []).map((point) => clip(point, 200)).filter(Boolean);
  if (keyPoints.length < QUESTION_LIMITS.keyPoints.min) {
    return { reason: 'open question needs key points' };
  }
  return {
    type: 'open',
    ...base,
    answer,
    keyPoints: keyPoints.slice(0, QUESTION_LIMITS.keyPoints.max),
  };
}

/** Схема набора вопросов: проверенные вопросы с id `q1…`, не больше запрошенного. */
export function questionSetSchema(
  context: Pick<OutputContext, 'refs' | 'sources'>,
  options: { allowed: readonly QuestionType[]; requested: number },
) {
  const min = minimumQuestions(options.requested);
  return z
    .object({
      title: requiredModelText(160),
      questions: z.array(rawQuestion).min(1).max(40),
    })
    .transform((value, issues): QuestionSet => {
      const kept: QuestionDraft[] = [];
      const reasons: string[] = [];
      const seen = new Set<string>();
      value.questions.forEach((raw, index) => {
        const checked = checkQuestion(raw, context, options.allowed);
        if ('reason' in checked) {
          reasons.push(`questions[${index}]: ${checked.reason}`);
          return;
        }
        const key = normalizeQuote(checked.question);
        if (seen.has(key)) {
          reasons.push(`questions[${index}]: duplicate question`);
          return;
        }
        seen.add(key);
        kept.push(checked);
      });
      const questions = kept
        .slice(0, options.requested)
        .map((question, index) => ({ ...question, id: `q${index + 1}` }) as Question);
      if (questions.length < min) {
        issues.addIssue({
          code: 'custom',
          message: `only ${questions.length} valid questions, need at least ${min}. ${reasons.slice(0, 6).join('; ')}`,
        });
        return z.NEVER;
      }
      return { title: value.title, questions, rejected: value.questions.length - kept.length };
    });
}

/** Набор вопросов для сайта до сдачи: ключи ответов остаются на сервере. */
export function presentQuestions(set: QuestionSet): {
  title: string;
  questions: PublicQuestion[];
  rejected: number;
} {
  return {
    title: set.title,
    rejected: set.rejected,
    questions: set.questions.map((question) => ({
      id: question.id,
      type: question.type,
      question: question.question,
      ...(question.type === 'choice' ? { options: question.options } : {}),
      topic: question.topic,
      sources: question.sources,
    })),
  };
}

// ─── Проверка открытых ответов (`grade`) ──────────────────────────────────────

export interface GradeItem {
  questionId: string;
  question: string;
  keyPoints: string[];
  modelAnswer: string;
  answer: string;
  /** Части материалов, на которые опирается вопрос. */
  sections: Array<{ materialId: string; sectionId: string }>;
}

export interface GradeResult {
  results: Array<{
    questionId: string;
    verdict: 'correct' | 'partial' | 'incorrect';
    feedback: string;
    missing: string[];
    sources: string[];
  }>;
}

export function gradeSchema(context: Pick<OutputContext, 'refs'>, expected: readonly string[]) {
  return z
    .object({
      results: z.array(
        z.object({
          questionId: z.string(),
          verdict: z.enum(['correct', 'partial', 'incorrect']),
          feedback: requiredModelText(600),
          missing: z.array(modelText(200)).default([]),
          sources: z.array(z.string()).default([]),
        }),
      ),
    })
    .transform((value, issues): GradeResult => {
      const wanted = new Set(expected);
      const byId = new Map<string, GradeResult['results'][number]>();
      for (const item of value.results) {
        const id = item.questionId.trim();
        // Только запрошенные вопросы и по одному разу: лишнее и повторы не засчитываются.
        if (!wanted.has(id) || byId.has(id)) continue;
        byId.set(id, {
          questionId: id,
          verdict: item.verdict,
          feedback: item.feedback,
          missing: item.missing.filter(Boolean).slice(0, 5),
          sources: [...new Set(item.sources.map((ref) => ref.trim().toUpperCase()))]
            .filter((ref) => context.refs.has(ref))
            .slice(0, 4),
        });
      }
      const absent = expected.filter((id) => !byId.has(id));
      if (absent.length > 0) {
        issues.addIssue({ code: 'custom', message: `no verdict for: ${absent.join(', ')}` });
        return z.NEVER;
      }
      return { results: expected.map((id) => byId.get(id)!) };
    });
}

export const VERDICT_SCORE: Record<'correct' | 'partial' | 'incorrect', number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
};
