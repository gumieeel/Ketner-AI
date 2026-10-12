import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRightIcon } from '@/components/icons';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

const FADE = 'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)';
const FADE_LEFT = 'linear-gradient(to right, transparent, black 48px)';
const FADE_RIGHT = 'linear-gradient(to right, black calc(100% - 48px), transparent)';

/**
 * Выбор стиля: «таблетки» в одну строку. Строка листается свайпом, колесом или стрелками по краям;
 * стрелка и затухание видны только с той стороны, где есть ещё стили.
 */
export function StylePicker({
  styles,
  value,
  onChange,
  disabled,
}: {
  styles: readonly string[];
  value: string;
  onChange: (style: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [update, styles.length]);

  // Выбранный стиль виден сразу, даже если он в конце строки.
  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !active) return;
    const left = active.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + active.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = left - 48;
    }
    update();
    // только при первом показе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollBy = (direction: 1 | -1): void => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy?.({ left: direction * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const mask = edges.left && edges.right ? FADE : edges.left ? FADE_LEFT : edges.right ? FADE_RIGHT : undefined;
  const arrow =
    'absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-stroke bg-surface text-text shadow-md transition-colors hover:bg-surface-2';

  return (
    <div className="relative">
      {edges.left ? (
        <button type="button" aria-label={t('images.style.prev')} onClick={() => scrollBy(-1)} className={cn(arrow, 'left-0')}>
          <ChevronRightIcon className="size-4 rotate-180" />
        </button>
      ) : null}
      <div
        ref={scroller}
        onScroll={update}
        className="flex gap-2 overflow-x-auto scroll-smooth py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {styles.map((id) => {
          const selected = id === value;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={(event) => {
                onChange(id);
                // Нажатый стиль выезжает в середину строки, чтобы не оставаться под стрелкой.
                event.currentTarget.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }}
              className={cn(
                'h-10 shrink-0 rounded-full border px-4 text-[14px] font-medium whitespace-nowrap transition-colors disabled:opacity-60',
                selected
                  ? 'border-accent/60 bg-accent-soft text-accent'
                  : 'border-stroke-strong bg-transparent text-text hover:border-accent/40 hover:bg-surface-2',
              )}
            >
              {t(`images.style.${id}` as TranslationKey)}
            </button>
          );
        })}
      </div>
      {edges.right ? (
        <button type="button" aria-label={t('images.style.next')} onClick={() => scrollBy(1)} className={cn(arrow, 'right-0')}>
          <ChevronRightIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
