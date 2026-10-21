/**
 * Перекрёстная проверка нейросетей: модель одной компании проверяет работу модели другой.
 *
 * Три режима на одном механизме:
 *   - проверка ответа в чате (`buildAnswerReviewPrompt` → `parseAnswerReview`);
 *   - ревью правок агента Ketner Code (`buildCodeReviewPrompt` → `parseCodeReview`);
 *   - судья сравнения: итоговый ответ из нескольких и список расхождений (`buildJudgePrompt`,
 *     `JudgeStreamSplitter`, `parseJudgeTail`).
 *
 * Рецензент отвечает JSON. Модели иногда оборачивают его в ```json, пишут размышления в <think>
 * или добавляют фразу до и после, поэтому разбор терпимый: берётся первый объект в тексте, поля
 * нормализуются, а если JSON не читается, итог `unknown` с текстом рецензента в summary.
 * Сам вызов модели идёт через обычный шлюз (`runReviewTask`): права, бюджет тарифа, учёт расхода
 * и честное имя модели те же, что у ответа в чате.
 */

import type { AIGateway } from '../ai/gateway.js';
import type { ReasoningMode } from '../ai/gateway-types.js';
import type {
  AnswerReviewIssue,
  AnswerVerdict,
  Language,
  PlanId,
  ReviewSeverity,
  ReviewerInfo,
} from '../types.js';
import type { ReviewerCandidate } from './review-policy.js';

/** Сколько символов вопроса и ответа уходит рецензенту: потолок цены одной проверки. */
export const REVIEW_QUESTION_CHARS = 8_000;
export const REVIEW_ANSWER_CHARS = 40_000;
/** Сколько символов правок уходит на ревью кода (остальное обрезается с пометкой). */
export const CODE_REVIEW_PATCH_CHARS = 60_000;
/** Сколько символов каждого ответа видит судья сравнения. */
export const JUDGE_ANSWER_CHARS = 16_000;

const MAX_ISSUES = 10;
const TEXT_CAP = 1_500;
const QUOTE_CAP = 300;

/** Маркер, после которого судья пишет JSON с расхождениями. */
export const JUDGE_MARKER = '<<<DISPUTES>>>';

function text(language: Language, ru: string, en: string): string {
  return language === 'en' ? en : ru;
}

function clip(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}\n[…обрезано: ещё ${value.length - max} символов]`
    : value;
}

function cap(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Размышления и обёртки, которые модели пишут вокруг ответа. */
export function stripThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/**
 * Первый JSON-объект в тексте: без ```-ограды, размышлений и пояснений вокруг. Скобки внутри
 * строк не считаются, поэтому код в полях `fix` не ломает поиск конца объекта.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const source = stripThinking(raw);
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(source.slice(start, index + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function severityOf(value: unknown): ReviewSeverity {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (['high', 'critical', 'major', 'высокая', 'критично', 'серьёзно'].includes(raw)) return 'high';
  if (['low', 'minor', 'info', 'низкая', 'мелочь'].includes(raw)) return 'low';
  return 'medium';
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { high: 0, medium: 1, low: 2 };

function bySeverity<T extends { severity: ReviewSeverity }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] || a.index - b.index,
    )
    .map(({ item }) => item);
}

// ─────────────────────────────────────────────────────────────
// Проверка ответа в чате
// ─────────────────────────────────────────────────────────────

