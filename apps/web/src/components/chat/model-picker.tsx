import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
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
};

/** Модели по умолчанию: используются, пока каталог не загрузился. */
const FALLBACK_MODELS: readonly ModelInfo[] = [
  {
    id: 'auto',
    name: '✨ Auto',
    contextMessages: 120,
    isPro: false,
  },
  // Plus (990 ₽) — стандартные модели
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
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
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  // Pro (1 990 ₽) — флагманские модели
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
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
    name: 'Gemini 3.8 Flash *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 *',
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
    ['gpt-4o', 'gpt-4o-mini', 'deepseek-v4.1-flash', 'gemini-2.5-flash', 'claude-3-haiku', 'glm-5.3-flash', 'nemotron-ultra'].includes(m.id);

  const isFreeModel = (m: ModelInfo) =>
    m.id === 'auto' ||
    (!m.isPro && !isPlusModel(m) && (!m.requiredPlan || m.requiredPlan === 'free'));

  const isProModel = (m: ModelInfo) => !isFreeModel(m) && !isPlusModel(m);

  const autoModel = models.find((m) => m.id === 'auto');
  const freeModels = models.filter((m) => m.id !== 'auto' && isFreeModel(m));
  const plusModels = models.filter((m) => m.id !== 'auto' && isPlusModel(m));
  const proModels = models.filter((m) => m.id !== 'auto' && isProModel(m));

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
          {/* 1. Free Group / Auto Router */}
          <div className="mb-2">
            <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              <span>{t('chat.tierFree')}</span>
              <span className="text-[10px] text-muted font-normal">0 ₽</span>
            </div>

            {autoModel ? (
              <button
                type="button"
                role="option"
                aria-selected={autoModel.id === current.id}
                onClick={() => {
                  setModelId('auto');
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-[12px] p-2.5 text-left transition-all border',
                  autoModel.id === current.id
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
                    {autoModel.id === current.id ? <CheckIcon className="text-accent text-sm" /> : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted leading-relaxed">
                    {t('chat.modelAutoSubtitle')}
                  </span>
                </span>
              </button>
            ) : null}

            {freeModels.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {freeModels.map(renderModelItem)}
              </ul>
            ) : null}
          </div>

          {/* 2. Plus Group */}
          <div className="border-t border-stroke/20 pt-1.5 space-y-2.5">
            {plusModels.length > 0 ? (
              <div>
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

            {/* 3. Pro / Ultra Group */}
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
