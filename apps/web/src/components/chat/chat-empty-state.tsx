import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';

/**
 * Пустое состояние нового чата.
 *
 * Примеры подставляются в поле ввода, а не отправляются сразу: пользователь
 * может поправить формулировку перед отправкой.
 */
export function ChatEmptyState() {
  const { t, language } = useTranslation();
  const setDraft = useChat((state) => state.setDraft);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-10 text-center">
      <img src="/logo-mark.png" alt="Ketner AI" className="size-16 object-contain drop-shadow-sm" />
      <h2 className="text-2xl font-semibold tracking-tight">{t('chat.emptyTitle')}</h2>

      <ul className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {EXAMPLE_PROMPTS[language].map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => setDraft(prompt)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-brand-500 hover:text-brand-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
