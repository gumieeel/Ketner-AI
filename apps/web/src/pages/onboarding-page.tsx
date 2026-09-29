import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-label';
import { useChat } from '@/features/chat/chat-store';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useTranslation } from '@/i18n';

/** Экран нового пользователя: приветствие и примеры запросов. */
export function OnboardingPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const setDraft = useChat((state) => state.setDraft);

  // Пример не отправляется сразу: он подставляется в поле ввода нового чата.
  const startWith = (prompt: string): void => {
    setDraft(prompt);
    navigate('/chat');
  };

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-8 px-4 py-12 text-left">
      <Card corners className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <SectionLabel index="01">
            {language === 'ru' ? 'Первые шаги' : 'Getting started'}
          </SectionLabel>

          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-stroke bg-surface-2 text-accent">
              <SparkleIcon className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {t('onboarding.title')}
            </h1>
          </div>

          <p className="text-sm text-muted leading-relaxed">
            {t('onboarding.text')}
          </p>
        </div>

        <section className="flex flex-col gap-3 pt-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted font-semibold">
            {t('onboarding.examples')}
          </h2>

          <ul className="grid gap-2.5">
            {EXAMPLE_PROMPTS[language].map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => startWith(prompt)}
                  className="w-full text-left"
                >
                  <Card
                    variant="interactive"
                    className="p-4 transition-colors"
                  >
                    <CardTitle className="text-sm font-medium text-text">
                      {prompt}
                    </CardTitle>
                    <CardText className="mt-1 text-xs text-muted flex items-center gap-1.5">
                      <span>{t('onboarding.startWith')}</span>
                      <ArrowRightIcon className="size-3 text-accent" />
                    </CardText>
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex justify-end pt-4 border-t border-stroke">
          <Link to="/chat">
            <Button
              size="lg"
              variant="primary"
              rightIcon={<ArrowRightIcon className="size-4" />}
            >
              {t('landing.cta')}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
