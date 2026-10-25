import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon, LockIcon, SparkleIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { ModelMark } from '@/components/ui/model-mark';
import { useAuth } from '@/features/auth/auth-store';
import {
  DEFAULT_MODELS,
  MODEL_NAME_KEYS,
  canAccessModel,
  planRank,
  requiredPlanOf,
} from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';

/** Модели по умолчанию: используются, пока каталог не загрузился. */
const FALLBACK_MODELS: readonly ModelInfo[] = DEFAULT_MODELS;

type ModelTier = 'free' | 'plus' | 'pro';

/** Группа списка определяется тарифом, с которого доступна модель (`requiredPlan` каталога). */
function tierOf(model: ModelInfo): ModelTier {
  const rank = planRank(requiredPlanOf(model));
  if (rank <= 0) {
    return 'free';
  }
  return rank === 1 ? 'plus' : 'pro';
}

export interface ModelPickerProps {
  disabled?: boolean;
  /** `pill` — кнопка в шапке; `chip` — компактная метка внутри поля ввода. */
  variant?: 'pill' | 'chip';
  /** Куда раскрывается список. Для поля ввода у нижнего края — вверх. */
  placement?: 'down' | 'up';
  /** Подпись кнопки для скринридеров, если на странице несколько переключателей. */
  ariaLabel?: string;
}