export function buildAnswerReviewPrompt(language: Language): string {
  if (language === 'en') {
    return [
      'You are an independent reviewer in the Ketner AI service. You get a user question and an answer written by another AI model from a different company.',
      'Check the answer for: factual errors, wrong calculations, bugs in code, made-up facts, names, links, quotes or numbers, outdated information, missing important caveats, and not answering what was asked.',
      'Do not nitpick style or wording unless it distorts the meaning. If you cannot verify a fact, say so in "problem" ("could not verify") with severity low. Do not invent errors to look useful: if the answer is correct, return verdict ok with an empty issues list.',
      'Reply with JSON ONLY, no text around it, in the language of the user question:',
      '{"verdict":"ok|minor|major|wrong","summary":"1-2 sentences: can the answer be trusted","issues":[{"severity":"high|medium|low","quote":"exact short quote from the answer, up to 200 characters","problem":"what is wrong","fix":"what is correct"}],"corrected":"the full corrected answer, ONLY if verdict is major or wrong, otherwise an empty string"}',
      'verdict: ok — no errors; minor — small inaccuracies; major — serious errors but the core is right; wrong — the answer is mostly wrong. At most 8 issues, the most important first.',
    ].join('\n');
  }
  return [
    'Ты — независимый рецензент в сервисе Ketner AI. Тебе дают вопрос пользователя и ответ, который написала нейросеть другой компании.',
    'Проверь ответ: фактические ошибки, неверные вычисления, ошибки в коде, выдуманные факты, имена, ссылки, цитаты и цифры, устаревшие сведения, пропущенные важные оговорки, ответ не на тот вопрос.',
    'Не придирайся к стилю и формулировкам, если они не искажают смысл. Если не можешь подтвердить факт, так и напиши в problem («не удалось подтвердить») с severity low. Не выдумывай ошибки ради пользы: если ответ верный, верни verdict ok и пустой список issues.',
    'Отвечай ТОЛЬКО JSON, без текста вокруг, на языке вопроса пользователя:',
    '{"verdict":"ok|minor|major|wrong","summary":"1–2 предложения: можно ли доверять ответу","issues":[{"severity":"high|medium|low","quote":"точная короткая цитата из ответа, до 200 символов","problem":"что не так","fix":"как правильно"}],"corrected":"исправленный ответ целиком, ТОЛЬКО если verdict major или wrong, иначе пустая строка"}',
    'verdict: ok — ошибок нет; minor — мелкие неточности; major — серьёзные ошибки, но основа верна; wrong — ответ в целом неверен. Не больше 8 замечаний, самые важные первыми.',
  ].join('\n');
}

export function buildAnswerReviewInput(
  question: string,
  answer: string,
  language: Language,
): string {
  const q = clip(question.trim(), REVIEW_QUESTION_CHARS);
  const a = clip(stripThinking(answer), REVIEW_ANSWER_CHARS);
  return language === 'en'
    ? `User question:\n<question>\n${q}\n</question>\n\nAnswer to review:\n<answer>\n${a}\n</answer>`
    : `Вопрос пользователя:\n<question>\n${q}\n</question>\n\nОтвет, который нужно проверить:\n<answer>\n${a}\n</answer>`;
}

const VERDICTS: Record<string, AnswerVerdict> = {
  ok: 'ok',
  correct: 'ok',
  good: 'ok',
  minor: 'minor',
  major: 'major',
  wrong: 'wrong',
  incorrect: 'wrong',
};

export interface ParsedAnswerReview {
  verdict: AnswerVerdict;
  summary: string;
  issues: AnswerReviewIssue[];
  corrected?: string;
}

export function parseAnswerReview(raw: string, answer: string): ParsedAnswerReview {
  const json = extractJsonObject(raw);
  if (!json) {
    return { verdict: 'unknown', summary: cap(stripThinking(raw), TEXT_CAP), issues: [] };
  }
  const verdictRaw = typeof json.verdict === 'string' ? json.verdict.toLowerCase().trim() : '';
  const issues: AnswerReviewIssue[] = [];
  if (Array.isArray(json.issues)) {
    for (const item of json.issues.slice(0, MAX_ISSUES * 2)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const problem = cap(record.problem ?? record.issue ?? record.description, TEXT_CAP);
      if (!problem) continue;
      const quote = cap(record.quote, QUOTE_CAP);
      const fix = cap(record.fix ?? record.correction, TEXT_CAP);
      issues.push({
        severity: severityOf(record.severity),
        // Цитату, которой нет в ответе, не показываем как цитату: рецензент её выдумал или пересказал.
        ...(quote && answer.includes(quote) ? { quote } : {}),
        problem: quote && !answer.includes(quote) ? `«${quote}»: ${problem}` : problem,
        ...(fix ? { fix } : {}),
      });
    }
  }
  let verdict: AnswerVerdict = VERDICTS[verdictRaw] ?? 'unknown';
  // Итог и замечания должны сходиться: «ok» с серьёзным замечанием — не ok.
  if (verdict === 'ok' && issues.some((issue) => issue.severity !== 'low')) verdict = 'minor';
  // Итог не указан или не по формату, но замечания есть: итог выводится из них.
  if (verdict === 'unknown' && issues.length > 0) {
    verdict = issues.some((issue) => issue.severity === 'high') ? 'major' : 'minor';
  }
  const corrected = cap(json.corrected, REVIEW_ANSWER_CHARS);
  return {
    verdict,
    summary: cap(json.summary, TEXT_CAP),
    issues: bySeverity(issues).slice(0, MAX_ISSUES),
    ...(corrected && (verdict === 'major' || verdict === 'wrong') ? { corrected } : {}),
  };
}

