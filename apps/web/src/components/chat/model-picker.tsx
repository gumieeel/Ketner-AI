import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon, LockIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/features/auth/auth-store';
import { canAccessModel } from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n';

/** Названия моделей живут в словаре; `name` от сервера — запасной вариант. */
const MODEL_NAME_KEYS: Record<string, TranslationKey> = {
  auto: 'chat.modelAuto',
  'ketner-mini': 'chat.modelMini',
  'ketner-pro': 'chat.modelPro',
  'gpt-6-astra': 'chat.modelGptAstra',
  'claude-fable': 'chat.modelClaudeFable',
  'gemini-pro': 'chat.modelGeminiPro',
  'gemini-2.5-pro': 'chat.modelGeminiPro',
  'grok-4.7': 'chat.modelGrok',
  'deepseek-v4.1-flash': 'chat.modelDeepSeek',
  'claude-3-haiku': 'chat.modelHaiku',
  'gpt-4o': 'chat.modelGpt4o',
};

/** Модели по умолчанию: используются, пока каталог не загрузился. */
const FALLBACK_MODELS: readonly ModelInfo[] = [
  {
    id: 'auto',
    name: '✨ Auto',
    contextMessages: 120,
    isPro: false,
  },
  // Plus ($9) — стандартные быстрые модели
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek v4.1 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude Haiku 4.5',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
  },
  // Pro ($29) — топовые флагманские модели
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.1',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini Flash 3.8',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'ketner-pro',
    name: 'Qwen 3.8 Max',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
];

/** Переключатель моделей: логика ответа одна, меняется подпись и лимит контекста. */
export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
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

  const isPlusModel = (m: ModelInfo) =>
    m.requiredPlan === 'plus' ||
    ['gpt-4o', 'gpt-4o-mini', 'deepseek-v4.1-flash', 'gemini-2.5-flash', 'claude-3-haiku', 'glm-5.3-flash', 'nemotron-ultra'].includes(m.id);

  const isFreeModel = (m: ModelInfo) =>
    m.id === 'auto' ||
    (!m.isPro && !isPlusModel(m) && (!m.requiredPlan || m.requiredPlan === 'free'));

  const isProModel = (m: ModelInfo) => !isFreeModel(m) && !isPlusModel(m);

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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
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

    return (
      <li key={model.id} role="none">
        <button
          ref={(el) => {
            optionRefs.current[index] = el;
          }}
          type="button"
          role="option"
          tabIndex={isFocused ? 0 : -1}
          aria-selected={active}
          onClick={() => {
            setModelId(model.id);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors outline-none',
            active
              ? 'bg-accent-soft text-text font-medium'
              : 'text-text hover:bg-surface-2 focus-visible:bg-surface-2',
            isFocused && !active && 'bg-surface-2',
          )}
        >
          <span className="size-3.5 flex items-center justify-center text-accent shrink-0">
            {active ? <CheckIcon className="size-3.5" /> : null}
          </span>
          <span className="flex-1 truncate">{labelOf(model)}</span>
          {!accessible ? (
            <LockIcon className="size-3 text-subtle shrink-0" aria-hidden="true" />
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chat.modelMenu')}
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
          'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted transition-colors',
          'hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="flex items-center gap-1.5">
          {current.id === 'auto' ? (
            <>
              <StatusDot tone="brand" />
              <strong className="font-medium text-text">{t('chat.modelAuto')}</strong>
            </>
          ) : (
            <span>
              {t('chat.model')}: <strong className="font-medium text-text">{labelOf(current)}</strong>
            </span>
          )}
        </span>
        <ChevronDownIcon className="text-xs opacity-70" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('chat.modelMenu')}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute bottom-full left-0 z-[var(--z-dropdown)] mb-2 w-[min(92vw,368px)] max-h-[420px] overflow-y-auto rounded-lg border border-stroke bg-surface p-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,.45)]"
        >
          {/* 1. Standart Group */}
          <div className="mb-2">
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-mono font-medium text-subtle uppercase tracking-[0.06em]">
              <span>{t('chat.tierFree')}</span>
            </div>
            <ul className="mt-1 space-y-0.5" role="none">
              {autoModel ? renderModelItem(autoModel) : null}
              {freeModels.map(renderModelItem)}
            </ul>
          </div>

          {/* 2. Plus Group */}
          {plusModels.length > 0 ? (
            <div className="border-t border-stroke pt-1.5 mb-2">
              <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-mono font-medium text-subtle uppercase tracking-[0.06em]">
                <span>{t('chat.tierPlus')}</span>
                <Badge tone="info" className="text-[10px] py-0 px-1.5">PLUS</Badge>
              </div>
              <ul className="mt-1 space-y-0.5" role="none">
                {plusModels.map(renderModelItem)}
              </ul>
            </div>
          ) : null}

          {/* 3. Pro / Ultra Group */}
          {proModels.length > 0 ? (
            <div className="border-t border-stroke pt-1.5">
              <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-mono font-medium text-subtle uppercase tracking-[0.06em]">
                <span>{t('chat.tierPro')}</span>
                <Badge tone="brand" className="text-[10px] py-0 px-1.5">PRO</Badge>
              </div>
              <ul className="mt-1 space-y-0.5" role="none">
                {proModels.map(renderModelItem)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
