import { Link } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckIcon,
  SparkleIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface WhyFeature {
  icon: string;
  titleKey: 'landing.why1Title' | 'landing.why2Title' | 'landing.why3Title' | 'landing.why4Title';
  descKey: 'landing.why1Desc' | 'landing.why2Desc' | 'landing.why3Desc' | 'landing.why4Desc';
}

const WHY_FEATURES: WhyFeature[] = [
  {
    icon: '✨',
    titleKey: 'landing.why1Title',
    descKey: 'landing.why1Desc',
  },
  {
    icon: '⚡',
    titleKey: 'landing.why2Title',
    descKey: 'landing.why2Desc',
  },
  {
    icon: '💬',
    titleKey: 'landing.why3Title',
    descKey: 'landing.why3Desc',
  },
  {
    icon: '🚀',
    titleKey: 'landing.why4Title',
    descKey: 'landing.why4Desc',
  },
];

interface HowStep {
  number: string;
  titleKey: 'landing.step1Title' | 'landing.step2Title' | 'landing.step3Title';
  descKey: 'landing.step1Desc' | 'landing.step2Desc' | 'landing.step3Desc';
}

const HOW_STEPS: HowStep[] = [
  {
    number: '1',
    titleKey: 'landing.step1Title',
    descKey: 'landing.step1Desc',
  },
  {
    number: '2',
    titleKey: 'landing.step2Title',
    descKey: 'landing.step2Desc',
  },
  {
    number: '3',
    titleKey: 'landing.step3Title',
    descKey: 'landing.step3Desc',
  },
];

interface TierPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  speed: string;
  priority: string;
  context: string;
  popular?: boolean;
  href: string;
}

const TIER_PLANS: TierPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/ month',
    speed: 'Standard response speed',
    priority: 'Standard queue priority',
    context: 'Standard context window',
    href: '/chat',
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$9.99',
    period: '/ month',
    speed: 'Fast response speed',
    priority: 'Enhanced queue priority',
    context: 'Extended conversation context',
    href: '/checkout/plus',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19.99',
    period: '/ month',
    speed: 'Ultra-fast flagship speed',
    priority: 'High priority processing',
    context: 'Deep multi-turn context (all flagship AIs)',
    popular: true,
    href: '/checkout/pro',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '$39.99',
    period: '/ month',
    speed: 'Maximum processing speed',
    priority: 'Dedicated VIP priority',
    context: 'Massive context for full project work',
    href: '/checkout/ultra',
  },
];

