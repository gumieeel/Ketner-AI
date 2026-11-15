import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon, ArrowUpRightIcon, SparkleIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { Card } from '@/components/ui/card';
import { useChat } from '@/features/chat/chat-store';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useTranslation } from '@/i18n';
import { appHomePath } from '@/lib/product-switches';

/** Экран нового пользователя: приветствие и примеры запросов. */
export function OnboardingPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const setDraft = useChat((state) => state.setDraft);

  // Пример не отправляется сразу: он подставляется в поле ввода нового чата.
  const startWith = (prompt: string): void => {
    setDraft(prompt);
    navigate(appHomePath());
  };

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-8 px-4 py-8 text-left md:py-12">
      <Card className="relative flex flex-col gap-6 overflow-hidden rounded-2xl p-5 sm:p-8">
        <div
          aria-hidden="true"
          className="bg-aurora pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_55%)]"
        />

        <div className="relative flex flex-col gap-3">
          <div className="flex items-center gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/25 ring-inset">
              <SparkleIcon className="size-5" />
            </div>
            <h1 className="t-title text-balance text-text md:text-[28px]">
              {t('onboarding.title')}
            </h1>
          </div>

          <p className="max-w-[48ch] text-sm leading-6 text-muted">{t('onboarding.text')}</p>
        </div>

        <section aria-labelledby="onboarding-examples" className="relative flex flex-col gap-3">
          <h2 id="onboarding-examples" className="text-[13px] font-semibold text-muted">
            {t('onboarding.examples')}
          </h2>

          <ul className="grid gap-2.5">
            {EXAMPLE_PROMPTS[language].map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => startWith(prompt)}
                  className="lift group flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-stroke bg-surface p-4 text-left shadow-xs hover:border-accent/40 hover:bg-surface-2 hover:shadow-md"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text text-pretty">
                      {prompt}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {t('onboarding.startWith')}
                    </span>
                  </span>
                  <ArrowUpRightIcon className="size-4 shrink-0 text-subtle transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="relative flex justify-end border-t border-stroke pt-5">
          <Link
            to={appHomePath()}
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              className: 'gap-2 max-sm:w-full',
            })}
          >
            {t('landing.cta')}
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </Card>
    </div>
  );
}
