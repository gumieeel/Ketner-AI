import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  ShieldIcon,
  SparkleIcon,
  StarIcon,
} from '@/components/icons';
import { Callout, DocHeading, DocsLayout, useScrollSpy } from '@/components/docs';
import { PackCards } from '@/components/pricing/pack-cards';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { FAQ_ITEMS } from '@/features/content/faq';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import planFacts from '@/features/billing/plan-facts.json';
import { PACK_VALID_DAYS, TRIAL } from '@/features/billing/plans';
import { maxCompareModels } from '@/features/chat/compare-policy';
import { appHomePath } from '@/lib/product-switches';

type Localized = { ru: string; en: string };

interface LevelCard {
  id: 'free' | 'credits';
  title: Localized;
  badge: Localized;
  desc: Localized;
  features: { ru: string[]; en: string[] };
}

const fmt = (value: number, language: 'ru' | 'en'): string =>
  value.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');

const free = planFacts.levels.free;
const bought = planFacts.levels.credits;

/** Два уровня доступа вместо четырёх тарифов; числа — из plan-facts.json, который тест сверяет с сервером. */
const LEVEL_CARDS: LevelCard[] = [
  {
    id: 'free',
    title: { ru: 'Пробные кредиты', en: 'Trial credits' },
    badge: { ru: 'Бесплатно', en: 'Free' },
    desc: {
      ru: `Каждому новому аккаунту — ${fmt(TRIAL.credits, 'ru')} кредитов один раз, на ${TRIAL.days} дней. Все модели открыты, пока хватает кредитов.`,
      en: `Every new account gets ${fmt(TRIAL.credits, 'en')} credits once, valid for ${TRIAL.days} days. All models are open while credits last.`,
    },
    features: {
      ru: [
        `Любая модель, режим Max и сравнение ответов до ${maxCompareModels('free')} моделей`,
        `${free.messagesPerDay} сообщений в сутки, ${free.concurrency} запрос одновременно`,
        `Картинки: до ${free.imagesPerDay['flux-schnell']} в сутки на модель`,
        `Ketner Code: ${free.codeRunsPerDay} запусков в сутки`,
        'Когда кредиты кончились, отвечает бесплатная модель',
      ],
      en: [
        `Any model, Max mode and comparing up to ${maxCompareModels('free')} models`,
        `${free.messagesPerDay} messages a day, ${free.concurrency} request at once`,
        `Images: up to ${free.imagesPerDay['flux-schnell']} a day per model`,
        `Ketner Code: ${free.codeRunsPerDay} runs a day`,
        'When credits run out, a free model answers',
      ],
    },
  },
  {
    id: 'credits',
    title: { ru: 'После покупки пакета', en: 'After buying a pack' },
    badge: { ru: `${PACK_VALID_DAYS} дней`, en: `${PACK_VALID_DAYS} days` },
    desc: {
      ru: `Пакет оплачивается один раз, подписки нет. Пока остаются купленные кредиты, технические лимиты намного выше.`,
      en: `A pack is paid once, with no subscription. While purchased credits remain, the technical limits are much higher.`,
    },
    features: {
      ru: [
        `Сравнение ответов до ${maxCompareModels('credits')} моделей`,
        `${fmt(bought.messagesPerDay, 'ru')} сообщений в сутки, ${bought.concurrency} запросов одновременно`,
        `Картинки: до ${bought.imagesPerDay['flux-schnell']} в сутки на модель`,
        `Ketner Code: ${bought.codeRunsPerDay} запусков в сутки`,
        'API-ключи для редакторов и своих программ',
      ],
      en: [
        `Comparing up to ${maxCompareModels('credits')} models`,
        `${fmt(bought.messagesPerDay, 'en')} messages a day, ${bought.concurrency} requests at once`,
        `Images: up to ${bought.imagesPerDay['flux-schnell']} a day per model`,
        `Ketner Code: ${bought.codeRunsPerDay} runs a day`,
        'API keys for editors and your own programs',
      ],
    },
  },
];

export function DocumentationPage() {
  const { t, language } = useTranslation();
  const location = useLocation();
  const { planId } = useParams<{ planId?: string }>();

  const activeId = useScrollSpy(['what-is-ketner', 'how-it-works', 'plans', 'fair-use', 'faq']);

  useEffect(() => {
    if (planId) {
      // Ссылки на прежние тарифы (/docs/plans/pro) ведут к разделу про кредиты.
      const el = document.getElementById('plans');
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
          to={appHomePath()}
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

        <div className="grid gap-3 sm:grid-cols-2 md:gap-4">
          {LEVEL_CARDS.map((card) => (
            <Card
              key={card.id}
              id={`plan-${card.id}`}
              className={cn(
                'flex flex-col justify-between rounded-2xl bg-surface p-5',
                card.id === 'credits' ? 'border-accent/50' : 'border-stroke',
              )}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{card.title[language]}</CardTitle>
                  <Badge tone={card.id === 'credits' ? 'brand' : 'neutral'}>
                    {card.badge[language]}
                  </Badge>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-muted">{card.desc[language]}</p>
                <ul className="mt-4 space-y-2 text-[13px] leading-5 text-text/85">
                  {card.features[language].map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}
        </div>

        <PackCards variant="compact" />
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
