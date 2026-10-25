import { ArrowUpRightIcon } from '@/components/icons';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';
import { Composer } from './composer';

/**
 * Пустое состояние нового чата: вопрос, поле ввода по центру и примеры запросов.
 * Примеры подставляются в поле ввода, а не отправляются — их можно поправить.
 */
export function ChatEmptyState() {
  const { t, language } = useTranslation();
  const setDraft = useChat((state) => state.setDraft);

  return (
    <div className="chat-stage relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto my-auto flex w-full flex-col items-center pt-10 pb-[10vh] max-md:pb-8">
        <div className="px-4 text-center">
          <h2 className="t-title text-[clamp(1.875rem,1.6vw+1.4rem,2.5rem)] leading-[1.15] font-[470] tracking-[-0.025em] text-text">
            {t('chat.emptyTitle')}
          </h2>
          <p className="mt-3 text-[15px] leading-6 text-muted md:text-base">
            {t('chat.emptyHint')}
          </p>
        </div>

        <div className="mt-9 w-full">
          <Composer variant="hero" />
        </div>

        <ul
          aria-label={t('chat.examplesLabel')}
          className="mx-auto mt-5 flex w-full max-w-[824px] flex-wrap justify-center gap-2 px-4"
        >
          {EXAMPLE_PROMPTS[language].map((prompt) => (
            <li key={prompt} className="max-w-full">
              <button
                type="button"
                onClick={() => setDraft(prompt)}
                className="group inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-stroke px-4 py-2 text-left text-[14px] leading-5 text-muted transition-[background-color,border-color,color] duration-200 hover:border-stroke-strong hover:bg-surface-2/70 hover:text-text max-md:min-h-11"
              >
                <span className="truncate">{prompt}</span>
                <ArrowUpRightIcon className="size-3.5 shrink-0 text-subtle transition-colors duration-200 group-hover:text-accent" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
