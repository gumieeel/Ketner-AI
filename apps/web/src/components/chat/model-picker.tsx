import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { DEFAULT_MODEL_ID, usePreferences } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n';

/** Названия моделей живут в словаре; `name` от сервера — запасной вариант. */
const MODEL_NAME_KEYS: Record<string, TranslationKey> = {
  auto: 'chat.modelAuto',
  'ketner-mini': 'chat.modelMini',
  'gpt-6-astra': 'chat.modelGptAstra',
  'claude-fable': 'chat.modelClaudeFable',
  'gemini-pro': 'chat.modelGeminiPro',
  'ketner-pro': 'chat.modelPro',
};

/** Модели по умолчанию: используются, пока каталог не загрузился или недоступен. */
const FALLBACK_MODELS: readonly ModelInfo[] = [
  {
    id: 'auto',
    name: '✨ Auto (Smart Router)',
    contextMessages: 120,
    isPro: false,
  },
  // 1. Базовые модели (Тариф Free)
  {
    id: DEFAULT_MODEL_ID,
    name: 'Ketner Mini · Qwen 2.5 Coder',
    contextMessages: 20,
    isPro: false,
    requiredPlan: 'free',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextMessages: 40,
    isPro: false,
    requiredPlan: 'free',
  },
  // 2. Стандартные и продвинутые модели (Тариф Plus)
  {
    id: 'ketner-pro',
    name: 'Ketner Pro · Qwen 2.5 Max *',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'nemotron-ultra',
    name: 'Nemotron 3 Ultra',
    contextMessages: 30,
    isPro: true,
    requiredPlan: 'plus',
  },
  // 3. Флагманские модели (Тарифы Pro и Ultra)
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro *',
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const models = meta && meta.models.length > 0 ? meta.models : FALLBACK_MODELS;
  const current = models.find((model) => model.id === selectedId) ?? models[0];

  const labelOf = (model: ModelInfo): string => {
    const key = MODEL_NAME_KEYS[model.id];
    return key ? t(key) : model.name;
  };

  const isPlusModel = (m: ModelInfo) =>
    m.requiredPlan === 'plus' ||
    m.id === 'ketner-pro' ||
    ['deepseek-v4.1-flash', 'gemini-2.5-flash', 'claude-3-haiku', 'glm-5.3-flash', 'nemotron-ultra'].includes(m.id);

  const isFreeModel = (m: ModelInfo) =>
    m.id === 'ketner-mini' ||
    (!m.isPro && !isPlusModel(m) && (!m.requiredPlan || m.requiredPlan === 'free'));

  const isProModel = (m: ModelInfo) => !isFreeModel(m) && !isPlusModel(m);

  const nonAutoModels = models.filter((m) => m.id !== 'auto');
  const freeModels = nonAutoModels.filter(isFreeModel);
  const plusModels = nonAutoModels.filter(isPlusModel);
  const proModels = nonAutoModels.filter(isProModel);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const renderModelItem = (model: ModelInfo) => {
    const active = model.id === current.id;
    const isPlus = isPlusModel(model);
    const isPro = isProModel(model);

    return (
      <li key={model.id}>
        <button
          type="button"
          role="option"
          aria-selected={active}
          onClick={() => {
            setModelId(model.id);
            setOpen(false);
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs transition-colors',
            active
              ? 'bg-accent/10 text-text font-medium'
              : 'hover:bg-canvas text-muted hover:text-text',
          )}
        >
          <span className="size-3.5 flex items-center justify-center text-accent">
            {active ? <CheckIcon /> : null}
          </span>
          <span className="flex-1 truncate">{labelOf(model)}</span>
          {isPlus ? (
            <span className="shrink-0 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[9px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
              {t('chat.plusBadge')}
            </span>
          ) : isPro ? (
            <span className="shrink-0 rounded bg-accent/20 border border-accent/30 px-1.5 py-0.5 text-[9px] font-bold text-accent uppercase tracking-wider">
              {t('chat.proBadge')}
            </span>
          ) : (
            <span className="shrink-0 rounded bg-zinc-500/10 border border-zinc-500/20 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              {t('chat.freeBadge')}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chat.modelMenu')}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs text-muted transition-colors',
          'hover:bg-canvas hover:text-text disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="flex items-center gap-1.5">
          {current.id === 'auto' ? (
            <>
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
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
          className="absolute bottom-full left-0 z-20 mb-1 w-80 sm:w-92 max-h-[460px] overflow-y-auto rounded-[16px] border border-stroke/30 bg-surface/95 p-2 shadow-2xl backdrop-blur-md"
        >
          {/* 1. Главный режим Auto Router */}
          {(() => {
            const autoModel = models.find((m) => m.id === 'auto');
            if (!autoModel) return null;
            const active = autoModel.id === current.id;
            return (
              <div key="auto" className="mb-2">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setModelId('auto');
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[12px] p-2.5 text-left transition-all border',
                    active
                      ? 'bg-accent/15 border-accent/40 shadow-sm'
                      : 'border-stroke/30 hover:bg-canvas hover:border-stroke/60',
                  )}
                >
                  <span className="mt-1 flex size-2 shrink-0 rounded-full bg-accent animate-pulse" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text">
                        {labelOf(autoModel)}
                      </span>
                      {active ? <CheckIcon className="text-accent text-sm" /> : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted leading-relaxed">
                      {t('chat.modelAutoSubtitle')}
                    </span>
                  </span>
                </button>
              </div>
            );
          })()}

          {/* 2. Ручной выбор моделей, сгруппированный по тарифам */}
          <div className="border-t border-stroke/20 pt-1.5 space-y-2.5">
            {/* Группа Free: Базовые модели */}
            {freeModels.length > 0 ? (
              <div>
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-muted uppercase tracking-wider">
                  <span>{t('chat.tierFree')}</span>
                  <span className="text-[10px] text-muted font-normal">0 ₽</span>
                </div>
                <ul className="space-y-0.5">
                  {freeModels.map(renderModelItem)}
                </ul>
              </div>
            ) : null}

            {/* Группа Plus: Стандартные и продвинутые */}
            {plusModels.length > 0 ? (
              <div className="border-t border-stroke/15 pt-1.5">
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
                  <span>{t('chat.tierPlus')}</span>
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.2 text-[9px] font-bold text-sky-600 dark:text-sky-400">
                    990 ₽
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {plusModels.map(renderModelItem)}
                </ul>
              </div>
            ) : null}

            {/* Группа Pro / Ultra: Все флагманы */}
            {proModels.length > 0 ? (
              <div className="border-t border-stroke/15 pt-1.5">
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-accent uppercase tracking-wider">
                  <span>{t('chat.tierPro')}</span>
                  <span className="rounded bg-accent/20 px-1.5 py-0.2 text-[9px] font-bold text-accent">
                    1 990 ₽
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {proModels.map(renderModelItem)}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
