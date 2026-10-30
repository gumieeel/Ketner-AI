import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Answers, Question } from '@/features/discovery/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Лимит ответа — как на сервере (discovery/schemas.ts: ANSWER_MAX). */
const ANSWER_MAX = 2000;

interface Field {
  value: string;
  skipped: boolean;
}

export type FieldState = Record<string, Field>;

function fieldsFrom(questions: Question[], answers: Answers): FieldState {
  const fields: FieldState = {};
  for (const question of questions) {
    const answer = answers[question.id];
    fields[question.id] = {
      value: answer && 'value' in answer ? answer.value : '',
      skipped: Boolean(answer && 'skipped' in answer),
    };
  }
  return fields;
}

/** Ответы в форме API: пропуск — `{ skipped: true }`, пустое поле не отправляется. */
function answersFrom(fields: FieldState): Answers {
  const answers: Answers = {};
  for (const [id, field] of Object.entries(fields)) {
    if (field.skipped) answers[id] = { skipped: true };
    else if (field.value.trim()) answers[id] = { value: field.value.trim() };
  }
  return answers;
}

export interface QuestionsFormProps {
  questions: Question[];
  initial: Answers;
  submitLabel: string;
  submitting: boolean;
  /** Кнопка отправки недоступна (например, ответы не изменились). */
  submitDisabled?: (answers: Answers) => boolean;
  onChange?: (answers: Answers) => void;
  onSubmit: (answers: Answers) => void;
  /** Под вопросами, над кнопкой: цена, статус сохранения, подсказки. */
  footer?: (answers: Answers) => ReactNode;
  /** Вместо кнопки отправки (например, ссылка «Войти»). */
  action?: ReactNode;
  secondary?: ReactNode;
}

/**
 * Уточняющие вопросы: ответ текстом или вариантом, пропуск любого вопроса, правка до отправки.
 * Обязательный вопрос нужно либо заполнить, либо явно пропустить.
 */
export function QuestionsForm({
  questions,
  initial,
  submitLabel,
  submitting,
  submitDisabled,
  onChange,
  onSubmit,
  footer,
  action,
  secondary,
}: QuestionsFormProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<FieldState>(() => fieldsFrom(questions, initial));
  const [missing, setMissing] = useState<string[]>([]);
  const formId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const touched = useRef(false);

  const answers = answersFrom(fields);
  const serialized = JSON.stringify(answers);
  useEffect(() => {
    if (!touched.current) return;
    onChangeRef.current?.(JSON.parse(serialized) as Answers);
  }, [serialized]);

  const update = (id: string, change: Partial<Field>) => {
    touched.current = true;
    setFields((current) => ({ ...current, [id]: { ...current[id], ...change } }));
    setMissing((current) => current.filter((item) => item !== id));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const unanswered = questions
      .filter((question) => !question.optional)
      .filter((question) => !fields[question.id]?.skipped && !fields[question.id]?.value.trim())
      .map((question) => question.id);
    if (unanswered.length > 0) {
      setMissing(unanswered);
      document.getElementById(`${formId}-${unanswered[0]}`)?.focus();
      return;
    }
    onSubmit(answers);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <ol className="flex flex-col gap-6">
        {questions.map((question, index) => (
          <QuestionField
            key={question.id}
            id={`${formId}-${question.id}`}
            number={index + 1}
            question={question}
            field={fields[question.id] ?? { value: '', skipped: false }}
            missing={missing.includes(question.id)}
            onChange={(change) => update(question.id, change)}
          />
        ))}
      </ol>
      {footer?.(answers)}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {secondary}
        {action ?? (
          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || (submitDisabled?.(answers) ?? false)}
            className="max-sm:w-full"
          >
            {submitLabel}
          </Button>
        )}
      </div>
      {missing.length > 0 ? (
        <span className="sr-only">{t('analysis.questions.needAnswer')}</span>
      ) : null}
    </form>
  );
}

