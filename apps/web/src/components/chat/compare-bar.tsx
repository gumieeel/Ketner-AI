import { useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon } from '@/components/icons';
import { ModelMark } from '@/components/ui/model-mark';
import { MODEL_NAME_KEYS } from '@/features/chat/model-catalog';
import { useCompare } from '@/features/chat/compare-store';
import type { ModelInfo } from '@/features/chat/types';
import { useCompareSelection } from '@/features/chat/use-compare-selection';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';

/** Полоса над полем ввода: какие модели ответят на следующий вопрос. */
export function CompareBar({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const setModelIds = useCompare((state) => state.setModelIds);
  const { ids, max, models } = useCompareSelection();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const labelOf = (model: ModelInfo): string => {
    const key = MODEL_NAME_KEYS[model.id];
    return (key ? t(key) : model.name).replace(/^✨\s*/, '');
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const selected = ids
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is ModelInfo => model !== undefined);
  const candidates = models.filter((model) => model.id !== 'auto' && !ids.includes(model.id));
  const full = ids.length >= max;

  return (
    <div
      ref={containerRef}
      className="relative mb-2 flex flex-wrap items-center gap-1.5 text-xs"
      data-testid="compare-bar"
    >
      <span className="font-semibold text-muted">{t('compare.barTitle')}:</span>
      {selected.map((model) => (
        <span
          key={model.id}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stroke bg-surface pr-1 pl-1.5 font-medium text-text"
        >
          <ModelMark modelId={model.id} size="sm" className="size-5 rounded-[6px]" />
          <span style={{ color: modelColor(model.id) }}>{labelOf(model)}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={t('compare.removeModel', { model: labelOf(model) })}
            onClick={() => setModelIds(ids.filter((id) => id !== model.id))}
            className="inline-flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            <CloseIcon className="size-3" />
          </button>
        </span>
      ))}

      <button
        type="button"
        disabled={disabled || full || candidates.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={full ? t('compare.planLimit', { count: max }) : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-stroke-strong px-2 font-medium text-muted transition-colors',
          'hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stroke-strong disabled:hover:text-muted',
        )}
      >
        <PlusIcon className="size-3.5" />
        {t('compare.addModel')}
      </button>

      {ids.length < 2 ? (
        <span role="status" className="text-warning">
          {t('compare.needTwo')}
        </span>
      ) : full ? (
        <span className="text-subtle">{t('compare.planLimit', { count: max })}</span>
      ) : null}

      {open ? (
        <ul
          role="listbox"
          aria-label={t('compare.addModel')}
          className="absolute bottom-full left-0 z-[var(--z-dropdown)] mb-2 max-h-72 w-[min(18rem,calc(100vw-2rem))] animate-scale-in overflow-y-auto rounded-lg border border-stroke-strong bg-surface-2 p-1.5 shadow-popover"
        >
          {candidates.length === 0 ? (
            <li className="px-2.5 py-2 text-subtle">{t('compare.noMoreModels')}</li>
          ) : (
            candidates.map((model) => (
              <li key={model.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    setModelIds([...ids, model.id].slice(0, max));
                    setOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-text transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
                >
                  <ModelMark modelId={model.id} size="sm" />
                  <span>{labelOf(model)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
