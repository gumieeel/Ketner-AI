import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  continueAnalysis,
  saveAnswersDraft,
  type AnalysisView,
  type AnswerRecord,
  type Answers,
  type Question,
} from '@/features/discovery/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from './error-notice';

/** Лимит ответа — как на сервере (discovery/schemas.ts: ANSWER_MAX). */
const ANSWER_MAX = 2000;
const SAVE_DELAY_MS = 800;

const answered = (record: AnswerRecord | undefined): boolean =>
  Boolean(record && ('skipped' in record || record.value.trim()));

/** Первый вопрос без ответа; все отвечены — `questions.length` (шаг «Показать результат»). */
function firstOpen(questions: Question[], answers: Answers): number {
  const index = questions.findIndex((question) => !answered(answers[question.id]));
  return index === -1 ? questions.length : index;
}

/**
 * Уточнения в виде разговора: Ketner задаёт вопросы по одному, у каждого — понятная цель и
 * готовые варианты. Не чат: свободных реплик нет, каждый шаг — ответ на конкретный вопрос.
 * Ответы сохраняются черновиком (переживают перезагрузку); после последнего вопроса человек
 * сам нажимает «Показать результат» — до этого любой ответ можно изменить.
 */
export function DiscoveryConversation({
  analysis,
  onDone,
}: {
  analysis: AnalysisView;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { questions } = analysis;
  const [answers, setAnswers] = useState<Answers>(analysis.answers);
  const [current, setCurrent] = useState(() => firstOpen(questions, analysis.answers));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<Answers | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  const flush = async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      await saveAnswersDraft(analysis.id, next);
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  };

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  // Новый вопрос — фокус на нём: так разговор удобно вести с клавиатуры и скринридера.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    stepRef.current?.focus({ preventScroll: true });
    stepRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [current]);

  const answer = (question: Question, record: AnswerRecord) => {
    const next = { ...answers, [question.id]: record };
    setAnswers(next);
    setError(null);
    pending.current = next;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    setCurrent(nextAfter(next));
  };

  /** После ответа — следующий вопрос без ответа (вперёд от текущего, потом сначала). */
  const nextAfter = (next: Answers): number => {
    for (let index = current + 1; index < questions.length; index += 1) {
      if (!answered(next[questions[index].id])) return index;
    }
    return firstOpen(questions, next);
  };

  const finish = () => {
    if (timer.current) window.clearTimeout(timer.current);
    pending.current = null;
    setSubmitting(true);
    setError(null);
    continueAnalysis(analysis.id, answers)
      .then(onDone)
      .catch((caught: unknown) => {
        setError(caught);
        setSubmitting(false);
      });
  };

  const done = questions.filter((question) => answered(answers[question.id])).length;
  const intro = analysis.context?.intro?.trim() || t('analysis.chat.introFallback');

  return (
    <section aria-labelledby="conversation-title" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="conversation-title"
          className="text-[20px] font-medium tracking-[-0.01em] text-text"
        >
          {t('analysis.chat.title')}
        </h2>
        <Progress done={done} total={questions.length} />
      </div>

      <ol className="mt-6 flex flex-col gap-5" aria-label={t('analysis.chat.transcript')}>
        <KetnerLine>{intro}</KetnerLine>

        {questions.map((question, index) => {
          const record = answers[question.id];
          if (index === current) return null;
          if (!answered(record)) return null;
          return (
            <li key={question.id} className="flex flex-col gap-2">
              <KetnerBubble>{question.text}</KetnerBubble>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="min-h-11 text-[13px] text-subtle underline underline-offset-4 hover:text-text md:min-h-0"
                  onClick={() => setCurrent(index)}
                  aria-label={`${t('analysis.chat.change')}: ${question.text}`}
                >
                  {t('analysis.chat.change')}
                </button>
                <UserBubble muted={record !== undefined && 'skipped' in record}>
                  {record && 'value' in record ? record.value : t('analysis.chat.skipped')}
                </UserBubble>
              </div>
            </li>
          );
        })}
      </ol>

      <div ref={stepRef} tabIndex={-1} className="mt-5 focus:outline-none">
        {current < questions.length ? (
          <QuestionStep
            key={questions[current].id}
            question={questions[current]}
            number={current + 1}
            total={questions.length}
            initial={answers[questions[current].id]}
            onAnswer={(record) => answer(questions[current], record)}
          />
        ) : (
          <div className="rounded-xl border border-accent/30 bg-accent-soft/40 px-5 py-4">
            <p className="text-[15px] leading-6 text-text">{t('analysis.chat.ready')}</p>
            <Button className="mt-4 max-sm:w-full" loading={submitting} onClick={finish}>
              {t('analysis.chat.showResult')}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {saveFailed ? (
          <p className="text-[13px] text-subtle">{t('analysis.questions.saveFailed')}</p>
        ) : null}
        {error ? <ErrorNotice error={error} redirect={`/analyses/${analysis.id}`} /> : null}
      </div>
    </section>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3 text-[13px] text-subtle">
      <span>{t('analysis.chat.progress', { done, total })}</span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={t('analysis.chat.progressLabel')}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"
      >
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  );
}

function KetnerLine({ children }: { children: ReactNode }) {
  return (
    <li>
      <KetnerBubble>{children}</KetnerBubble>
    </li>
  );
}

function KetnerBubble({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[36rem] gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-text text-[12px] font-semibold text-canvas"
      >
        K
      </span>
      <p className="text-[15px] leading-6 text-text">
        <span className="sr-only">{t('analysis.chat.ketner')}: </span>
        {children}
      </p>
    </div>
  );
}

function UserBubble({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const { t } = useTranslation();
  return (
    <p
      className={cn(
        'max-w-[28rem] rounded-2xl rounded-br-md px-4 py-2 text-[15px] leading-6 break-words whitespace-pre-wrap',
        muted ? 'border border-stroke text-subtle' : 'bg-surface-2 text-text',
      )}
    >
      <span className="sr-only">{t('analysis.chat.you')}: </span>
      {children}
    </p>
  );
}

function QuestionStep({
  question,
  number,
  total,
  initial,
  onAnswer,
}: {
  question: Question;
  number: number;
  total: number;
  initial: AnswerRecord | undefined;
  onAnswer: (record: AnswerRecord) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const options = question.kind === 'choice' ? (question.options ?? []) : [];
  const initialValue = initial && 'value' in initial ? initial.value : '';
  const [custom, setCustom] = useState(
    options.length === 0 || (initialValue !== '' && !options.includes(initialValue)),
  );
  const [value, setValue] = useState(options.includes(initialValue) ? '' : initialValue);
  const textId = `${id}-text`;

  const submitText = () => {
    if (value.trim()) onAnswer({ value: value.trim() });
  };

  return (
    <div className="flex flex-col gap-3">
      <KetnerBubble>
        <span className="font-medium">{question.text}</span>
      </KetnerBubble>
      <div className="flex flex-col gap-3 pl-10">
        <p className="text-[13px] leading-5 text-subtle">
          {t('analysis.chat.step', { number, total })}
          {question.reason ? ` · ${t('analysis.questions.why', { reason: question.reason })}` : ''}
        </p>

        {options.length > 0 ? (
          <div role="group" aria-label={question.text} className="flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={initialValue === option}
                onClick={() => onAnswer({ value: option })}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] transition-colors',
                  initialValue === option
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-stroke text-text hover:border-stroke-strong hover:bg-surface-2',
                )}
              >
                {option}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={custom}
              aria-controls={textId}
              onClick={() => setCustom(true)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] transition-colors',
                custom
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-stroke text-muted hover:border-stroke-strong hover:text-text',
              )}
            >
              {t('analysis.questions.other')}
            </button>
          </div>
        ) : null}

        {custom ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              submitText();
            }}
          >
            <label htmlFor={textId} className="sr-only">
              {question.text}
            </label>
            <textarea
              id={textId}
              value={value}
              maxLength={ANSWER_MAX}
              rows={2}
              autoFocus={options.length > 0}
              placeholder={t('analysis.questions.placeholder')}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitText();
                }
              }}
              className="block min-h-[3.25rem] w-full resize-y rounded-xl border border-stroke bg-surface px-4 py-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            <Button type="submit" disabled={!value.trim()} className="shrink-0 max-sm:w-full">
              {t('analysis.chat.next')}
            </Button>
          </form>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() => onAnswer({ skipped: true })}
            className="min-h-11 text-[13px] text-muted underline underline-offset-4 hover:text-text md:min-h-0"
          >
            {question.optional ? t('analysis.questions.skip') : t('analysis.chat.dontKnow')}
          </button>
        </div>
      </div>
    </div>
  );
}
