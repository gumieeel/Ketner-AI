import { ArrowUpRightIcon } from '@/components/icons';
import { ModelMark } from '@/components/ui/model-mark';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';

/** Модели «оркестра»: показываются как декоративный ряд над заголовком. */
const ORCHESTRA = [
  'gpt-6.1-sol',
  'claude-opus-5.5',
  'gpt-6-astra',
  'grok-4.7',
  'deepseek-v4.1-flash',
  'ketner-mini',
];

/**
 * Пустое состояние нового чата: приветствие и карточки-примеры.
 * Примеры подставляются в поле ввода, а не отправляются — их можно поправить.
 */
export function ChatEmptyState() {
  const { t, language } = useTranslation();
  const setDraft = useChat((state) => state.setDraft);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative mx-auto my-auto flex w-full max-w-[760px] flex-col items-center px-4 py-8 text-center md:py-12">
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {ORCHESTRA.map((id) => (
            <ModelMark key={id} modelId={id} size="sm" />
          ))}
        </span>

        <h2 className="t-headline mt-6 text-text">{t('chat.emptyTitle')}</h2>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-6 text-muted">{t('chat.emptyHint')}</p>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-left md:grid-cols-3 md:gap-3">
          {EXAMPLE_PROMPTS[language].map((prompt) => (
            <div key={prompt} className="flex">
              <button
                type="button"
                onClick={() => setDraft(prompt)}
                className="group relative flex min-h-14 flex-1 items-start justify-between gap-3 rounded-lg border border-stroke bg-surface p-4 text-left text-[14px] leading-5 text-text transition-colors duration-150 hover:border-stroke-strong hover:bg-surface-2 md:min-h-28 md:flex-col md:justify-between"
              >
                <span className="text-pretty">{prompt}</span>
                <ArrowUpRightIcon className="size-4 shrink-0 text-subtle transition-colors duration-150 group-hover:text-accent md:self-end" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
