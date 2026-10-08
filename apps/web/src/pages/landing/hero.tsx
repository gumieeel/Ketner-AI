import { Link } from 'react-router-dom';
import { ArrowRightIcon, BoltIcon, RefreshIcon, SparkleIcon } from '@/components/icons';
import { AutoDemo } from '@/components/marketing/auto-demo';
import { buttonClasses } from '@/components/ui/button-classes';
import { Reveal } from '@/components/ui/reveal';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

export function LandingHero() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  const facts = [
    { key: 'landing.heroFact1', icon: <BoltIcon className="size-4" /> },
    { key: 'landing.heroFact2', icon: <RefreshIcon className="size-4" /> },
    { key: 'landing.heroFact3', icon: <SparkleIcon className="size-4" /> },
  ] as const;

  return (
    <div className="relative w-full pt-2 pb-4 md:pt-10 md:pb-8">
      <div className="grid grid-cols-1 items-center gap-12 text-left lg:grid-cols-12 lg:gap-10">
        {/* Левая колонка: заголовок, обещание, действия */}
        <div className="flex flex-col items-start gap-6 lg:col-span-6">
          <Reveal eager className="flex flex-wrap items-center gap-2">
            <span className="gradient-border inline-flex items-center gap-2 rounded-full bg-surface/70 px-3.5 py-1.5 text-[13px] font-medium text-text backdrop-blur">
              <StatusDot tone="brand" pulse />
              {t('landing.heroBadge')}
            </span>

            {status === 'authenticated' && user ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-stroke bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-accent">
                <span>{user.name || user.email}</span>
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
                <span>{user.plan.toUpperCase()}</span>
              </span>
            ) : null}
          </Reveal>

          <Reveal eager delayMs={60}>
            <h1
              aria-label="Ketner AI"
              className="t-display text-[clamp(2.25rem,9.2vw,3.25rem)] text-text md:text-[clamp(3rem,5.2vw,4.5rem)]"
            >
              <span className="block">{t('landing.heroLine1')}</span>
              <span className="text-gradient block">{t('landing.heroLine2')}</span>
            </h1>
          </Reveal>

          <Reveal eager delayMs={120}>
            <p className="t-lead max-w-[54ch]">{t('landing.heroLead')}</p>
          </Reveal>

          <Reveal eager delayMs={180} className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
            <Link
              to="/chat"
              className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full sm:w-auto' })}
            >
              {t('landing.cta')}
              <ArrowRightIcon className="text-base" />
            </Link>
            <Link
              to="/pricing"
              className={buttonClasses({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}
            >
              {t('landing.viewPlans')}
            </Link>
          </Reveal>

          <Reveal eager delayMs={240}>
            <ul className="flex flex-col gap-2.5 text-sm text-muted sm:flex-row sm:flex-wrap sm:gap-x-6">
              {facts.map((fact) => (
                <li key={fact.key} className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    {fact.icon}
                  </span>
                  <span>{t(fact.key)}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* Правая колонка: живое демо режима Auto */}
        <Reveal delayMs={200} className="lg:col-span-6">
          <div className="mx-auto w-full max-w-[560px] lg:ml-auto lg:mr-0">
            <AutoDemo />
          </div>
        </Reveal>
      </div>
    </div>
  );
}