/** Пример проверки для demo-режима без настоящих моделей (локально без ключа и в тестах). */
export function answerReviewTemplate(answer: string, language: Language): string {
  const firstLine =
    stripThinking(answer)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const quote = firstLine.slice(0, 80);
  return JSON.stringify({
    verdict: 'minor',
    summary: text(
      language,
      'Демо-режим: настоящая модель не подключена, это пример того, как выглядит проверка.',
      'Demo mode: no real model is connected, this is an example of how a review looks.',
    ),
    issues: quote
      ? [
          {
            severity: 'low',
            quote,
            problem: text(
              language,
              'Пример замечания: в demo-режиме ответ не проверяется по существу.',
              'Example issue: in demo mode the answer is not actually checked.',
            ),
            fix: text(
              language,
              'Подключите ключ OpenRouter, чтобы проверку делала настоящая модель.',
              'Connect an OpenRouter key so a real model does the review.',
            ),
          },
        ]
      : [],
    corrected: '',
  });
}

// ─────────────────────────────────────────────────────────────
// Ревью кода (Ketner Code)
// ─────────────────────────────────────────────────────────────

export type CodeVerdict = 'approve' | 'changes' | 'unknown';

export interface CodeReviewIssue {
  severity: ReviewSeverity;
  file?: string;
  line?: number;
  problem: string;
  fix?: string;
}

export interface ParsedCodeReview {
  verdict: CodeVerdict;
  summary: string;
  issues: CodeReviewIssue[];
}

export interface ReviewedChange {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  from?: string;
  patch?: string;
}

export function buildCodeReviewPrompt(language: Language): string {
  if (language === 'en') {
    return [
      'You are a senior code reviewer. Another AI coding agent (from a different company) has just completed a user task in a project and made the changes below (diff lines starting with + were added, - were removed).',
      'Find: bugs and logic errors, unhandled edge cases, security problems (injections, leaked secrets, unsafe paths), broken imports or types, changes that do not actually solve the task, unnecessary or dangerous edits.',
      'Do not comment on style unless it causes problems. Do not invent issues: if the changes are fine, approve them with an empty issues list.',
      'Reply with JSON ONLY, no text around it, in the language of the task:',
      '{"verdict":"approve|changes","summary":"1-2 sentences","issues":[{"severity":"high|medium|low","file":"path","line":line number in the new version or null,"problem":"what is wrong","fix":"exactly what to change"}]}',
      'approve — the changes can stay (minor notes are allowed); changes — there are errors that must be fixed. At most 10 issues, the most important first.',
    ].join('\n');
  }
  return [
    'Ты — опытный ревьюер кода. ИИ-агент другой компании только что выполнил задачу пользователя в проекте и внёс правки ниже (строки diff с + добавлены, с - удалены).',
    'Найди: баги и логические ошибки, неучтённые крайние случаи, уязвимости (инъекции, утечка секретов, небезопасные пути), сломанные импорты и типы, правки, которые не решают задачу, лишние или опасные изменения.',
    'Не комментируй стиль, если он не создаёт проблем. Не выдумывай замечания: если правки в порядке, одобри их с пустым списком issues.',
    'Отвечай ТОЛЬКО JSON, без текста вокруг, на языке задачи:',
    '{"verdict":"approve|changes","summary":"1–2 предложения","issues":[{"severity":"high|medium|low","file":"путь","line":номер строки в новой версии или null,"problem":"что не так","fix":"что конкретно поправить"}]}',
    'approve — правки можно оставить (мелкие замечания допустимы); changes — есть ошибки, которые надо исправить. Не больше 10 замечаний, самые важные первыми.',
  ].join('\n');
}

