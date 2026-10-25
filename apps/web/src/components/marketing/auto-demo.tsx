import { useEffect, useState } from 'react';
import { SparkleIcon } from '@/components/icons';
import { ModelMark } from '@/components/ui/model-mark';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';
import { useInView } from '@/lib/use-in-view';
import { useReducedMotion } from '@/lib/use-reduced-motion';

type ScenarioId = 'simple' | 'complex';
type Phase = 'typing' | 'routing' | 'answering' | 'done';

interface Scenario {
  id: ScenarioId;
  labelKey: TranslationKey;
  userKey: TranslationKey;
  answerKey: TranslationKey;
  /** Дополнительная строка ответа (появляется вместе с основным текстом). */
  extraKey?: TranslationKey;
  complexityKey: TranslationKey;
  reasonKey: TranslationKey;
  modelId: string;
  modelName: string;
  /** Сколько из трёх сегментов шкалы сложности заполнено. */
  level: 1 | 3;
  withCode: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'simple',
    labelKey: 'landing.demoSimple',
    userKey: 'landing.demoUserSimple',
    answerKey: 'landing.demoAnswerSimple',
    extraKey: 'landing.demoAnswerSimple2',
    complexityKey: 'landing.demoComplexityLow',
    reasonKey: 'landing.demoReasonSimple',
    modelId: 'ketner-mini',
    modelName: 'Ketner Mini',
    level: 1,
    withCode: false,
  },
  {
    id: 'complex',
    labelKey: 'landing.demoComplex',
    userKey: 'landing.demoUserComplex',
    answerKey: 'landing.demoAnswerComplex',
    complexityKey: 'landing.demoComplexityHigh',
    reasonKey: 'landing.demoReasonComplex',
    modelId: 'claude-fable',
    modelName: 'Claude Fable 5.1',
    level: 3,
    withCode: true,
  },
];

