import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DiscoveryApiError, newIdempotencyKey } from '@/features/discovery/api';
import {
  listMaterials,
  quoteRun,
  startRun,
  type MaterialSummary,
  type QuizFormat,
  type RunQuote,
  type StudyOperation,
  type StudyRunInput,
} from '@/features/study/api';
import { MATERIAL_LIMITS } from '@/features/study/extract';
import { OPERATION_LABEL } from '@/features/study/labels';
import { useTranslation, type TranslationKey } from '@/i18n';
import { ErrorNotice } from '@/pages/analysis/error-notice';

const OPERATIONS: ReadonlyArray<{
  id: StudyOperation;
  label: TranslationKey;
  hint: TranslationKey;
}> = [
  { id: 'notes', label: 'study.operation.notes', hint: 'study.operation.notesHint' },
  { id: 'table', label: 'study.operation.table', hint: 'study.operation.tableHint' },
  { id: 'quiz', label: 'study.operation.quiz', hint: 'study.operation.quizHint' },
  { id: 'self_check', label: 'study.operation.self_check', hint: 'study.operation.selfCheckHint' },
];

const QUIZ_COUNTS = [5, 8, 10, 15] as const;
const SELF_CHECK_COUNTS = [3, 5, 8] as const;
const FORMATS: ReadonlyArray<{ id: QuizFormat; label: TranslationKey }> = [
  { id: 'mixed', label: 'study.create.formatMixed' },
  { id: 'choice', label: 'study.create.formatChoice' },
  { id: 'open', label: 'study.create.formatOpen' },
];

const FOCUS_PLACEHOLDER: Record<StudyOperation, TranslationKey> = {
  notes: 'study.create.focusNotes',
  table: 'study.create.focusTable',
  quiz: 'study.create.focusQuiz',
  self_check: 'study.create.focusNotes',
};

/** Выбор частей документа: все или конкретные. */
type Selection = Record<string, { sections: string[] | null }>;