function QuestionField({
  id,
  number,
  question,
  field,
  missing,
  onChange,
}: {
  id: string;
  number: number;
  question: Question;
  field: Field;
  missing: boolean;
  onChange: (change: Partial<Field>) => void;
}) {
  const { t } = useTranslation();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const options = question.kind === 'choice' ? (question.options ?? []) : [];
  const isOption = options.includes(field.value);
  const [custom, setCustom] = useState(() => Boolean(field.value) && !isOption);
  const describedBy = [question.reason ? hintId : null, missing ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const header = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-[15px] leading-6 font-medium text-text">
        <span className="text-subtle">{number}. </span>
        {question.text}
      </span>
      {question.optional ? (
        <span className="text-[13px] text-subtle">{t('analysis.questions.optional')}</span>
      ) : null}
    </div>
  );

  return (
    <li className="flex flex-col gap-2">
      {options.length > 0 ? (
        <fieldset aria-describedby={describedBy || undefined} disabled={field.skipped}>
          <legend className="mb-2">{header}</legend>
          {question.reason ? (
            <p id={hintId} className="mb-2 text-[13px] leading-5 text-subtle">
              {t('analysis.questions.why', { reason: question.reason })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {options.map((option, index) => (
              <label
                key={option}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] transition-colors',
                  !custom && field.value === option
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-stroke text-muted hover:border-stroke-strong hover:text-text',
                  field.skipped && 'cursor-default opacity-50',
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={id}
                  id={index === 0 ? id : undefined}
                  checked={!custom && field.value === option}
                  onChange={() => {
                    setCustom(false);
                    onChange({ value: option });
                  }}
                />
                {option}
              </label>
            ))}
            <label
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] transition-colors',
                custom
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-stroke text-muted hover:border-stroke-strong hover:text-text',
                field.skipped && 'cursor-default opacity-50',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={id}
                checked={custom}
                onChange={() => {
                  setCustom(true);
                  onChange({ value: isOption ? '' : field.value });
                }}
              />
              {t('analysis.questions.other')}
            </label>
          </div>
          {custom && !field.skipped ? (
            <AnswerText
              id={`${id}-custom`}
              label={t('analysis.questions.other')}
              value={field.value}
              onChange={(value) => onChange({ value })}
            />
          ) : null}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id}>{header}</label>
          {question.reason ? (
            <p id={hintId} className="text-[13px] leading-5 text-subtle">
              {t('analysis.questions.why', { reason: question.reason })}
            </p>
          ) : null}
          {field.skipped ? null : (
            <AnswerText
              id={id}
              value={field.value}
              describedBy={describedBy}
              invalid={missing}
              onChange={(value) => onChange({ value })}
            />
          )}
        </>
      )}

      {missing ? (
        <p id={errorId} className="text-[13px] text-danger">
          {t('analysis.questions.needAnswer')}
        </p>
      ) : null}

      <div className="flex items-center gap-3 text-[13px]">
        {field.skipped ? (
          <>
            <span className="text-subtle">{t('analysis.questions.skipped')}</span>
            <button
              type="button"
              className="min-h-11 font-medium text-muted underline underline-offset-4 hover:text-text md:min-h-0"
              onClick={() => onChange({ skipped: false })}
            >
              {t('analysis.questions.unskip')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="min-h-11 text-muted underline underline-offset-4 hover:text-text md:min-h-0"
            onClick={() => onChange({ skipped: true })}
            aria-label={`${t('analysis.questions.skip')}: ${question.text}`}
          >
            {t('analysis.questions.skip')}
          </button>
        )}
      </div>
    </li>
  );
}

function AnswerText({
  id,
  label,
  value,
  describedBy,
  invalid,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  describedBy?: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <textarea
      id={id}
      aria-label={label}
      aria-describedby={describedBy || undefined}
      aria-invalid={invalid || undefined}
      value={value}
      maxLength={ANSWER_MAX}
      rows={2}
      placeholder={t('analysis.questions.placeholder')}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'mt-1 block min-h-[4.5rem] w-full resize-y rounded-xl border bg-surface px-4 py-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        invalid ? 'border-danger/60' : 'border-stroke',
      )}
    />
  );
}
