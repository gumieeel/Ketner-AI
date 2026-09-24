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
  'ketner-mini': 'chat.modelMini',
  'gpt-6-astra': 'chat.modelGptAstra',
  'claude-fable': 'chat.modelClaudeFable',
  'gemini-pro': 'chat.modelGeminiPro',
  'ketner-pro': 'chat.modelPro',
};

/** Модели по умолчанию: используются, пока каталог не загрузился или недоступен. */
const FALLBACK_MODELS: readonly ModelInfo[] = [
  {
    id: DEFAULT_MODEL_ID,
    name: 'Qwen 2.5 Coder',
    contextMessages: 20,
    isPro: false,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'gpt-pro',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'claude-pro',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'gemini-pro',
  },
  {
    id: 'ketner-pro',
    name: 'Qwen 2.5 Max *',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'ultra',
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
        <span>
          {t('chat.model')}: <strong className="font-medium text-text">{labelOf(current)}</strong>
        </span>
        <ChevronDownIcon className="text-sm" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={t('chat.modelMenu')}
          className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-[16px] border border-stroke/30 bg-surface p-1.5 shadow-xl backdrop-blur-md"
        >
          {models.map((model) => {
            const active = model.id === current.id;
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
                    'flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'bg-accent/10 text-text'
                      : 'hover:bg-canvas text-muted hover:text-text',
                  )}
                >
                  <span className="mt-0.5 text-sm text-accent">
                    {active ? <CheckIcon /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                      <span className="truncate">{labelOf(model)}</span>
                      {model.isPro ? (
                        <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.2 text-[9px] font-bold text-accent uppercase tracking-wider">
                          {t('chat.proBadge')}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('chat.modelContext', { count: model.contextMessages })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
