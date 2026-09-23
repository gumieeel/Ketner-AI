import { CornerMark } from '@/components/ui/corner-mark';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';

/**
 * Пустое состояние нового чата («Открытый контур»).
 * Открытая композиция по левому краю ленты с характерным знаком, заголовком, подсказкой
 * и строками примеров с разделителями.
 */
export function ChatEmptyState() {
  const { t, language } = useTranslation();
  const setDraft = useChat((state) => state.setDraft);

  return (
    <div className="mx-auto flex w-full max-w-[760px] min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-8 pt-6">
      <div className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2.5">
          <img src="/logo-mark.png" alt="Ketner AI" className="size-7 object-contain" />
          <CornerMark size={14} className="text-accent" />
        </div>

        <div>
          <h2 className="text-[28px] md:text-[32px] leading-[36px] md:leading-[40px] font-semibold text-text tracking-tight">
            {t('chat.emptyTitle')}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted max-w-[58ch]">{t('chat.emptyHint')}</p>
        </div>

        <div className="mt-4 w-full flex flex-col divide-y divide-stroke/15 border-y border-stroke/15">
          {EXAMPLE_PROMPTS[language].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDraft(prompt)}
              className="flex min-h-[44px] items-center justify-between py-2.5 text-left text-sm leading-5 text-text transition-colors hover:text-accent"
            >
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
