import { Link } from 'react-router-dom';
import { BookOpenIcon, CheckIcon, SparkleIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export function PricingPage() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const currentPlan = user?.plan ?? 'free';

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-12 md:px-6 lg:px-8 animate-fade-in">
      {/* Заголовок страницы */}
      <div className="flex flex-col items-center gap-3 text-center animate-slide-up">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <SparkleIcon className="text-sm" />
          <span>{t('pricing.nextGenBadge')}</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">
          {t('pricing.title')}
        </h1>
        <p className="max-w-2xl text-sm md:text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
          {t('pricing.subtitle')}
        </p>
      </div>

      {/* Сетка из 4 карточек тарифов: Free, Plus, Pro, Ultra */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const isUltra = plan.id === 'ultra';

          return (
            <Card
              key={plan.id}
              className={cn(
                'card-interactive relative flex flex-col justify-between p-5 transition-all duration-200',
                isCurrent && 'border-accent ring-2 ring-accent/30',
                isUltra &&
                  'ultra-glow border-accent/60 bg-gradient-to-b from-accent/5 via-surface to-surface shadow-md',
              )}
            >
              <div>
                {/* Заголовок и статус */}
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-text">{t(plan.nameKey)}</h2>
                  {isCurrent ? (
                    <Badge tone="brand">{t('pricing.currentPlan')}</Badge>
                  ) : isUltra ? (
                    <Badge tone="brand">{t('pricing.allInclusive')}</Badge>
                  ) : plan.popular ? (
                    <Badge tone="brand">{t('pricing.popular')}</Badge>
                  ) : null}
                </div>

                {/* Цена */}
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-tight text-text">
                    {language === 'ru'
                      ? plan.priceMonthly === 0
                        ? '0 ₽'
                        : `${plan.priceMonthly.toLocaleString('ru-RU')} ₽`
                      : plan.id === 'free'
                        ? '$0'
                        : plan.id === 'plus'
                          ? '$9.99'
                          : plan.id === 'pro'
                            ? '$19.99'
                            : '$39.99'}
                  </span>
                  <span className="text-xs text-muted font-normal">{t('pricing.month')}</span>
                </div>

                {/* Модели и плавающий лимит */}
                <div className="mt-3 flex flex-col gap-1.5">
                  {plan.modelsHighlight && (
                    <span className="inline-block text-[11px] font-semibold text-accent uppercase tracking-wide">
                      {typeof plan.modelsHighlight === 'string'
                        ? plan.modelsHighlight
                        : plan.modelsHighlight[language]}
                    </span>
                  )}
                  {plan.limitBadge && (
                    <span className="inline-flex items-center self-start rounded-md bg-canvas px-2 py-0.5 text-[11px] font-medium text-text border border-stroke/20">
                      ⏱️ {plan.limitBadge[language]}
                    </span>
                  )}
                </div>

                {/* Пункты преимуществ */}
                <ul className="mt-4 flex flex-col gap-2.5">
                  {plan.bullets[language].map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-2 text-xs leading-relaxed text-text/85"
                    >
                      <CheckIcon className="mt-0.5 shrink-0 text-sm text-accent" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Ссылка на доку и кнопка действия */}
              <div className="mt-6 flex flex-col gap-3 pt-2 border-t border-stroke/10">
                <Link
                  to={`/docs#plan-${plan.id}`}
                  className="inline-flex items-center gap-1.5 text-xs text-accent font-medium hover:underline transition-colors"
                >
                  <BookOpenIcon className="text-sm shrink-0" />
                  <span>{t('pricing.viewDocs')}</span>
                </Link>

                <div>
                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full opacity-70 text-xs">
                      {t('pricing.currentPlanBadge')}
                    </Button>
                  ) : plan.id === 'free' ? (
                    <Link to="/chat" className="block w-full">
                      <Button variant="outline" className="w-full text-xs">
                        {t('landing.cta')}
                      </Button>
                    </Link>
                  ) : (
                    <Link to={`/checkout/${plan.id}`} className="block w-full">
                      <Button
                        variant={isUltra || plan.popular ? 'primary' : 'outline'}
                        className="w-full text-xs"
                      >
                        {t('pricing.choosePlan')}
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Нижняя сноска со ссылкой на документацию */}
      <div className="flex flex-col items-center gap-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <p>{t('pricing.notice')}</p>
        <Link to="/docs" className="text-accent underline hover:opacity-80 transition-opacity">
          {t('pricing.docsLink')}
        </Link>
      </div>
    </div>
  );
}
