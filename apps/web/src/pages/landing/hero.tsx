import { Link } from 'react-router-dom';
import { ArrowRightIcon, BoltIcon, RefreshIcon } from '@/components/icons';
import { ModelHub } from '@/components/marketing/model-hub';
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
import { Reveal } from '@/components/ui/reveal';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

export function LandingHero() {
  const { t, language } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-stroke bg-canvas py-8 md:py-16 p-5 md:px-12 hero-glow">
      {/* Background grid overlay with soft radial fade */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_80%_70%_at_50%_0%,#000_40%,transparent_100%)] opacity-70"
        aria-hidden="true"
      />

      {/* 4 Corner marks */}
      <CornerMark size={12} className="absolute top-2 left-2 text-stroke-strong" />
      <CornerMark size={12} className="absolute top-2 right-2 text-stroke-strong rotate-90" />
      <CornerMark size={12} className="absolute bottom-2 right-2 text-stroke-strong rotate-180" />
      <CornerMark size={12} className="absolute bottom-2 left-2 text-stroke-strong -rotate-90" />

      <Reveal>
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center text-left">
          {/* Left Column (7/12) */}
          <div className="lg:col-span-7 flex flex-col items-start gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-sm border border-stroke bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-semibold text-muted uppercase tracking-[0.08em]">
                <StatusDot tone="brand" pulse />
                <span>KETNER AI</span>
              </div>

              {status === 'authenticated' && user ? (
                <div className="inline-flex items-center gap-1.5 rounded-sm border border-stroke bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-semibold text-accent uppercase tracking-[0.06em]">
                  <span>{user.name || user.email}</span>
                  <span className="text-muted">·</span>
                  <span>{user.plan.toUpperCase()}</span>
                </div>
              ) : null}
            </div>

            <h1
              aria-label="Ketner AI"
              className="text-[clamp(2rem,9vw,3rem)] md:text-[clamp(3rem,6vw,4rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-text"
            >
              <span className="block text-text whitespace-nowrap">{language === 'ru' ? 'Все AI-модели.' : 'All AI Models.'}</span>
              <span className="block text-muted whitespace-nowrap">
                {language === 'ru' ? 'Одна подписка.' : 'One Subscription.'}
              </span>
            </h1>

            <p className="text-base md:text-lg text-muted max-w-[52ch] leading-relaxed">
              {t('landing.heroSubtitle')}
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center w-full gap-3 pt-2">
              <Link to="/chat" className="w-full sm:w-auto">
                <Button className="w-full h-[52px]" size="lg" variant="primary" rightIcon={<ArrowRightIcon className="text-base" />}>
                  {t('landing.cta')}
                </Button>
              </Link>
              <Link to="/pricing" className="w-full sm:w-auto">
                <Button className="w-full h-[52px]" size="lg" variant="outline">
                  {t('landing.viewPlans')}
                </Button>
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <span className="text-[13px] text-muted">
                {t('landing.socialProof')}
              </span>
              <div className="flex items-center -space-x-1.5" aria-hidden="true">
                <div className="flex size-6 sm:size-7 items-center justify-center rounded-full border border-stroke bg-surface-2 text-[10px] font-semibold text-text shadow-sm ring-2 ring-canvas select-none">
                  K
                </div>
                <div className="flex size-6 sm:size-7 items-center justify-center rounded-full border border-stroke bg-surface-3 text-[10px] font-semibold text-text shadow-sm ring-2 ring-canvas select-none">
                  A
                </div>
              </div>
            </div>

            {/* Micro facts: 3 преимущества компактным списком */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 sm:gap-5 pt-2 font-mono text-[13px] md:text-[14px] text-muted leading-tight">
              <div className="flex items-center gap-2">
                <BoltIcon className="size-4 shrink-0 text-accent" />
                <span>{language === 'ru' ? 'Без токенов' : 'No tokens'}</span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshIcon className="size-4 shrink-0 text-accent" />
                <span>
                  {language === 'ru'
                    ? 'Без переключения между сервисами'
                    : 'No switching between services'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-accent shrink-0" />
                <span>
                  {language === 'ru'
                    ? 'Все флагманы в едином окне'
                    : 'All top models in one window'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column (5/12) */}
          <div className="lg:col-span-5 flex items-center justify-center">
            <ModelHub />
          </div>
        </div>
      </Reveal>
    </div>
  );
}
