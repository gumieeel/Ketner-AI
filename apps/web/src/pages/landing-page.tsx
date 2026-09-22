import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/i18n';

export function LandingPage() {
  const { t } = useTranslation();

  const features = [
    { title: t('landing.feature1Title'), text: t('landing.feature1Text') },
    { title: t('landing.feature2Title'), text: t('landing.feature2Text') },
    { title: t('landing.feature3Title'), text: t('landing.feature3Text') },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16 md:px-8">
      <section className="flex flex-col items-center gap-5 text-center">
        <Badge tone="brand">{t('landing.mockBadge')}</Badge>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{t('landing.title')}</h1>
        <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-300">
          {t('landing.subtitle')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/chat">
            <Button size="lg">{t('landing.cta')}</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline">
              {t('nav.login')}
            </Button>
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t('landing.aboutTitle')}</h2>
        <p className="max-w-3xl text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
          {t('landing.aboutText')}
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardTitle>{feature.title}</CardTitle>
              <CardText className="mt-2">{feature.text}</CardText>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
