import { useEffect, useState } from 'react';
import { ModelMark } from '@/components/ui/model-mark';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { useInView } from '@/lib/use-in-view';
import { useReducedMotion } from '@/lib/use-reduced-motion';

type Phase = 'typing' | 'picking' | 'answering' | 'done';

/** Модели в переключателе демо — флагманы разных разработчиков. */
const MODELS: readonly { id: string; name: string }[] = [
  { id: 'claude-opus-5.5', name: 'Claude Opus 5.5' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'grok-4.7', name: 'Grok 4.7 xhigh' },
];

const EXAMPLES: readonly { promptKey: TranslationKey; answerKey: TranslationKey; model: number }[] = [
  { promptKey: 'home.demoQ1', answerKey: 'home.demoA1', model: 0 },
  { promptKey: 'home.demoQ2', answerKey: 'home.demoA2', model: 1 },
  { promptKey: 'home.demoQ3', answerKey: 'home.demoA3', model: 2 },
];

const TYPE_DELAY_MS = 22;
const PICK_MS = 700;
const WORD_DELAY_MS = 45;
const HOLD_MS = 4200;

/**
 * Демо главного экрана: в одной переписке запрос уходит выбранной модели и та отвечает.
 * Единственная автоматическая анимация на странице: стоит, пока блок не виден, а при
 * prefers-reduced-motion показывает итоговое состояние. Выбор примера останавливает автопрокрутку.
 */
export function ModelDemo({ className }: { className?: string }) {
  const { t, language } = useTranslation();
  const reduced = useReducedMotion();
  const [viewRef, inView] = useInView<HTMLDivElement>({ once: false, threshold: 0.35 });
  const [index, setIndex] = useState(0);
  const [runId, setRunId] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [phase, setPhase] = useState<Phase>('done');
  const [typed, setTyped] = useState(Number.MAX_SAFE_INTEGER);
  const [words, setWords] = useState(Number.MAX_SAFE_INTEGER);

  const example = EXAMPLES[index];
  const prompt = t(example.promptKey);
  const answer = t(example.answerKey);
  const answerWords = answer.split(' ');

  useEffect(() => {
    if (reduced) {
      setPhase('done');
      setTyped(Number.MAX_SAFE_INTEGER);
      setWords(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (!inView) return;

    let cancelled = false;
    const timers: number[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    void (async () => {
      setPhase('typing');
      setTyped(0);
      setWords(0);
      for (let i = 1; i <= prompt.length; i += 1) {
        await sleep(TYPE_DELAY_MS);
        if (cancelled) return;
        setTyped(i);
      }
      setPhase('picking');
      await sleep(PICK_MS);
      if (cancelled) return;
      setPhase('answering');
      for (let i = 1; i <= answerWords.length; i += 1) {
        await sleep(WORD_DELAY_MS);
        if (cancelled) return;
        setWords(i);
      }
      setPhase('done');
      if (autoplay) {
        await sleep(HOLD_MS);
        if (cancelled) return;
        setIndex((current) => (current + 1) % EXAMPLES.length);
      }
    })();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
    // prompt и answer зависят от index и language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, runId, inView, reduced, language, autoplay]);

  const choose = (next: number) => {
    setAutoplay(false);
    setIndex(next);
    setRunId((current) => current + 1);
  };

  const picked = phase !== 'typing';
  const model = MODELS[example.model];

  return (
    <div
      ref={viewRef}
      role="group"
      aria-label={t('home.demoTitle')}
      className={cn('flex h-full flex-col rounded-2xl border border-stroke bg-surface', className)}
    >
      <p className="sr-only">{t('home.demoSummary')}</p>

      <div className="flex items-center justify-between gap-3 border-b border-stroke px-5 py-4">
        <h2 className="text-[15px] font-medium text-text">{t('home.demoTitle')}</h2>
        <div className="flex items-center gap-1">
          {EXAMPLES.map((item, itemIndex) => {
            const selected = itemIndex === index;
            return (
              <button
                key={item.promptKey}
                type="button"
                aria-pressed={selected}
                aria-label={t('home.demoPick', { n: itemIndex + 1 })}
                onClick={() => choose(itemIndex)}
                className={cn(
                  'tabular grid size-8 place-items-center rounded-sm text-[13px] font-medium transition-colors duration-150 max-md:size-11',
                  selected ? 'bg-surface-3 text-text' : 'text-subtle hover:bg-surface-2 hover:text-text',
                )}
              >
                {itemIndex + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div aria-hidden="true" className="flex flex-col gap-2 px-5 pt-5">
        <span className="text-[12px] text-subtle">{t('home.demoRequest')}</span>
        <p className="min-h-[2.6em] text-[19px] leading-snug text-text">
          {prompt.slice(0, typed)}
          {phase === 'typing' ? <span className="caret ml-0.5 !h-[1em] !w-[0.4em]" /> : null}
        </p>
      </div>

      <div aria-hidden="true" className="mx-5 mt-4 border-t border-dashed border-stroke-strong pt-4">
        <span className="text-[12px] text-subtle">{t('home.demoAnswer')}</span>
        <p className="mt-1.5 min-h-[4.5em] text-[15px] leading-snug text-muted">
          {phase === 'answering' || phase === 'done' ? answerWords.slice(0, words).join(' ') : ' '}
          {phase === 'answering' ? <span className="caret ml-0.5 !h-[1em] !w-[0.4em]" /> : null}
        </p>
      </div>

      <div aria-hidden="true" className="mt-auto flex flex-col gap-1.5 border-t border-stroke p-3">
        <span className="px-2 pt-1 pb-1 text-[12px] text-subtle">{t('home.demoModel')}</span>
        {MODELS.map((item) => {
          const active = picked && item.id === model.id;
          return (
            <div
              key={item.id}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 transition-[background-color,color] duration-300',
                active ? 'bg-brand-gradient text-accent-text' : 'text-muted',
              )}
            >
              <ModelMark modelId={item.id} size="sm" />
              <span className={cn('text-[14px] font-medium', active ? 'text-accent-text' : 'text-text')}>
                {item.name}
              </span>
            </div>
          );
        })}
        <p className="px-2 pt-2 pb-1 text-[12px] text-subtle">{t('home.demoNote')}</p>
      </div>
    </div>
  );
}
