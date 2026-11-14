import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation, type TranslationKey } from '@/i18n';
import { productSwitch, type ProductFeature } from '@/lib/product-switches';

const TITLES: Record<ProductFeature, TranslationKey> = {
  stars: 'closed.title.stars',
  chat: 'closed.title.chat',
  code: 'closed.title.code',
  images: 'closed.title.images',
  developerApi: 'closed.title.developerApi',
  answerReview: 'closed.title.answerReview',
  modelCompare: 'closed.title.modelCompare',
};

/** Адрес закрытой возможности (product-switches.ts): понятное сообщение и путь к решениям. */
export function ClosedFeaturePage({
  feature,
  fullPage = false,
}: {
  feature: ProductFeature;
  /** Вместо всего раздела (без шапки сайта) — на весь экран и со своим <main>. */
  fullPage?: boolean;
}) {
  const { t } = useTranslation();
  const Tag = fullPage ? 'main' : 'div';
  return (
    <Tag
      {...(fullPage ? { id: 'main-content' } : {})}
      className={
        fullPage
          ? 'mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center'
          : 'mx-auto my-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-2 py-16 text-center'
      }
    >
      <h1 className="text-xl font-semibold tracking-tight text-balance text-text md:text-2xl">
        {t(TITLES[feature])}
      </h1>
      <p className="max-w-md text-sm leading-6 text-muted">{t('closed.text')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link to="/solutions" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t('nav.solutions')}
        </Link>
        <Link to="/" className={buttonClasses({ variant: 'outline', size: 'md' })}>
          {t('notFound.home')}
        </Link>
      </div>
    </Tag>
  );
}

/** Маршрут закрытой возможности: проверка при отрисовке (тесты могут включить возможность). */
export function FeatureGate({
  feature,
  children,
}: {
  feature: ProductFeature;
  children: ReactNode;
}) {
  return productSwitch(feature) ? (
    <>{children}</>
  ) : (
    <ClosedFeaturePage feature={feature} fullPage />
  );
}
