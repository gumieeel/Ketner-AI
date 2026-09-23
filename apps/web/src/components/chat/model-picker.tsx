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
  'ketner-pro': 'chat.modelPro',
};

/** Модель по умолчанию: используется, пока каталог не загрузился или недоступен. */
const FALLBACK_MODEL: ModelInfo = {
  id: DEFAULT_MODEL_ID,
  name: 'Ketner mini',
  contextMessages: 20,
};

/** Переключатель моделей: логика ответа одна, меняется подпись и лимит контекста. */
export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const meta = useChat((state) => state.meta);
  const selectedId = usePreferences((state) => state.chatModelId);
  const setModelId = usePreferences((state) => state.setChatModelId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const models = meta && meta.models.length > 0 ? meta.models : [FALLBACK_MODEL];
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
          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-500 transition-colors',
          'hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60',
          'dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
        )}
      >
        {t('chat.model')}: {labelOf(current)}
        <ChevronDownIcon className="text-sm" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={t('chat.modelMenu')}
          className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
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
                    'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                    active
                      ? 'bg-zinc-100 dark:bg-zinc-700'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-700',
                  )}
                >
                  <span className="mt-0.5 text-sm text-brand-600 dark:text-brand-300">
                    {active ? <CheckIcon /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {labelOf(model)}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
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
