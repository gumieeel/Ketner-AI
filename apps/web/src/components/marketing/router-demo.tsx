import { useEffect, useState } from 'react';
import { ModelMark } from '@/components/ui/model-mark';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { useInView } from '@/lib/use-in-view';
import { useReducedMotion } from '@/lib/use-reduced-motion';

type Phase = 'typing' | 'assessing' | 'routed';

interface Lane {
  modelId: string;
  name: string;
}

/** Модели, между которыми Auto выбирает на тарифах Pro и Ultra. */
const LANES: readonly Lane[] = [
  { modelId: 'ketner-mini', name: 'Ketner Mini' },
  { modelId: 'ketner-pro', name: 'Ketner Pro' },
  { modelId: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
];

interface Example {
  promptKey: TranslationKey;
  whyKey: TranslationKey;
  levelKey: TranslationKey;
  /** Сколько из трёх делений шкалы сложности заполнено. */
  level: 1 | 2 | 3;
  lane: number;
}

const EXAMPLES: readonly Example[] = [
  { promptKey: 'home.routerQ1', whyKey: 'home.routerWhy1', levelKey: 'home.routerLow', level: 1, lane: 0 },
  { promptKey: 'home.routerQ2', whyKey: 'home.routerWhy2', levelKey: 'home.routerMid', level: 2, lane: 1 },
  { promptKey: 'home.routerQ3', whyKey: 'home.routerWhy3', levelKey: 'home.routerHigh', level: 3, lane: 2 },
];

const TYPE_DELAY_MS = 22;
const ASSESS_MS = 1100;
const HOLD_MS = 4200;

/**
 * Демо режима Auto для главного экрана: запрос печатается, шкала сложности
 * «сканирует», затем подсвечивается модель, которой Auto отдаёт запрос.
 * Это единственная автоматическая анимация на странице. Пока блок не виден,
 * она стоит; при prefers-reduced-motion показывается итоговое состояние.
 * Человек может выбрать пример сам — тогда автопрокрутка останавливается.
 */
export function RouterDemo({ className }: { className?: string }) {
  const { t, language } = useTranslation();
  const reduced = useReducedMotion();
  const [viewRef, inView] = useInView<HTMLDivElement>({ once: false, threshold: 0.35 });
  const [index, setIndex] = useState(0);
  const [runId, setRunId] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [phase, setPhase] = useState<Phase>('routed');
  const [typed, setTyped] = useState(Number.MAX_SAFE_INTEGER);

  const example = EXAMPLES[index];
  const prompt = t(example.promptKey);

  useEffect(() => {
    if (reduced) {
      setPhase('routed');
      setTyped(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (!inView) {
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    void (async () => {
      setPhase('typing');
      setTyped(0);
      for (let i = 1; i <= prompt.length; i += 1) {
        await sleep(TYPE_DELAY_MS);
        if (cancelled) return;
        setTyped(i);
      }
      setPhase('assessing');
      await sleep(ASSESS_MS);
      if (cancelled) return;
      setPhase('routed');
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
    // prompt зависит от index и language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, runId, inView, reduced, language, autoplay]);

  const choose = (next: number) => {
    setAutoplay(false);
    setIndex(next);
    setRunId((current) => current + 1);
  };

  const routed = phase === 'routed';
  const assessing = phase === 'assessing';

  return (
    <div
      ref={viewRef}
      role="group"
      aria-label={t('home.routerTitle')}
      className={cn('flex h-full flex-col rounded-2xl border border-stroke bg-surface', className)}
    >
      <p className="sr-only">{t('home.routerSummary')}</p>

      <div className="flex items-center justify-between gap-3 border-b border-stroke px-5 py-4">
        <h2 className="text-[15px] font-medium text-text">{t('home.routerTitle')}</h2>
        <div className="flex items-center gap-1">
          {EXAMPLES.map((item, itemIndex) => {
            const selected = itemIndex === index;
            return (
              <button
                key={item.promptKey}
                type="button"
                aria-pressed={selected}
                aria-label={t('home.routerPick', { n: itemIndex + 1 })}
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

      {/* Запрос */}
      <div aria-hidden="true" className="flex flex-col gap-2 px-5 pt-5">
        <span className="text-[12px] text-subtle">{t('home.routerRequest')}</span>
        <p className="min-h-[4.2em] text-[19px] leading-snug text-text">
          {prompt.slice(0, typed)}
          {phase === 'typing' ? <span className="caret ml-0.5 !h-[1em] !w-[0.4em]" /> : null}
        </p>
      </div>

      {/* Сложность */}
      <div aria-hidden="true" className="flex items-center justify-between gap-3 px-5 pt-3 pb-5">
        <span className="text-[12px] text-subtle">{t('home.routerComplexity')}</span>
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            {[1, 2, 3].map((segment) => {
              const filled = routed && segment <= example.level;
              return (
                <span
                  key={segment}
                  className={cn(
                    'h-2 w-5 rounded-xs transition-colors duration-300',
                    filled ? 'bg-accent' : 'bg-surface-3',
                    assessing && 'status-pulse',
                  )}
                  style={{ animationDelay: assessing ? `${segment * 140}ms` : undefined }}
                />
              );
            })}
          </span>
          <span className="w-[6.5rem] text-right text-[13px] text-muted">
            {routed ? t(example.levelKey) : assessing ? t('home.routerAnalyzing') : ' '}
          </span>
        </span>
      </div>

      {/* Почему выбрана эта модель */}
      <div aria-hidden="true" className="mx-5 border-t border-dashed border-stroke-strong pt-4">
        <span className="text-[12px] text-subtle">{t('home.routerWhy')}</span>
        <p className="mt-1.5 min-h-[3em] text-[15px] leading-snug text-muted">
          {routed ? t(example.whyKey) : '\u00a0'}
        </p>
      </div>

      {/* Полосы моделей: выбранная заливается нефритом */}
      <div aria-hidden="true" className="mt-auto flex flex-col gap-1.5 border-t border-stroke p-3">
        <span className="px-2 pt-1 pb-1 text-[12px] text-subtle">{t('home.routerModel')}</span>
        {LANES.map((lane, laneIndex) => {
          const active = routed && laneIndex === example.lane;
          return (
            <div
              key={lane.modelId}
              className={cn(
                'flex min-h-12 items-center gap-3 rounded-md px-3 transition-[background-color,color] duration-300',
                active ? 'bg-brand-gradient text-accent-text' : 'text-muted',
              )}
            >
              <ModelMark
                modelId={lane.modelId}
                size="sm"
                className={cn('transition-opacity duration-300', !active && routed && 'opacity-60')}
              />
              <span className={cn('text-[14px] font-medium', active ? 'text-accent-text' : 'text-text')}>
                {lane.name}
              </span>
            </div>
          );
        })}
        <p className="px-2 pt-2 pb-1 text-[12px] text-subtle">{t('home.routerNote')}</p>
      </div>
    </div>
  );
}
