import { Link } from 'react-router-dom';
import { SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { EXAMPLE_PROMPTS } from '@/features/chat/example-prompts';
import { useTranslation } from '@/i18n';

/** Экран нового пользователя: приветствие и примеры запросов. */
export function OnboardingPage() {
  const { t, language } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-500/15 text-2xl text-brand-600 dark:text-brand-300">
          <SparkleIcon />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">{t('onboarding.title')}</h2>
        <p className="text-zinc-600 dark:text-zinc-300">{t('onboarding.text')}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {t('onboarding.examples')}
        </h3>
        <ul className="grid gap-3">
          {EXAMPLE_PROMPTS[language].map((prompt) => (
            <li key={prompt}>
              <Card className="p-4">
                <CardTitle className="text-sm font-medium">{prompt}</CardTitle>
                <CardText className="mt-1 text-xs">{t('common.soon')}</CardText>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex justify-center">
        <Link to="/chat">
          <Button size="lg">{t('landing.cta')}</Button>
        </Link>
      </div>
    </div>
  );
}