export function buildCodeReviewInput(
  task: string,
  summary: string,
  changes: readonly ReviewedChange[],
  language: Language,
): string {
  let budget = CODE_REVIEW_PATCH_CHARS;
  const blocks: string[] = [];
  let omitted = 0;
  for (const change of changes) {
    const head = `### ${change.from ? `${change.from} → ` : ''}${change.path} (${change.action}, +${change.additions} −${change.deletions})`;
    const patch = change.patch ?? '';
    if (budget <= 0) {
      omitted++;
      continue;
    }
    const body = patch.length > budget ? `${patch.slice(0, budget)}\n… [обрезано]` : patch;
    budget -= body.length;
    blocks.push(body ? `${head}\n\`\`\`diff\n${body}\n\`\`\`` : head);
  }
  if (omitted > 0) {
    blocks.push(
      text(
        language,
        `…и ещё ${omitted} файлов без diff`,
        `…and ${omitted} more files without diff`,
      ),
    );
  }
  const taskText = clip(task.trim(), REVIEW_QUESTION_CHARS);
  const summaryText = clip(stripThinking(summary), 4_000);
  return language === 'en'
    ? `Task:\n${taskText}\n\nAgent's final note:\n${summaryText || '(none)'}\n\nChanges:\n${blocks.join('\n\n')}`
    : `Задача:\n${taskText}\n\nИтог агента:\n${summaryText || '(нет)'}\n\nПравки:\n${blocks.join('\n\n')}`;
}

export function parseCodeReview(raw: string): ParsedCodeReview {
  const json = extractJsonObject(raw);
  if (!json) {
    return { verdict: 'unknown', summary: cap(stripThinking(raw), TEXT_CAP), issues: [] };
  }
  const verdictRaw = typeof json.verdict === 'string' ? json.verdict.toLowerCase().trim() : '';
  const issues: CodeReviewIssue[] = [];
  if (Array.isArray(json.issues)) {
    for (const item of json.issues.slice(0, MAX_ISSUES * 2)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const problem = cap(record.problem ?? record.issue ?? record.description, TEXT_CAP);
      if (!problem) continue;
      const file = cap(record.file ?? record.path, 300);
      const line =
        typeof record.line === 'number' && Number.isInteger(record.line) && record.line > 0
          ? record.line
          : undefined;
      const fix = cap(record.fix ?? record.suggestion, TEXT_CAP);
      issues.push({
        severity: severityOf(record.severity),
        ...(file ? { file } : {}),
        ...(line ? { line } : {}),
        problem,
        ...(fix ? { fix } : {}),
      });
    }
  }
  let verdict: CodeVerdict =
    verdictRaw === 'approve' || verdictRaw === 'approved' || verdictRaw === 'ok'
      ? 'approve'
      : verdictRaw === 'changes' || verdictRaw === 'request_changes' || verdictRaw === 'reject'
        ? 'changes'
        : 'unknown';
  if (verdict === 'approve' && issues.some((issue) => issue.severity === 'high')) {
    verdict = 'changes';
  }
  return {
    verdict,
    summary: cap(json.summary, TEXT_CAP),
    issues: bySeverity(issues).slice(0, MAX_ISSUES),
  };
}

export function codeReviewTemplate(changes: readonly ReviewedChange[], language: Language): string {
  const first = changes[0];
  return JSON.stringify({
    verdict: first ? 'changes' : 'approve',
    summary: text(
      language,
      'Демо-режим: настоящая модель не подключена, это пример ревью.',
      'Demo mode: no real model is connected, this is an example review.',
    ),
    issues: first
      ? [
          {
            severity: 'medium',
            file: first.path,
            line: null,
            problem: text(
              language,
              'Пример замечания: в demo-режиме правки не проверяются по существу.',
              'Example issue: in demo mode the changes are not actually reviewed.',
            ),
            fix: text(
              language,
              'Подключите ключ OpenRouter, чтобы ревью делала настоящая модель.',
              'Connect an OpenRouter key so a real model does the review.',
            ),
          },
        ]
      : [],
  });
}

