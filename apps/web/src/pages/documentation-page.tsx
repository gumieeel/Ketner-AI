import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { LocalizedLink as Link } from '@/components/ui/localized-link';
import {
  ArrowLeftIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  InfoIcon,
  RocketIcon,
  ShieldIcon,
  SparkleIcon,
  StarIcon,
} from '@/components/icons';
import { Callout, DocHeading, DocsLayout, useScrollSpy } from '@/components/docs';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { FAQ_ITEMS } from '@/features/content/faq';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface PlanCardInfo {
  id: string;
  name: string;
  price: { ru: string; en: string };
  badge: { ru: string; en: string };
  desc: { ru: string; en: string };
  speed: { ru: string; en: string };
  priority: { ru: string; en: string };
  context: { ru: string; en: string };
  features: { ru: string[]; en: string[] };
  popular?: boolean;
}

const PLANS_DATA: PlanCardInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: { ru: '$0', en: '$0' },
    badge: { ru: 'Попробуйте AI', en: 'Try AI' },
    desc: {
      ru: 'Идеально для первого знакомства, быстрых вопросов и простых задач.',
      en: 'Ideal for trying out the platform, fast questions, and everyday queries.',
    },
    speed: { ru: '10 сообщений в сутки', en: '10 messages a day' },
    priority: { ru: '1 запрос одновременно', en: '1 request at once' },
    context: { ru: 'Режим Auto', en: 'Auto mode' },
    features: {
      ru: [
        'Бесплатная Nemotron 3 Ultra (NVIDIA), запасная — Ketner Mini',
        'Интеллектуальный режим Best AI (Auto)',
        'Сохранение полной истории диалогов',
        'Синхронизация между всеми устройствами',
      ],
      en: [
        'Free Nemotron 3 Ultra (NVIDIA), Ketner Mini as backup',
        'Intelligent Best AI (Auto) mode',
        'Full conversation history saving',
        'Sync across all your devices',
      ],
    },
  },
  {
    id: 'plus',
    name: 'Plus',
    price: { ru: '$9 / мес', en: '$9 / mo' },
    badge: { ru: 'Быстрые модели', en: 'Fast models' },
    desc: {
      ru: 'Стандартные быстрые модели для комфортной ежедневной работы и учебы.',
      en: 'Standard fast models for smooth daily work and study.',
    },
    speed: { ru: '500 сообщений в сутки', en: '500 messages a day' },
    priority: { ru: '2 запроса одновременно', en: '2 requests at once' },
    context: { ru: 'GPT-6.1 Sol и Claude Haiku', en: 'GPT-6.1 Sol and Claude Haiku' },
    features: {
      ru: [
        'Модели: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'Картинки FLUX.2 klein в пяти форматах',
        'GPT-6.1 Sol — 14 запросов в неделю, не больше 5 в сутки',
        'Доступ через режим Auto или ручной выбор модели',
      ],
      en: [
        'Models: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'FLUX.2 klein images in five aspect ratios',
        'GPT-6.1 Sol: 14 requests a week, at most 5 a day',
        'Access via Auto mode or manual model selection',
      ],
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { ru: '$25 / мес', en: '$25 / mo' },
    badge: { ru: 'Топовые модели', en: 'Top models' },
    desc: {
      ru: 'Топовые мировые флагманы. Включает всё из Plus.',
      en: 'World-class flagship models. Includes all Plus features.',
    },
    speed: { ru: '1 500 сообщений в сутки', en: '1,500 messages a day' },
    priority: { ru: '4 запроса одновременно', en: '4 requests at once' },
    context: { ru: 'Claude Opus и Sonnet', en: 'Claude Opus and Sonnet' },
    popular: true,
    features: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'Картинки FLUX.2 dev и Seedream',
        'Claude Opus 5.5 — 21 запрос в неделю, Sonnet 5.5 — 42',
        'Ручной выбор любой модели, доступной на тарифе',
      ],
      en: [
        'All Plus tier features included',
        'Top models: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'FLUX.2 dev and Seedream images',
        'Claude Opus 5.5: 21 requests a week, Sonnet 5.5: 42',
        'Manual selection of any model available on your plan',
      ],
    },
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: { ru: '$49 / мес', en: '$49 / mo' },
    badge: { ru: 'Максимум возможностей', en: 'Maximum power' },
    desc: {
      ru: 'Все модели Pro, режим Max, лучшие модели картинок и самые высокие лимиты.',
      en: 'All Pro models, Max mode, the best image models and the highest limits.',
    },
    speed: { ru: '4 000 сообщений в сутки', en: '4,000 messages a day' },
    priority: { ru: '8 запросов одновременно', en: '8 requests at once' },
    context: { ru: 'Режим Max', en: 'Max mode' },
    features: {
      ru: [
        'Все, что входит в тариф Pro',
        'Режим Max: модели думают дольше и глубже',
        'Картинки FLUX.2 pro и Nano Banana 2',
        'Claude Opus 5.5 — 49 запросов в неделю, Sonnet 5.5 — 98',
      ],
      en: [
        'All Pro tier features included',
        'Max mode: models think longer and deeper',
        'FLUX.2 pro and Nano Banana 2 images',
        'Claude Opus 5.5: 49 requests a week, Sonnet 5.5: 98',
      ],
    },
  },
];

