import { ArrowUpRightIcon } from '@/components/icons';
import { ModelMark } from '@/components/ui/model-mark';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';

/** Модели «оркестра»: показываются как декоративный ряд над заголовком. */
const ORCHESTRA = ['gpt-6-astra', 'claude-fable', 'gemini-2.5-pro', 'grok-4.7', 'deepseek-v4.1-flash', 'ketner-mini'];

/**
 * Пустое состояние нового чата: приветствие и карточки-примеры.
 * Примеры подставляются в поле ввода, а не отправляются — их можно поправить.
 */
export function ChatEmptyState() {
  const { t, language } = useTranslation();
  const setDraft = useChat((state) => state.setDraft);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Атмосфера: мягкое пятно за приветствием */}
      <div
        aria-hidden="true"
        className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="relative mx-auto my-auto flex w-full max-w-[760px] flex-col items-center px-4 py-8 text-center md:py-12">
        <div className="animate-slide-up flex items-center gap-3">
          <span aria-hidden="true" className="flex -space-x-2">
            {ORCHESTRA.map((id) => (
              <span key={id} className="rounded-[11px] bg-canvas p-0.5 ring-2 ring-canvas">
                <ModelMark modelId={id} size="sm" />
              </span>
            ))}
          </span>
        </div>

        <p style={{ animationDelay: '60ms' }} className="animate-slide-up mt-4 text-[13px] font-medium text-accent">
          {t('chat.emptyKicker')}
        </p>

        <h2 style={{ animationDelay: '100ms' }} className="t-headline animate-slide-up mt-2 text-text">
          {t('chat.emptyTitle')}
        </h2>
        <p style={{ animationDelay: '140ms' }} className="animate-slide-up mt-3 max-w-[52ch] text-sm leading-6 text-muted md:text-[15px]">
          {t('chat.emptyHint')}
        </p>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-left md:grid-cols-3 md:gap-3">
          {EXAMPLE_PROMPTS[language].map((prompt, index) => (
            <div
              key={prompt}
              style={{ animationDelay: `${180 + index * 60}ms` }}
              className="animate-slide-up flex"
            >
              <button
                type="button"
                onClick={() => setDraft(prompt)}
                className="lift group relative flex min-h-14 flex-1 items-start justify-between gap-3 rounded-2xl border border-stroke bg-surface p-4 text-left text-sm leading-5 text-text shadow-sm hover:border-accent/40 hover:bg-surface-2 hover:shadow-md md:min-h-28 md:flex-col md:justify-between"
              >
                <span className="text-pretty">{prompt}</span>
                <ArrowUpRightIcon className="size-4 shrink-0 text-subtle transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent md:self-end" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
