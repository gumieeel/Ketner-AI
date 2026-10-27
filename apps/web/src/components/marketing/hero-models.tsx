import { useEffect, useState } from 'react';
import { ModelBrandIcon } from '@/components/icons/brands';
import { DEFAULT_MODELS } from '@/features/chat/model-catalog';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { GOOD_FOR } from '@/pages/landing/model-facts';

/** Пять семейств, которые обещает заголовок. Названия берутся из того же каталога, что и в чате. */
const IDS = [
  'claude-opus-5.5',
  'gpt-6-astra',
  'gemini-3.7-flash',
  'grok-4.7',
  'deepseek-v4.1-flash',
] as const;

const ROWS = IDS.map((id) => ({
  id,
  name: DEFAULT_MODELS.find((model) => model.id === id)?.name ?? id,
}));

const ROTATE_MS = 3200;
/** Высота строки в пикселях: по ней двигается точка на линии слева. */
const ROW_H = 53;

/**
 * Список моделей справа на первом экране. Подсвеченная строка каждые ~3 секунды
 * переходит к следующей — пока пользователь не навёл курсор или не поставил на строку фокус.
 * Под списком — одна строка о том, чем сильна выбранная модель.
 */
export function HeroModels({ className }: { className?: string }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduced || paused) return;
    const timer = window.setInterval(() => setActive((i) => (i + 1) % ROWS.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [reduced, paused]);

  const current = ROWS[active];
  const goodFor = GOOD_FOR[current.id];

  return (
    <div
      className={cn('model-rail pl-6', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="text-[14px] text-subtle" id="hero-models-label">
        {t('home.heroModelsLabel')}
      </p>
      <ul aria-labelledby="hero-models-label" className="relative mt-3 flex flex-col">
        <span
          aria-hidden="true"
          className="absolute top-[23px] -left-[27.5px] size-[7px] rounded-full bg-accent shadow-[0_0_10px_var(--arc-glow)] transition-transform duration-500 ease-[var(--ease-out-expo)]" // taste-skill-ignore: glow of the active point, from the reference
          style={{ transform: `translateY(${active * ROW_H}px)` }}
        />
        {ROWS.map((row, index) => {
          const isActive = index === active;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => setActive(index)}
                className={cn(
                  'group flex h-[53px] w-full items-center gap-4 rounded-full pr-4 text-left text-[15px] transition-colors duration-200',
                  isActive ? 'text-text' : 'text-muted hover:text-text',
                )}
              >
                <ModelBrandIcon
                  modelId={row.id}
                  className={cn(
                    'size-[30px] shrink-0 transition-colors duration-300',
                    isActive ? 'text-accent' : 'text-subtle group-hover:text-muted',
                  )}
                />
                <span className="whitespace-nowrap">{row.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p
        aria-live="polite"
        className="mt-4 min-h-[2.75rem] max-w-[24ch] text-[13px] leading-snug text-subtle"
      >
        {goodFor ? t(goodFor) : null}
      </p>
    </div>
  );
}