/** «Оркестр»: модели, из которых Auto выбирает. */
const ORCHESTRA: readonly { id: string; name: string }[] = [
  { id: 'ketner-mini', name: 'Ketner Mini' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek' },
  { id: 'gpt-6-astra', name: 'GPT-6' },
  { id: 'gemini-2.5-pro', name: 'Gemini' },
  { id: 'grok-4.7', name: 'Grok' },
  { id: 'claude-fable', name: 'Claude' },
];

const TYPE_DELAY_MS = 24;
const ROUTING_MS = 1500;
const WORD_DELAY_MS = 50;
const HOLD_MS = 5200;

function ComplexityMeter({ level, color, scanning }: { level: number; color: string; scanning: boolean }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[1, 2, 3].map((segment) => {
        const filled = !scanning && segment <= level;
        return (
          <span
            key={segment}
            className={cn(
              'h-1.5 w-6 rounded-full bg-stroke-strong transition-[background-color,opacity] duration-500 ease-out-expo',
              scanning && 'status-pulse',
            )}
            style={{
              backgroundColor: filled ? color : undefined,
              animationDelay: scanning ? `${segment * 160}ms` : undefined,
              transitionDelay: filled ? `${segment * 120}ms` : undefined,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Демо режима Auto: пример запроса печатается, Auto «взвешивает» его сложность и
 * подсвечивает модель в «оркестре». Простой вопрос уходит в лёгкую модель,
 * сложная задача — во флагман. Это иллюстрация, а не живой диалог.
 *
 * Анимация запускается, только пока блок виден, и не запускается вовсе при
 * prefers-reduced-motion: тогда показывается итоговое состояние сценария.
 */
export function AutoDemo({ className }: { className?: string }) {
  const { t, language } = useTranslation();
  const reduced = useReducedMotion();
  const [viewRef, inView] = useInView<HTMLDivElement>({ once: false, threshold: 0.3 });
  const [index, setIndex] = useState(0);
  const [runId, setRunId] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [phase, setPhase] = useState<Phase>('done');
  const [typed, setTyped] = useState(0);
  const [wordCount, setWordCount] = useState(0);

  const scenario = SCENARIOS[index];
  const userText = t(scenario.userKey);
  const answerText = t(scenario.answerKey);
  const answerWords = answerText.split(' ');
  const color = modelColor(scenario.modelId);

  useEffect(() => {
    if (reduced) {
      setPhase('done');
      setTyped(userText.length);
      setWordCount(answerWords.length);
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
      setWordCount(0);
      for (let i = 1; i <= userText.length; i += 1) {
        await sleep(TYPE_DELAY_MS);
        if (cancelled) return;
        setTyped(i);
      }
      await sleep(260);
      if (cancelled) return;
      setPhase('routing');
      await sleep(ROUTING_MS);
      if (cancelled) return;
      setPhase('answering');
      for (let i = 1; i <= answerWords.length; i += 1) {
        await sleep(WORD_DELAY_MS);
        if (cancelled) return;
        setWordCount(i);
      }
      setPhase('done');
      if (autoplay) {
        await sleep(HOLD_MS);
        if (cancelled) return;
        setIndex((current) => (current + 1) % SCENARIOS.length);
      }
    })();

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
    // answerWords и userText зависят от index и language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, runId, inView, reduced, language, autoplay]);

  const choose = (nextIndex: number) => {
    setAutoplay(false);
    setIndex(nextIndex);
    setRunId((current) => current + 1);
  };

  const routed = phase === 'answering' || phase === 'done';
  const showModel = routed;
  const visibleUser = userText.slice(0, typed);
  const visibleAnswer = answerWords.slice(0, wordCount).join(' ');

  return (
    <div ref={viewRef} role="group" aria-label={t('landing.demoLabel')} className={cn('relative w-full', className)}>
      <p className="sr-only">{t('landing.demoSummary')}</p>

      {/* Мягкое свечение за окном */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-6 -inset-y-8 -z-10 rounded-[40px] bg-brand-soft opacity-80 blur-3xl"
      />

      <div className="gradient-border surface-glass overflow-hidden rounded-xl shadow-xl">
        {/* Заголовок окна */}
        <div className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo-mark-160.png" alt="" className="size-5 object-contain" />
            <span className="text-sm font-semibold tracking-tight text-text">Ketner AI</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            <SparkleIcon className="size-3.5" />
            Auto
          </span>
        </div>

        {/* Диалог (декоративный: полный смысл — в sr-only описании выше) */}
        <div aria-hidden="true" className="flex h-[304px] flex-col gap-3 overflow-hidden px-4 py-4 sm:h-[348px]">
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md border border-stroke bg-surface-3 px-3.5 py-2.5 text-[13px] leading-relaxed text-text">
              {visibleUser}
              {phase === 'typing' ? <span className="caret ml-0.5 !h-[0.95rem]" /> : null}
            </div>
          </div>

          {phase !== 'typing' ? (
            <div className="msg-in flex items-center gap-3 rounded-xl border border-stroke bg-surface-2/80 px-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-accent-text shadow-glow">
                <SparkleIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                {routed ? (
                  <>
                    <div className="truncate text-xs font-semibold text-text">{t(scenario.complexityKey)}</div>
                    <div className="mt-0.5 text-xs leading-snug text-muted">{t(scenario.reasonKey)}</div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-medium text-text">
                    <span>{t('landing.demoRouting')}</span>
                    <span className="typing-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                )}
                <div className="mt-2">
                  <ComplexityMeter level={scenario.level} color={color} scanning={!routed} />
                </div>
              </div>
              {showModel ? (
                <span
                  className="msg-in inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold"
                  style={{
                    color,
                    borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
                    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                  }}
                >
                  <ModelMark modelId={scenario.modelId} size="sm" className="!size-5 !shadow-none !bg-transparent" />
                  <span className="max-sm:hidden">{scenario.modelName}</span>
                </span>
              ) : null}
            </div>
          ) : null}

          {routed ? (
            <div className="msg-in flex items-start gap-2.5">
              <ModelMark modelId={scenario.modelId} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                <div className="mb-0.5 text-xs font-semibold" style={{ color }}>
                  {scenario.modelName}
                </div>
                <p className="text-text/90">
                  {visibleAnswer}
                  {phase === 'answering' ? <span className="caret ml-0.5 !h-[0.95rem]" /> : null}
                </p>
                {scenario.extraKey && phase === 'done' ? (
                  <p className="msg-in mt-1.5 text-muted">{t(scenario.extraKey)}</p>
                ) : null}
                {scenario.withCode && phase === 'done' ? (
                  <pre className="msg-in mt-2 hidden overflow-hidden sm:block rounded-lg border border-stroke bg-canvas/70 p-2.5 font-mono text-[11px] leading-5 text-muted">
                    <code>
                      <span className="text-accent-3">useEffect</span>
                      {'(() => {\n  '}
                      <span className="text-accent-3">const</span>
                      {' t = '}
                      <span className="text-accent-2">setTimeout</span>
                      {'(update, delay);\n  '}
                      <span className="text-accent-3">return</span>
                      {' () => '}
                      <span className="text-accent-2">clearTimeout</span>
                      {'(t);\n}, [value]);'}
                    </code>
                  </pre>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* «Оркестр» моделей: выбранная подсвечивается цветом бренда */}
        <div aria-hidden="true" className="flex items-center justify-between gap-1 border-t border-stroke px-4 py-3">
          {ORCHESTRA.map((model) => {
            const active = routed && model.id === scenario.modelId;
            return (
              <span
                key={model.id}
                className={cn(
                  'flex flex-col items-center gap-1 transition-[opacity,transform] duration-500 ease-out-expo',
                  routed && !active ? 'opacity-35' : 'opacity-100',
                  active && '-translate-y-0.5',
                )}
              >
                <ModelMark
                  modelId={model.id}
                  size="md"
                  className={cn('transition-shadow duration-500', active && 'shadow-glow')}
                />
                <span className={cn('text-[11px] font-medium', active ? 'text-text' : 'text-subtle')}>
                  {model.name}
                </span>
              </span>
            );
          })}
        </div>

        {/* Ручной выбор сценария */}
        <div className="flex items-center gap-2 border-t border-stroke bg-surface-2/50 p-2.5">
          {SCENARIOS.map((item, itemIndex) => {
            const selected = itemIndex === index;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => choose(itemIndex)}
                className={cn(
                  'inline-flex min-h-10 flex-1 items-center justify-center rounded-lg px-3 text-[13px] font-medium max-md:min-h-11',
                  'transition-[background-color,color,box-shadow] duration-200',
                  selected
                    ? 'bg-surface text-text shadow-sm ring-1 ring-stroke-strong'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-subtle">{t('landing.demoNote')}</p>
    </div>
  );
}