/** Переключатель моделей: логика ответа одна, меняется подпись и лимит контекста. */
export function ModelPicker({
  disabled = false,
  variant = 'pill',
  placement = 'down',
  ariaLabel,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const meta = useChat((state) => state.meta);
  const selectedId = usePreferences((state) => state.chatModelId);
  const setModelId = usePreferences((state) => state.setChatModelId);
  const user = useAuth((state) => state.user);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const models = meta && meta.models.length > 0 ? meta.models : FALLBACK_MODELS;
  const current = models.find((model) => model.id === selectedId) ?? models[0];

  const labelOf = (model: ModelInfo): string => {
    const key = MODEL_NAME_KEYS[model.id];
    return key ? t(key) : model.name;
  };

  const isFreeModel = (m: ModelInfo) => tierOf(m) === 'free';
  const isPlusModel = (m: ModelInfo) => tierOf(m) === 'plus';
  const isProModel = (m: ModelInfo) => tierOf(m) === 'pro';

  const autoModel = models.find((m) => m.id === 'auto');
  const freeModels = models.filter((m) => m.id !== 'auto' && isFreeModel(m));
  const plusModels = models.filter((m) => m.id !== 'auto' && isPlusModel(m));
  const proModels = models.filter((m) => m.id !== 'auto' && isProModel(m));

  const allModels: ModelInfo[] = [
    ...(autoModel ? [autoModel] : []),
    ...freeModels,
    ...plusModels,
    ...proModels,
  ];

  const openMenu = () => {
    setOpen(true);
    const idx = allModels.findIndex((m) => m.id === current.id);
    setFocusedIndex(idx >= 0 ? idx : 0);
  };

  useEffect(() => {
    if (open && focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);

  const onTriggerKeyDown = (event: ReactKeyboardEvent) => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      openMenu();
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % allModels.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + allModels.length) % allModels.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setFocusedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setFocusedIndex(allModels.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const renderModelItem = (model: ModelInfo) => {
    const active = model.id === current.id;
    const accessible = canAccessModel(user?.plan, model);
    const index = allModels.findIndex((m) => m.id === model.id);
    const isFocused = focusedIndex === index;
    const isPlus = isPlusModel(model);
    const isPro = isProModel(model);

    return (
      <li key={model.id} role="none">
        <button
          ref={(el) => {
            optionRefs.current[index] = el;
          }}
          type="button"
          role="option"
          tabIndex={isFocused && accessible ? 0 : -1}
          aria-selected={active}
          aria-disabled={!accessible}
          disabled={!accessible}
          onClick={() => {
            if (!accessible) {
              return;
            }
            setModelId(model.id);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none',
            'transition-[background-color,box-shadow] duration-150 max-md:min-h-14',
            active
              ? 'bg-accent-soft ring-1 ring-accent/30'
              : 'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40',
            isFocused && !active && accessible && 'bg-surface-2',
            !accessible &&
              'opacity-40 cursor-not-allowed hover:bg-transparent focus-visible:bg-transparent',
          )}
        >
          <ModelMark modelId={model.id} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'truncate text-sm',
                  active ? 'font-semibold text-text' : 'font-medium text-text',
                )}
              >
                {labelOf(model)}
              </span>
              {isPlus ? (
                <Badge tone="plus" className="px-2 py-0 text-[11px] leading-[18px]">
                  plus
                </Badge>
              ) : isPro ? (
                <Badge tone="pro" className="px-2 py-0 text-[11px] leading-[18px]">
                  pro
                </Badge>
              ) : null}
            </span>
          </span>
          <span className="flex size-5 shrink-0 items-center justify-center">
            {!accessible ? (
              <LockIcon className="size-3.5 text-subtle" aria-label={t('chat.modelLocked')} />
            ) : active ? (
              <CheckIcon className="size-4 text-accent" />
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  const renderGroup = (label: string, items: readonly ModelInfo[], withDivider: boolean) => (
    <div className={cn(withDivider && 'mt-1.5 border-t border-stroke pt-1.5')}>
      <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-subtle">{label}</div>
      <ul className="flex flex-col gap-0.5" role="none">
        {items.map(renderModelItem)}
      </ul>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={cn('min-w-0', variant === 'chip' ? 'relative' : 'md:relative')}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('chat.modelMenu')}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'group inline-flex max-w-full items-center rounded-full text-[14px] transition-[background-color,border-color,color] duration-200 disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'pill'
            ? 'h-10 gap-2 border border-stroke pr-3 pl-3.5 text-text hover:border-stroke-strong hover:bg-surface-2/70 max-md:h-11'
            : 'h-10 gap-1.5 pr-2.5 pl-3 text-muted hover:bg-surface-3/70 hover:text-text max-md:h-11',
          open &&
            (variant === 'pill'
              ? 'border-stroke-strong bg-surface-2/70'
              : 'bg-surface-3/70 text-text'),
        )}
      >
        {current.id === 'auto' ? (
          <SparkleIcon className="size-4 shrink-0 text-muted" />
        ) : (
          <ModelMark modelId={current.id} size="sm" />
        )}
        <span className={cn('truncate', variant === 'chip' && 'max-w-[9rem] max-sm:sr-only')}>
          {labelOf(current)}
        </span>
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-subtle transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('chat.modelMenu')}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={cn(
            'surface-glass bg-surface-2/95 absolute z-[var(--z-dropdown)] max-h-[min(70vh,520px)] overflow-y-auto',
            'rounded-2xl border border-stroke-strong p-1.5 shadow-popover animate-scale-in',
            variant === 'pill'
              ? 'inset-x-3 top-full mt-2 origin-top md:inset-x-auto md:left-0 md:w-[400px]'
              : cn(
                  'right-0 w-[min(400px,calc(100vw-2rem))]',
                  placement === 'up'
                    ? 'bottom-full mb-3 origin-bottom-right'
                    : 'top-full mt-3 origin-top-right',
                ),
          )}
        >
          {renderGroup(
            t('chat.tierFree'),
            [...(autoModel ? [autoModel] : []), ...freeModels],
            false,
          )}
          {plusModels.length > 0 ? renderGroup(t('chat.tierPlus'), plusModels, true) : null}
          {proModels.length > 0 ? renderGroup(t('chat.tierPro'), proModels, true) : null}

          <div className="mt-1.5 hidden items-center gap-3 border-t border-stroke px-2.5 pt-2 pb-1 text-xs text-subtle md:flex">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {t('chat.kbdNavigate')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Enter</Kbd>
              {t('chat.kbdSelect')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              {t('chat.kbdClose')}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