const PLAN_TONES: Record<string, BadgeTone> = {
  free: 'neutral',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
};

export function DocumentationPage() {
  const { t, language } = useTranslation();
  const location = useLocation();
  const { planId } = useParams<{ planId?: string }>();

  const activeId = useScrollSpy(['what-is-ketner', 'how-it-works', 'plans', 'fair-use', 'faq']);

  useEffect(() => {
    if (planId) {
      const el = document.getElementById(`plan-${planId}`) || document.getElementById('plans');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (location.hash) {
      const id = location.hash.replace('#', '');
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      window.scrollTo(0, 0);
    }
  }, [planId, location.hash]);

  const navItems = [
    {
      id: 'what-is-ketner',
      label: t('docPage.navWhat'),
      icon: <SparkleIcon className="size-4" />,
    },
    {
      id: 'how-it-works',
      label: t('docPage.navHow'),
      icon: <BoltIcon className="size-4" />,
    },
    {
      id: 'plans',
      label: t('docPage.navPlans'),
      icon: <StarIcon className="size-4" />,
    },
    {
      id: 'fair-use',
      label: t('docPage.navFair'),
      icon: <ShieldIcon className="size-4" />,
    },
    {
      id: 'faq',
      label: t('docPage.navFaq'),
      icon: <InfoIcon className="size-4" />,
    },
  ];

  const sectionClass = 'flex scroll-mt-32 flex-col gap-4 mb-12 xl:scroll-mt-24';
  const stepClass = 'flex flex-col gap-2 rounded-2xl border-stroke bg-surface p-5';

  return (
    <DocsLayout nav={navItems} activeId={activeId}>
      {/* Шапка документации */}
      <div className="mb-8 flex flex-col gap-4 border-b border-stroke pb-6">
        <Link
          to="/chat"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-2 text-sm text-muted transition-colors hover:text-text"
        >
          <ArrowLeftIcon className="size-4" />
          {t('docPage.back')}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-balance text-text sm:text-3xl">
              {t('docPage.title')}
            </h1>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-6 text-muted">{t('docPage.lead')}</p>
          </div>
          <Link
            to="/pricing"
            className={cn(buttonClasses({ variant: 'primary', size: 'md' }), 'gap-1.5')}
          >
            <SparkleIcon className="size-4" />
            {t('docPage.viewPlans')}
          </Link>
        </div>
      </div>

      {/* 1. Что такое Ketner */}
      <section id="what-is-ketner" className={sectionClass}>
        <DocHeading id="what-is-ketner-heading">
          <SparkleIcon className="size-5 text-accent" />
          <span>{t('docPage.navWhat')}</span>
        </DocHeading>
        <Card className="relative overflow-hidden rounded-2xl border-stroke bg-surface p-5 sm:p-6">
          <div
            aria-hidden="true"
            className="bg-aurora pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom_right,black,transparent_70%)]"
          />
          <p className="relative max-w-[56ch] text-base leading-relaxed font-medium text-balance text-text sm:text-lg">
            {t('docPage.whatLead')}
          </p>
          <p className="relative mt-3 max-w-[68ch] text-sm leading-relaxed text-muted">
            {t('docPage.whatText')}
          </p>
        </Card>
      </section>

      {/* 2. Как это работает */}
      <section id="how-it-works" className={sectionClass}>
        <DocHeading id="how-it-works-heading">
          <BoltIcon className="size-5 text-accent" />
          <span>{t('docPage.navHow')}</span>
        </DocHeading>
        <div className="grid gap-3 sm:grid-cols-3 md:gap-4">
          {[
            {
              n: '1',
              title: t('docPage.step1Title'),
              text: t('docPage.step1Text'),
            },
            {
              n: '2',
              title: t('docPage.step2Title'),
              text: t('docPage.step2Text'),
            },
            {
              n: '3',
              title: t('docPage.step3Title'),
              text: t('docPage.step3Text'),
            },
          ].map((step) => (
            <Card key={step.n} className={stepClass}>
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent ring-1 ring-accent/20 ring-inset">
                {step.n}
              </span>
              <CardTitle className="mt-1 text-[15px]">{step.title}</CardTitle>
              <CardText className="text-[13px] leading-5">{step.text}</CardText>
            </Card>
          ))}
        </div>
      </section>

      {/* 3. Тарифные планы */}
      <section id="plans" className={cn(sectionClass, 'gap-6')}>
        <div>
          <DocHeading id="plans-heading" className="mb-2">
            <StarIcon className="size-5 text-accent" />
            <span>{t('docPage.plansTitle')}</span>
          </DocHeading>
          <p className="max-w-[68ch] text-sm leading-6 text-muted">{t('docPage.plansLead')}</p>
        </div>

        <div className="grid gap-3 md:gap-4 sm:grid-cols-2">
          {PLANS_DATA.map((plan) => {
            const isHighlighted = planId === plan.id;
            return (
              <Card
                key={plan.id}
                id={`plan-${plan.id}`}
                className={cn(
                  'flex scroll-mt-32 flex-col justify-between rounded-2xl bg-surface p-5 transition-[border-color,box-shadow] xl:scroll-mt-24',
                  isHighlighted
                    ? 'border-accent ring-2 ring-accent-soft'
                    : plan.popular
                      ? 'border-accent/50'
                      : 'border-stroke',
                )}
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <Badge tone={plan.popular ? 'brand' : (PLAN_TONES[plan.id] ?? 'neutral')}>
                        {plan.badge[language]}
                      </Badge>
                    </div>
                    <span className="text-sm font-semibold text-text tabular-nums">
                      {plan.price[language]}
                    </span>
                  </div>

                  <p className="mt-2 text-[13px] leading-5 text-muted">{plan.desc[language]}</p>

                  <ul className="mt-3.5 flex flex-wrap gap-1.5 text-xs">
                    {[
                      { icon: BoltIcon, text: plan.speed[language] },
                      { icon: RocketIcon, text: plan.priority[language] },
                      { icon: CpuIcon, text: plan.context[language] },
                    ].map(({ icon: Icon, text }) => (
                      <li
                        key={text}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stroke bg-surface-2 px-2 py-1 text-text"
                      >
                        <Icon className="size-3.5 shrink-0 text-accent" />
                        {text}
                      </li>
                    ))}
                  </ul>

                  <ul className="mt-4 space-y-2 text-[13px] leading-5 text-text/85">
                    {plan.features[language].map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 border-t border-stroke pt-4">
                  <Link
                    to={plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`}
                    className={buttonClasses({
                      variant: plan.popular || isHighlighted ? 'primary' : 'outline',
                      size: 'md',
                      fullWidth: true,
                    })}
                  >
                    {plan.id === 'free'
                      ? t('docPage.tryFree')
                      : t('docPage.choosePlan', { plan: plan.name })}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 4. Честное использование (Fair Use) */}
      <section id="fair-use" className={sectionClass}>
        <DocHeading id="fair-use-heading">
          <ShieldIcon className="size-5 text-accent" />
          <span>{t('docPage.fairTitle')}</span>
        </DocHeading>
        <Callout tone="info" className="my-0" title={t('docPage.fairCallout')}>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: t('docPage.fair1Title'),
                text: t('docPage.fair1Text'),
              },
              {
                title: t('docPage.fair2Title'),
                text: t('docPage.fair2Text'),
              },
              {
                title: t('docPage.fair3Title'),
                text: t('docPage.fair3Text'),
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-stroke bg-surface p-3.5">
                <h3 className="mb-1 text-[13px] font-semibold text-text">{item.title}</h3>
                <p className="text-[13px] leading-5 text-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </Callout>
      </section>

      {/* 5. FAQ */}
      <section id="faq" className={cn(sectionClass, 'pb-12')}>
        <DocHeading id="faq-heading">
          <InfoIcon className="size-5 text-accent" />
          <span>{t('docPage.faqTitle')}</span>
        </DocHeading>
        <div className="flex max-w-[76ch] flex-col gap-2.5">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.id}
              className="group rounded-xl border border-stroke bg-surface transition-colors open:bg-surface-2"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3 font-medium text-text select-none [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold">{item.q[language]}</span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="border-t border-stroke px-4 pt-3 pb-4 text-sm leading-relaxed text-muted">
                {item.a[language]}
              </div>
            </details>
          ))}
        </div>
      </section>
    </DocsLayout>
  );
}