export function LandingPage() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-20 px-4 py-12 md:px-8 animate-fade-in text-center">
      {/* 1. HERO SECTION */}
      <section className="relative flex w-full max-w-3xl flex-col items-center gap-6 pt-4">
        {/* Крошечный акцентный бренд-бейдж */}
        <div className="inline-flex items-center gap-2 rounded-full border border-stroke/30 bg-surface/80 px-3.5 py-1 text-xs font-semibold text-accent shadow-sm backdrop-blur-md">
          <span className="size-2 rounded-full bg-accent animate-pulse" />
          <h1 className="text-xs font-bold tracking-widest uppercase text-accent">Ketner AI</h1>
        </div>

        {/* Главный заголовок */}
        <div className="flex flex-col gap-3">
          <h2 className="text-4xl font-extrabold tracking-tight text-text sm:text-5xl md:text-6xl text-balance leading-[1.12]">
            {t('landing.heroTitle')}
          </h2>
          <p className="text-lg sm:text-xl font-medium text-muted text-balance">
            {t('landing.heroSubtitle')}
          </p>
          <p className="text-sm font-semibold tracking-wide text-accent">
            {t('landing.heroNote')}
          </p>
        </div>

        {status === 'authenticated' && user ? (
          <p className="rounded-full bg-accent/10 px-4 py-1 text-xs font-semibold text-accent border border-accent/20">
            {user.name || user.email} · {user.plan.toUpperCase()}
          </p>
        ) : null}

        {/* Кнопки действия */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link to="/chat">
            <Button
              size="lg"
              className="gap-2 px-8 font-semibold shadow-lg shadow-accent/25 hover:shadow-accent/40"
            >
              <span>{t('landing.cta')}</span>
              <ArrowRightIcon className="text-base" />
            </Button>
          </Link>
          <Link to="/pricing">
            <Button size="lg" variant="outline" className="px-6 font-medium">
              <span>{t('landing.viewPlans')}</span>
            </Button>
          </Link>
        </div>
      </section>

      {/* Интерактивный лаконичный пример чата с Auto Mode */}
      <section className="w-full max-w-2xl">
        <div className="overflow-hidden rounded-2xl border border-stroke/25 bg-surface/90 shadow-2xl backdrop-blur-xl transition-all">
          <div className="flex items-center justify-between border-b border-stroke/20 bg-canvas/60 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500/70" />
              <span className="size-2.5 rounded-full bg-yellow-500/70" />
              <span className="size-2.5 rounded-full bg-green-500/70" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-accent/10 border border-accent/25 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              <span>Best AI (Auto)</span>
            </div>
          </div>

          <div className="flex flex-col gap-3.5 p-5 text-left text-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                You
              </span>
              <div className="rounded-xl bg-canvas/80 px-4 py-2 text-text border border-stroke/15">
                Explain the difference between quantum computing and classical computing in 2 sentences.
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-[var(--color-accent-text)] shadow-sm">
                K
              </span>
              <div className="flex flex-1 flex-col gap-2 rounded-xl bg-canvas/40 p-4 border border-stroke/15">
                <div className="flex items-center justify-between text-xs text-muted border-b border-stroke/10 pb-1.5">
                  <span className="font-semibold text-text">✨ Routed via Auto Mode → GPT-6 Astra</span>
                  <span className="text-[11px] text-accent">Instant stream</span>
                </div>
                <p className="text-text/90 leading-relaxed text-xs sm:text-sm">
                  Classical computers process information sequentially using binary bits that are either 0 or 1.
                  In contrast, quantum computers leverage qubits and superposition to evaluate vast combinations
                  simultaneously, solving complex optimization problems exponentially faster.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. WHY KETNER */}
      <section className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <Badge tone="brand">Ketner AI</Badge>
          <h2 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
            {t('landing.whyTitle')}
          </h2>
          <p className="text-sm text-muted max-w-md text-balance">
            {t('landing.whySubtitle')}
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
          {WHY_FEATURES.map((feat) => (
            <Card
              key={feat.titleKey}
              className="card-interactive flex flex-col justify-between p-5 border border-stroke/20 bg-surface/70 backdrop-blur-sm rounded-xl"
            >
              <div>
                <div className="mb-3 text-2xl">{feat.icon}</div>
                <h3 className="text-base font-bold text-text">{t(feat.titleKey)}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {t(feat.descKey)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* 4. HOW IT WORKS */}
      <section className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
            {t('landing.howTitle')}
          </h2>
          <p className="text-sm text-muted max-w-md text-balance">
            {t('landing.howSubtitle')}
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          {HOW_STEPS.map((step) => (
            <div
              key={step.number}
              className="flex flex-col items-center text-center rounded-2xl border border-stroke/20 bg-surface/50 p-6 shadow-sm"
            >
              <div className="grid size-12 place-items-center rounded-full bg-accent/15 text-lg font-extrabold text-accent mb-4">
                {step.number}
              </div>
              <h3 className="text-base font-bold text-text mb-2">{t(step.titleKey)}</h3>
              <p className="text-xs text-muted leading-relaxed max-w-xs">
                {t(step.descKey)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. PRICING (Free / Plus / Pro / Ultra with speed, priority, context) */}
      <section className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
            {t('landing.pricingTitle')}
          </h2>
          <p className="text-sm text-muted max-w-md text-balance">
            {t('landing.pricingSubtitle')}
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
          {TIER_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'flex flex-col justify-between rounded-2xl p-5 border transition-all',
                plan.popular
                  ? 'border-accent bg-accent/10 shadow-lg relative'
                  : 'border-stroke/20 bg-surface/60 hover:border-stroke/40',
              )}
            >
              {plan.popular && (
                <div className="absolute -top-2.5 right-4 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent-text)] uppercase tracking-wide">
                  Most Popular
                </div>
              )}

              <div>
                <h3 className="text-lg font-bold text-text">{plan.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-text">{plan.price}</span>
                  <span className="text-xs text-muted">{plan.period}</span>
                </div>

                <div className="mt-5 flex flex-col gap-2.5 border-t border-stroke/15 pt-4 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-accent mt-0.5" />
                    <span className="text-text/90 font-medium">{plan.speed}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-accent mt-0.5" />
                    <span className="text-text/90 font-medium">{plan.priority}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-accent mt-0.5" />
                    <span className="text-text/90 font-medium">{plan.context}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-2">
                <Link to={plan.href} className="w-full block">
                  <Button
                    variant={plan.popular ? 'primary' : 'outline'}
                    size="md"
                    className="w-full font-semibold text-xs"
                  >
                    {plan.id === 'free' ? t('landing.cta') : `Get ${plan.name}`}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 7. FINAL CONVERSION CTA */}
      <section className="flex w-full flex-col items-center gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-8 md:p-12">
        <SparkleIcon className="text-3xl text-accent" />
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
          {t('landing.heroTitle')}
        </h2>
        <p className="text-sm text-muted max-w-md">
          {t('landing.heroSubtitle')} · {t('landing.heroNote')}
        </p>
        <Link to="/chat" className="mt-2">
          <Button size="lg" className="px-8 font-semibold shadow-lg shadow-accent/25">
            {t('landing.cta')}
          </Button>
        </Link>
      </section>
    </div>
  );
}