export function CreatePanel({
  solutionId,
  defaultSubject,
  materialsVersion,
}: {
  solutionId: string;
  defaultSubject: string;
  /** Меняется, когда документы добавили или удалили. */
  materialsVersion: number;
}) {
  const translator = useTranslation();
  const { t, language } = translator;
  const navigate = useNavigate();
  const subjectId = useId();
  const focusId = useId();
  const countId = useId();
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [operation, setOperation] = useState<StudyOperation>('notes');
  const [subject, setSubject] = useState(defaultSubject);
  const [focus, setFocus] = useState('');
  const [topic, setTopic] = useState('');
  const [quizCount, setQuizCount] = useState<number>(8);
  const [selfCheckCount, setSelfCheckCount] = useState<number>(5);
  const [format, setFormat] = useState<QuizFormat>('mixed');
  const [selection, setSelection] = useState<Selection>({});
  const [quote, setQuote] = useState<RunQuote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Один ключ на одно намерение запустить: повтор после сбоя сети не запустит второй раз.
  const keyRef = useRef(newIdempotencyKey());
  const number = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');

  useEffect(() => {
    let alive = true;
    listMaterials(solutionId).then(
      (result) => {
        if (!alive) return;
        setMaterials(result.materials);
        // Удалённые документы пропадают из выбора.
        setSelection((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => result.materials.some((m) => m.id === id)),
          ),
        );
      },
      (caught: unknown) => alive && setError(caught),
    );
    return () => {
      alive = false;
    };
  }, [solutionId, materialsVersion]);

  const input: StudyRunInput | null = useMemo(() => {
    const chosen = Object.entries(selection).map(([id, value]) =>
      value.sections ? { id, sections: value.sections } : { id },
    );
    if (!subject.trim() || chosen.length === 0) return null;
    if (chosen.some((item) => 'sections' in item && item.sections?.length === 0)) return null;
    const base = { subject: subject.trim(), materials: chosen };
    // Вход — ровно тот, что ждёт операция: лишние поля сервер отклоняет.
    if (operation === 'self_check') {
      if (!topic.trim()) return null;
      return { ...base, topic: topic.trim(), count: selfCheckCount };
    }
    if (operation === 'quiz') return { ...base, focus: focus.trim(), count: quizCount, format };
    return { ...base, focus: focus.trim() };
  }, [selection, subject, focus, topic, operation, quizCount, selfCheckCount, format]);

  const selectedChars = materials.reduce((sum, material) => {
    const choice = selection[material.id];
    if (!choice) return sum;
    return (
      sum +
      material.sections
        .filter((section) => !choice.sections || choice.sections.includes(section.id))
        .reduce((total, section) => total + section.chars, 0)
    );
  }, 0);
  const tooMuch = selectedChars > MATERIAL_LIMITS.runChars;
  const tooManyDocs = Object.keys(selection).length > MATERIAL_LIMITS.runMaterials;

  // Цена — по каждому изменению выбора (с паузой), до нажатия кнопки.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    keyRef.current = newIdempotencyKey();
    if (!input || tooMuch || tooManyDocs) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      quoteRun(solutionId, operation, input).then(
        (next) => alive && setQuote(next),
        (caught: unknown) => alive && setQuoteError(caught),
      );
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [solutionId, operation, input, tooMuch, tooManyDocs]);

  const launch = async (accepted: RunQuote, confirm: boolean) => {
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const run = await startRun(solutionId, {
        operation,
        input,
        idempotencyKey: keyRef.current,
        acceptedMaxCredits: accepted.maxCredits,
        ...(confirm ? { confirm: true } : {}),
      });
      navigate(`/solutions/${solutionId}/runs/${run.id}`);
    } catch (caught) {
      const fresh =
        caught instanceof DiscoveryApiError && caught.code === 'confirmation_required'
          ? (caught.details.quote as RunQuote | undefined)
          : undefined;
      if (fresh) {
        // Цена изменилась: показать новую и спросить ещё раз.
        setQuote(fresh);
        setConfirming(true);
      } else {
        setError(caught);
      }
      setBusy(false);
    }
  };

  const toggleMaterial = (id: string, on: boolean) =>
    setSelection((current) => {
      const next = { ...current };
      if (on) next[id] = { sections: null };
      else delete next[id];
      return next;
    });
  const toggleSection = (material: MaterialSummary, sectionId: string, on: boolean) =>
    setSelection((current) => {
      const all = material.sections.map((section) => section.id);
      const chosen = new Set(current[material.id]?.sections ?? all);
      if (on) chosen.add(sectionId);
      else chosen.delete(sectionId);
      const sections = all.filter((id) => chosen.has(id));
      return {
        ...current,
        [material.id]: { sections: sections.length === all.length ? null : sections },
      };
    });

  const operationLabel = t(OPERATION_LABEL[operation]);
  const count = operation === 'quiz' ? quizCount : selfCheckCount;
  const setCount = operation === 'quiz' ? setQuizCount : setSelfCheckCount;
  const counts = operation === 'quiz' ? QUIZ_COUNTS : SELF_CHECK_COUNTS;

  return (
    <section aria-labelledby="create-title" className="mt-10 border-t border-stroke pt-8">
      <h2 id="create-title" className="text-[20px] font-medium tracking-[-0.01em] text-text">
        {t('study.create.title')}
      </h2>

      {materials.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">{t('study.create.noMaterials')}</p>
      ) : (
        <form
          className="mt-5 flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!quote) return;
            if (quote.confirmationRequired) setConfirming(true);
            else void launch(quote, false);
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[14px] font-medium text-text">
              {t('study.create.operation')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {OPERATIONS.map((item) => (
                <label
                  key={item.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-4 ${
                    operation === item.id ? 'border-accent bg-surface-2' : 'border-stroke'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[15px] font-medium text-text">
                    <input
                      type="radio"
                      name="operation"
                      value={item.id}
                      checked={operation === item.id}
                      onChange={() => setOperation(item.id)}
                    />
                    {t(item.label)}
                  </span>
                  <span className="text-[13px] leading-5 text-muted">{t(item.hint)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label
              htmlFor={subjectId}
              className="flex flex-col gap-1 text-[14px] font-medium text-text"
            >
              {t('study.create.subject')}
              <input
                id={subjectId}
                value={subject}
                maxLength={MATERIAL_LIMITS.subjectChars}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t('study.create.subjectPlaceholder')}
                className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] font-normal text-text"
              />
            </label>
            {operation === 'self_check' ? (
              <label
                htmlFor={focusId}
                className="flex flex-col gap-1 text-[14px] font-medium text-text"
              >
                {t('study.create.topic')}
                <input
                  id={focusId}
                  value={topic}
                  maxLength={120}
                  required
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder={t('study.create.topicPlaceholder')}
                  className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] font-normal text-text"
                />
              </label>
            ) : (
              <label
                htmlFor={focusId}
                className="flex flex-col gap-1 text-[14px] font-medium text-text"
              >
                {t('study.create.focus')}
                <input
                  id={focusId}
                  value={focus}
                  maxLength={MATERIAL_LIMITS.focusChars}
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder={t(FOCUS_PLACEHOLDER[operation])}
                  className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] font-normal text-text"
                />
              </label>
            )}
          </div>

          {operation === 'quiz' || operation === 'self_check' ? (
            <div className="flex flex-wrap items-end gap-6">
              <label
                htmlFor={countId}
                className="flex flex-col gap-1 text-[14px] font-medium text-text"
              >
                {t('study.create.count')}
                <select
                  id={countId}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] font-normal text-text"
                >
                  {counts.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {operation === 'quiz' ? (
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-[14px] font-medium text-text">
                    {t('study.create.format')}
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {FORMATS.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-2 text-[14px] text-text"
                      >
                        <input
                          type="radio"
                          name="quiz-format"
                          value={item.id}
                          checked={format === item.id}
                          onChange={() => setFormat(item.id)}
                        />
                        {t(item.label)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-[14px] font-medium text-text">
              {t('study.create.materials')}
            </legend>
            <ul className="flex flex-col gap-2">
              {materials.map((material) => {
                const choice = selection[material.id];
                return (
                  <li key={material.id} className="rounded-xl border border-stroke p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-[14px] text-text">
                      <input
                        type="checkbox"
                        checked={Boolean(choice)}
                        onChange={(event) => toggleMaterial(material.id, event.target.checked)}
                      />
                      <span className="min-w-0 truncate">{material.name}</span>
                      <span className="shrink-0 text-[12px] text-subtle">
                        {t('study.create.parts', {
                          chosen: number(choice?.sections?.length ?? material.sections.length),
                          total: number(material.sections.length),
                        })}
                      </span>
                    </label>
                    {choice && material.sections.length > 1 ? (
                      <details className="mt-2 pl-6">
                        <summary className="cursor-pointer text-[13px] text-muted">
                          {t('study.create.chooseParts')}
                        </summary>
                        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                          {material.sections.map((section) => (
                            <label
                              key={section.id}
                              className="flex items-center gap-2 text-[13px] text-text"
                            >
                              <input
                                type="checkbox"
                                checked={!choice.sections || choice.sections.includes(section.id)}
                                onChange={(event) =>
                                  toggleSection(material, section.id, event.target.checked)
                                }
                              />
                              <span className="truncate">{section.label}</span>
                              <span className="text-subtle">{number(section.chars)}</span>
                            </label>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className={`mt-2 text-[13px] ${tooMuch ? 'text-danger' : 'text-subtle'}`}>
              {t('study.create.chars', {
                chars: number(selectedChars),
                max: number(MATERIAL_LIMITS.runChars),
              })}
              {tooMuch ? ` ${t('study.create.tooMuch')}` : ''}
              {tooManyDocs
                ? ` ${t('study.create.tooManyDocs', { max: MATERIAL_LIMITS.runMaterials })}`
                : ''}
            </p>
          </fieldset>

          <div className="flex flex-col gap-2">
            <p className="text-[14px] text-muted" aria-live="polite">
              {quote
                ? t('study.create.price', {
                    typical: quote.typicalCredits,
                    max: quote.maxCredits,
                    model: quote.model,
                  })
                : input && !tooMuch && !tooManyDocs
                  ? t('study.create.pricing')
                  : t('study.create.chooseFirst')}
            </p>
            {quoteError ? (
              <ErrorNotice error={quoteError} redirect={`/solutions/${solutionId}`} />
            ) : null}
            <div>
              <Button type="submit" disabled={!quote || busy} loading={busy}>
                {quote
                  ? t('study.create.start', { operation: operationLabel, max: quote.maxCredits })
                  : t('study.create.startDisabled', { operation: operationLabel })}
              </Button>
            </div>
            {error ? <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} /> : null}
          </div>
        </form>
      )}

      {confirming && quote ? (
        <Modal labelledBy="confirm-run-title" size="sm" onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-6">
            <h2 id="confirm-run-title" className="text-[18px] font-medium text-text">
              {t('study.create.confirmTitle')}
            </h2>
            <p className="text-[14px] leading-6 text-muted">
              {t('study.create.price', {
                typical: quote.typicalCredits,
                max: quote.maxCredits,
                model: quote.model,
              })}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('analysis.new.cancel')}
              </Button>
              <Button
                loading={busy}
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void launch(quote, true);
                }}
              >
                {t('study.create.confirmButton', { max: quote.maxCredits })}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
