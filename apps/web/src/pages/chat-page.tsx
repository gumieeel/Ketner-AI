import { PaperclipIcon, SendIcon, SparkleIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { StubAction } from '@/components/ui/stub-action';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useTranslation } from '@/i18n';

/**
 * Экран чата.
 *
 * Этап 1: каркас — пустое состояние и нефункциональный композер, который
 * показывает будущую раскладку. Лента сообщений, стриминг и заглушка ИИ
 * появляются на этапе 2.
 */
export function ChatPage() {
  const { t, language } = useTranslation();

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-500/15 text-2xl text-brand-600 dark:text-brand-300">
          <SparkleIcon />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">{t('chat.emptyTitle')}</h2>

        <ul className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {EXAMPLE_PROMPTS[language].map((prompt) => (
            <li key={prompt}>
              <Badge tone="outline" className="px-3 py-1.5 text-sm">
                {prompt}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 mx-auto w-full max-w-3xl px-4 pb-6">
        <div className="rounded-2xl border border-zinc-300 bg-white p-3 shadow-sm dark:border-zinc-600 dark:bg-zinc-800">
          <label htmlFor="composer" className="sr-only">
            {t('chat.placeholder')}
          </label>
          <textarea
            id="composer"
            rows={1}
            disabled
            placeholder={t('chat.placeholder')}
            className="max-h-40 min-h-11 w-full resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:placeholder:text-zinc-500"
          />
          <div className="flex items-center gap-1">
            <StubAction label={t('chat.attach')} hint={t('chat.composerNotice')} size="sm">
              <PaperclipIcon />
            </StubAction>
            <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t('chat.model')}: {t('chat.modelMini')}
            </span>
            <button
              type="button"
              disabled
              aria-label={t('chat.send')}
              title={t('chat.send')}
              className="ml-auto inline-flex size-9 items-center justify-center rounded-lg bg-brand-600 text-lg text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SendIcon />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('chat.composerNotice')}
        </p>
      </div>
    </div>
  );
}