/** Задача для агента «исправь замечания ревью»: уходит в обычный запуск Ketner Code. */
export function buildFixTask(
  issues: readonly CodeReviewIssue[],
  reviewerName: string,
  language: Language,
): string {
  const lines = issues.map((issue, index) => {
    const where = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''} — ` : '';
    const fix = issue.fix
      ? language === 'en'
        ? ` Fix: ${issue.fix}`
        : ` Как исправить: ${issue.fix}`
      : '';
    return `${index + 1}. ${where}${issue.problem}${fix}`;
  });
  return language === 'en'
    ? `Code review by ${reviewerName} found issues in your last changes. Check each one; fix the real ones and skip those that are wrong (say why):\n${lines.join('\n')}`
    : `Ревью ${reviewerName} нашло замечания к последним правкам. Проверь каждое: настоящие исправь, ошибочные пропусти и объясни почему:\n${lines.join('\n')}`;
}

// ─────────────────────────────────────────────────────────────
// Судья сравнения («консилиум»)
// ─────────────────────────────────────────────────────────────

export type JudgeAgreement = 'full' | 'partial' | 'low' | 'unknown';

export interface JudgeDispute {
  topic: string;
  positions: Array<{ model: string; claim: string }>;
  resolution?: string;
}

export interface ParsedJudgeTail {
  agreement: JudgeAgreement;
  consensus: string[];
  disputes: JudgeDispute[];
}

export interface JudgedAnswer {
  modelName: string;
  content: string;
}

export function buildJudgePrompt(language: Language): string {
  if (language === 'en') {
    return [
      'You are the judge in the Ketner AI service. Several AI models from different companies answered the same user question.',
      '1) Write ONE final answer — the best possible: take what is correct and useful from all answers, fix their errors, remove repetition. Write it directly to the user in Markdown; do not mention that you are a judge and do not refer to "answer 1/2".',
      `2) After the answer, on a separate line, write the marker ${JUDGE_MARKER} and then JSON:`,
      '{"agreement":"full|partial|low","consensus":["what the answers agree on, up to 5 items"],"disputes":[{"topic":"what they disagree on","positions":[{"model":"model name","claim":"what it states"}],"resolution":"who is right and why, or \\"could not determine\\""}]}',
      'A dispute is only a difference in substance (facts, numbers, conclusions, code), not in style. No disputes — empty list.',
    ].join('\n');
  }
  return [
    'Ты — судья в сервисе Ketner AI. На один вопрос пользователя ответили несколько нейросетей разных компаний.',
    '1) Напиши ОДИН итоговый ответ — лучший из возможных: возьми верное и полезное из всех ответов, исправь их ошибки, убери повторы. Пиши сразу пользователю в Markdown, не упоминай, что ты судья, и не ссылайся на «ответ 1/2».',
    `2) После ответа на отдельной строке напиши маркер ${JUDGE_MARKER} и после него JSON:`,
    '{"agreement":"full|partial|low","consensus":["в чём ответы сходятся, до 5 пунктов"],"disputes":[{"topic":"в чём расходятся","positions":[{"model":"имя модели","claim":"что утверждает"}],"resolution":"кто прав и почему, или «не удалось установить»"}]}',
    'Расхождение — только разница по существу (факты, цифры, выводы, код), а не в стиле. Нет расхождений — пустой список.',
  ].join('\n');
}

export function buildJudgeInput(
  question: string,
  answers: readonly JudgedAnswer[],
  language: Language,
): string {
  const q = clip(question.trim(), REVIEW_QUESTION_CHARS);
  const blocks = answers.map(
    (answer, index) =>
      `${language === 'en' ? 'Answer' : 'Ответ'} ${index + 1} — ${answer.modelName}:\n<answer>\n${clip(stripThinking(answer.content), JUDGE_ANSWER_CHARS)}\n</answer>`,
  );
  return language === 'en'
    ? `User question:\n<question>\n${q}\n</question>\n\n${blocks.join('\n\n')}`
    : `Вопрос пользователя:\n<question>\n${q}\n</question>\n\n${blocks.join('\n\n')}`;
}

/**
 * Делит поток судьи на итоговый ответ (уходит клиенту по мере генерации) и хвост с JSON после
 * маркера. Конец порции, похожий на начало маркера, придерживается до следующей порции, чтобы
 * маркер не просочился в ответ, разрезанный пополам.
 */
export class JudgeStreamSplitter {
  private pending = '';
  private tail = '';
  private found = false;
  private answer = '';

  /** Принимает порцию модели и возвращает текст, который можно показать. */
  push(delta: string): string {
    if (this.found) {
      this.tail += delta;
      return '';
    }
    const combined = this.pending + delta;
    const at = combined.indexOf(JUDGE_MARKER);
    if (at !== -1) {
      this.found = true;
      this.tail = combined.slice(at + JUDGE_MARKER.length);
      this.pending = '';
      return this.emit(combined.slice(0, at));
    }
    let keep = 0;
    for (let size = Math.min(JUDGE_MARKER.length - 1, combined.length); size > 0; size--) {
      if (JUDGE_MARKER.startsWith(combined.slice(combined.length - size))) {
        keep = size;
        break;
      }
    }
    this.pending = combined.slice(combined.length - keep);
    return this.emit(combined.slice(0, combined.length - keep));
  }

  /** Конец потока: придержанный остаток (если маркера так и не было) — часть ответа. */
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return this.emit(rest);
  }

  get content(): string {
    return this.answer.trim();
  }

  get tailText(): string {
    return this.tail;
  }

  private emit(value: string): string {
    this.answer += value;
    return value;
  }
}

export function parseJudgeTail(raw: string): ParsedJudgeTail {
  const json = extractJsonObject(raw);
  if (!json) return { agreement: 'unknown', consensus: [], disputes: [] };
  const agreementRaw = typeof json.agreement === 'string' ? json.agreement.toLowerCase() : '';
  const agreement: JudgeAgreement =
    agreementRaw === 'full' || agreementRaw === 'partial' || agreementRaw === 'low'
      ? agreementRaw
      : 'unknown';
  const consensus = Array.isArray(json.consensus)
    ? json.consensus
        .map((item) => cap(item, 400))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const disputes: JudgeDispute[] = [];
  if (Array.isArray(json.disputes)) {
    for (const item of json.disputes.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const topic = cap(record.topic, 400);
      if (!topic) continue;
      const positions = Array.isArray(record.positions)
        ? record.positions
            .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
            .map((p) => ({ model: cap(p.model, 80), claim: cap(p.claim, 600) }))
            .filter((p) => p.claim !== '')
            .slice(0, 4)
        : [];
      const resolution = cap(record.resolution, 800);
      disputes.push({ topic, positions, ...(resolution ? { resolution } : {}) });
    }
  }
  return { agreement, consensus, disputes };
}

export function judgeTemplate(answers: readonly JudgedAnswer[], language: Language): string {
  const best = answers[0];
  const excerpt = best ? stripThinking(best.content).slice(0, 600) : '';
  const tail = {
    agreement: 'partial',
    consensus: [
      text(
        language,
        'Демо-режим: модели не подключены, это пример итога.',
        'Demo mode: models are not connected, this is an example verdict.',
      ),
    ],
    disputes:
      answers.length >= 2
        ? [
            {
              topic: text(language, 'Пример расхождения', 'Example dispute'),
              positions: answers.slice(0, 2).map((answer) => ({
                model: answer.modelName,
                claim: text(language, 'утверждение из ответа', 'a claim from the answer'),
              })),
              resolution: text(language, 'не удалось установить', 'could not determine'),
            },
          ]
        : [],
  };
  const heading = text(language, '**Итог консилиума (демо)**', '**Consilium verdict (demo)**');
  return `${heading}\n\n${excerpt}\n\n${JUDGE_MARKER}\n${JSON.stringify(tail)}`;
}

// ─────────────────────────────────────────────────────────────
// Вызов рецензента через шлюз
// ─────────────────────────────────────────────────────────────

export interface ReviewCaller {
  userId: string;
  plan: PlanId;
  email?: string;
  isVip: boolean;
}

export interface ReviewTaskInput {
  gateway: Pick<AIGateway, 'stream'>;
  caller: ReviewCaller;
  candidates: readonly ReviewerCandidate[];
  reviewId: string;
  systemPrompt: string;
  userContent: string;
  templateOutput: string;
  language: Language;
  conversationId?: string;
  reasoningMode?: ReasoningMode;
  signal?: AbortSignal;
  /** Порции текста рецензента (нужны судье: итоговый ответ показывается по мере генерации). */
  onDelta?: (delta: string) => void;
  /** Рецензент выбран и начал работу (до первой порции): клиент показывает его имя. */
  onReviewer?: (reviewer: ReviewerInfo) => void;
}

export type ReviewTaskResult =
  | { ok: true; text: string; reviewer: ReviewerInfo; cancelled: boolean }
  | { ok: false; code: string; message: string };

/**
 * Ошибки, после которых пробуем следующего рецензента списка: модель недоступна по бюджету или
 * квоте тарифа, или все её провайдеры упали. Остальные (лимит частоты, параллельные запросы,
 * исчерпанный бюджет) одинаковы для любой модели, их показываем сразу.
 */
const RETRYABLE = new Set([
  'model_unavailable',
  'model_limit_reached',
  'upgrade_required',
  'provider_error',
]);

export async function runReviewTask(input: ReviewTaskInput): Promise<ReviewTaskResult> {
  let lastError: { code: string; message: string } = {
    code: 'review_unavailable',
    message: text(
      input.language,
      'Сейчас нет модели, которая может проверить ответ. Попробуйте позже.',
      'No model can review the answer right now. Try again later.',
    ),
  };
  let cancelled = false;
  for (const candidate of input.candidates) {
    if (input.signal?.aborted) break;
    const reviewer: ReviewerInfo = {
      modelId: candidate.entry.id,
      modelName: candidate.entry.name,
      developer: candidate.developer,
    };
    let output = '';
    let streamed = false;
    // Колбэки шлюза меняют состояние в замыканиях: объект, чтобы TypeScript не сужал тип до null.
    const outcome: { failure: { code: string; message: string } | null } = { failure: null };
    let finished = false;
    input.onReviewer?.(reviewer);
    await input.gateway.stream(
      {
        userId: input.caller.userId,
        userPlan: input.caller.plan,
        userEmail: input.caller.email,
        isVip: input.caller.isVip,
        isAnonymous: false,
        conversationId: input.conversationId ?? `review:${input.reviewId}`,
        modelId: candidate.entry.id,
        messages: [{ role: 'user', content: input.userContent }],
        language: input.language,
        stream: true,
        reasoningMode: input.reasoningMode ?? 'standard',
        signal: input.signal,
        strictModel: true,
        task: {
          kind: 'review',
          id: input.reviewId,
          systemPrompt: input.systemPrompt,
          templateOutput: input.templateOutput,
        },
      },
      {
        onDelta: (delta) => {
          streamed = true;
          output += delta;
          input.onDelta?.(delta);
        },
        onDone: (done) => {
          finished = true;
          cancelled = done.finishReason === 'cancelled';
          if (done.selectedModel) {
            reviewer.modelId = done.selectedModel.id;
            reviewer.modelName = done.selectedModel.name;
          }
        },
        onError: (error) => {
          outcome.failure = error;
        },
      },
      () => input.signal?.aborted ?? false,
    );
    if (finished && output.trim() !== '') {
      return { ok: true, text: output, reviewer, cancelled };
    }
    if (input.signal?.aborted) break;
    const error = outcome.failure;
    if (error) lastError = error;
    // Часть текста уже ушла клиенту: повтор с другой моделью склеил бы два разных ответа.
    if (streamed || (error && !RETRYABLE.has(error.code))) break;
  }
  if (input.signal?.aborted) {
    return {
      ok: false,
      code: 'cancelled',
      message: text(input.language, 'Проверка остановлена', 'Review stopped'),
    };
  }
  return { ok: false, ...lastError };
}
