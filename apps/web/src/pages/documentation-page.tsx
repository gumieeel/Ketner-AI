import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    speed: { ru: 'Стандартная скорость', en: 'Standard response speed' },
    priority: { ru: 'Базовый приоритет', en: 'Standard queue priority' },
    context: { ru: 'Базовый контекст', en: 'Basic conversation context' },
    features: {
      ru: [
        'Базовые модели: Ketner Mini, GPT-4o mini',
        'Интеллектуальный режим Best AI (Auto)',
        'Сохранение полной истории диалогов',
        'Синхронизация между всеми устройствами',
      ],
      en: [
        'Basic models: Ketner Mini, GPT-4o mini',
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
    speed: { ru: 'Быстрая скорость', en: 'Fast generation speed' },
    priority: { ru: 'Повышенный приоритет', en: 'Enhanced queue priority' },
    context: { ru: 'Стандартный контекст', en: 'Standard context' },
    features: {
      ru: [
        'Стандартные быстрые модели: DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
        'Быстрая скорость ответа',
        'Безлимитный доступ через режим Auto или ручной выбор',
        'Отсутствие поминутных ограничений',
      ],
      en: [
        'Standard fast models: DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
        'Fast response speed',
        'Unlimited access via Auto mode or manual selection',
        'No per-minute limits',
      ],
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { ru: '$25 / мес', en: '$25 / mo' },
    badge: { ru: 'Топовые модели', en: 'Top models' },
    desc: {
      ru: 'Топовые мировые флагманы (пониженный контекст и скорость по сравнению с Ultra). Включает всё из Plus.',
      en: 'World-class top flagship models (reduced context and speed compared to Ultra). Includes all Plus features.',
    },
    speed: { ru: 'Средняя скорость (пониженная)', en: 'Standard speed (reduced)' },
    priority: { ru: 'Высокий приоритет', en: 'High server priority' },
    context: { ru: 'Пониженный контекст', en: 'Reduced context' },
    popular: true,
    features: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
        'Пониженный контекст и скорость по сравнению с Ultra',
        'Высокий серверный приоритет обработки запросов',
        'Ручной выбор конкретной модели без ограничений',
      ],
      en: [
        'All Plus tier features included',
        'Top models: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
        'Reduced context and speed compared to Ultra tier',
        'High server request priority',
        'Manual model selection without restrictions',
      ],
    },
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: { ru: '$49 / мес (скидка вместо $59)', en: '$49 / mo (discount from $59)' },
    badge: { ru: 'Максимум возможностей', en: 'Maximum power' },
    desc: {
      ru: 'Все топовые модели на 100% мощности, максимальный контекст диалога и наивысший VIP-приоритет.',
      en: 'All top models at 100% capacity, maximum conversation context, and top VIP priority.',
    },
    speed: { ru: 'Максимальная скорость (100%)', en: 'Maximum speed (100%)' },
    priority: { ru: 'Наивысший VIP-приоритет', en: 'Highest VIP priority' },
    context: { ru: 'Максимальный контекст', en: 'Maximum context' },
    features: {
      ru: [
        'Все, что входит в тариф Pro',
        'Все топовые модели: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7, Ketner Next',
        'Максимальный контекст диалога',
        'Использование моделей на 100% без ограничений скорости и контекста',
        'Наивысший VIP-приоритет запросов без ожидания',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'All top models: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7, Ketner Next',
        'Maximum conversation context',
        '100% model usage without speed or context limitations',
        'Top VIP queue priority with zero waiting',
        'Parallel concurrent requests without delays',
      ],
    },
  },
];

export function DocumentationPage() {
  const { language } = useTranslation();
  const location = useLocation();
  const { planId } = useParams<{ planId?: string }>();
  const isEn = language === 'en';

  const sectionIds = ['what-is-ketner', 'how-it-works', 'plans', 'fair-use', 'faq'];
  const activeId = useScrollSpy(sectionIds);

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
      label: isEn ? 'What is Ketner' : 'Что такое Ketner',
      icon: <SparkleIcon className="size-4" />,
    },
    {
      id: 'how-it-works',
      label: isEn ? 'How it works' : 'Как это работает',
      icon: <BoltIcon className="size-4" />,
    },
    {
      id: 'plans',
      label: isEn ? 'Plans & Speeds' : 'Тарифы',
      icon: <StarIcon className="size-4" />,
    },
    {
      id: 'fair-use',
      label: isEn ? 'Fair Use' : 'Честное использование',
      icon: <ShieldIcon className="size-4" />,
    },
    {
      id: 'faq',
      label: isEn ? 'FAQ' : 'Частые вопросы',
      icon: <InfoIcon className="size-4" />,
    },
  ];

  const tocItems = [
    { id: 'what-is-ketner', label: isEn ? 'What is Ketner' : 'Что такое Ketner', level: 2 },
    { id: 'how-it-works', label: isEn ? 'How it works' : 'Как это работает', level: 2 },
    { id: 'plans', label: isEn ? 'Plans & Speeds' : 'Тарифы', level: 2 },
    { id: 'fair-use', label: isEn ? 'Fair Use Policy' : 'Честное использование', level: 2 },
    { id: 'faq', label: isEn ? 'FAQ' : 'Частые вопросы', level: 2 },
  ];

  return (
    <DocsLayout nav={navItems} toc={tocItems} activeId={activeId}>
      {/* Шапка документации */}
      <div className="flex flex-col gap-4 border-b border-stroke pb-6 mb-8">
        <Link
          to="/chat"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          {isEn ? 'Back to chat' : 'Вернуться в чат'}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text">
              {isEn ? 'Ketner AI Documentation' : 'Документация Ketner AI'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {isEn
                ? 'Everything you need to know about Ketner AI, plans, and fair usage.'
                : 'Всё, что нужно знать о Ketner AI, тарифах и политике честного использования.'}
            </p>
          </div>
          <Link to="/pricing">
            <Button variant="primary" size="sm">
              <SparkleIcon className="size-4 mr-1.5" />
              {isEn ? 'View plans' : 'Перейти к тарифам'}
            </Button>
          </Link>
        </div>
      </div>

      {/* 1. Что такое Ketner */}
      <section id="what-is-ketner" className="scroll-mt-24 flex flex-col gap-4 mb-12">
        <DocHeading id="what-is-ketner">
          <SparkleIcon className="size-5 text-accent" />
          <span>{isEn ? 'What is Ketner' : 'Что такое Ketner'}</span>
        </DocHeading>
        <Card className="p-6 bg-surface border-stroke">
          <p className="text-base sm:text-lg font-medium text-text leading-relaxed">
            {isEn
              ? 'One service instead of dozens of subscriptions. Access the world’s best AI models in a single place.'
              : 'Один сервис вместо десятка подписок. Доступ к лучшим AI-моделям мира в одном окне.'}
          </p>
          <p className="mt-3 text-sm text-muted leading-relaxed">
            {isEn
              ? 'Forget about switching between separate accounts, paying $20 to each provider, and managing API keys. Ketner AI brings together OpenAI GPT, Anthropic Claude, and Google Gemini under one seamless, unlimited subscription.'
              : 'Забудьте о переключении между сайтами, раздельной оплате каждому провайдеру и сложных API-ключах. Ketner AI объединяет GPT от OpenAI, Claude от Anthropic и Gemini от Google в едином удобном интерфейсе без подсчёта токенов.'}
          </p>
        </Card>
      </section>

      {/* 2. Как это работает */}
      <section id="how-it-works" className="scroll-mt-24 flex flex-col gap-4 mb-12">
        <DocHeading id="how-it-works">
          <BoltIcon className="size-5 text-accent" />
          <span>{isEn ? 'How it works' : 'Как это работает'}</span>
        </DocHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="flex flex-col gap-2 p-5 border-stroke bg-surface">
            <div className="flex size-7 items-center justify-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent">
              01
            </div>
            <CardTitle className="text-sm font-semibold text-text">
              {isEn ? 'Type your question' : 'Вы пишете вопрос'}
            </CardTitle>
            <CardText className="text-xs text-muted leading-relaxed">
              {isEn
                ? 'Ask for code, translation, writing, analysis, or any creative task in your regular language.'
                : 'Задайте любой вопрос: напишите код, попросите сделать рерайтинг, перевод или сложный анализ.'}
            </CardText>
          </Card>

          <Card className="flex flex-col gap-2 p-5 border-stroke bg-surface">
            <div className="flex size-7 items-center justify-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent">
              02
            </div>
            <CardTitle className="text-sm font-semibold text-text">
              {isEn ? 'We pick the best model' : 'Система подбирает модель'}
            </CardTitle>
            <CardText className="text-xs text-muted leading-relaxed">
              {isEn
                ? 'Smart Auto Router chooses the best model for your task, or you can pick your favorite model manually.'
                : 'Интеллектуальный маршрутизатор мгновенно выбирает лучшую модель (или вы выбираете её вручную).'}
            </CardText>
          </Card>

          <Card className="flex flex-col gap-2 p-5 border-stroke bg-surface">
            <div className="flex size-7 items-center justify-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent">
              03
            </div>
            <CardTitle className="text-sm font-semibold text-text">
              {isEn ? 'You get the answer' : 'Вы получаете ответ'}
            </CardTitle>
            <CardText className="text-xs text-muted leading-relaxed">
              {isEn
                ? 'Streamed instantly to your screen with full markdown, code highlights, and preserved context.'
                : 'Мгновенный потоковый ответ с форматированием, подсветкой кода и сохранением контекста.'}
            </CardText>
          </Card>
        </div>
      </section>

      {/* 3. Тарифные планы и лимиты */}
      <section id="plans" className="scroll-mt-24 flex flex-col gap-6 mb-12">
        <div>
          <DocHeading id="plans">
            <StarIcon className="size-5 text-accent" />
            <span>{isEn ? 'Plans & Speeds' : 'Тарифные планы и лимиты'}</span>
          </DocHeading>
          <p className="text-sm text-muted">
            {isEn
              ? 'Simple transparent plans categorized by speed, priority, and model capabilities — no token math.'
              : 'Понятные тарифы, которые различаются скоростью, приоритетом и глубиной контекста — никаких токенов.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS_DATA.map((plan) => {
            const isHighlighted = planId === plan.id;
            return (
              <Card
                key={plan.id}
                id={`plan-${plan.id}`}
                className={cn(
                  'flex flex-col justify-between p-5 transition-all bg-surface',
                  isHighlighted
                    ? 'border-accent ring-2 ring-accent-soft'
                    : plan.popular
                      ? 'border-accent/60'
                      : 'border-stroke',
                )}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-semibold text-text">{plan.name}</CardTitle>
                      <Badge tone={plan.popular ? 'brand' : 'neutral'}>
                        {plan.badge[language]}
                      </Badge>
                    </div>
                    <span className="font-mono text-sm font-semibold text-text">{plan.price[language]}</span>
                  </div>

                  <p className="mt-2 text-xs text-muted leading-relaxed">
                    {plan.desc[language]}
                  </p>

                  <div className="mt-3.5 flex flex-wrap gap-1.5 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-text border border-stroke">
                      <BoltIcon className="size-3 text-accent" />
                      {plan.speed[language]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-text border border-stroke">
                      <RocketIcon className="size-3 text-accent" />
                      {plan.priority[language]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-text border border-stroke">
                      <CpuIcon className="size-3 text-accent" />
                      {plan.context[language]}
                    </span>
                  </div>

                  <ul className="mt-4 space-y-1.5 text-xs text-text/80">
                    {plan.features[language].map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 pt-3.5 border-t border-stroke">
                  <Link to={plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`}>
                    <Button
                      variant={plan.popular || isHighlighted ? 'primary' : 'outline'}
                      size="sm"
                      className="w-full"
                    >
                      {plan.id === 'free'
                        ? isEn
                          ? 'Try Free'
                          : 'Попробовать бесплатно'
                        : isEn
                          ? `Choose ${plan.name}`
                          : `Выбрать ${plan.name}`}
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 4. Честное использование (Fair Use) */}
      <section id="fair-use" className="scroll-mt-24 flex flex-col gap-4 mb-12">
        <DocHeading id="fair-use">
          <ShieldIcon className="size-5 text-accent" />
          <span>{isEn ? 'Fair Use Policy' : 'Честное использование (Fair Use)'}</span>
        </DocHeading>
        <Callout
          tone="info"
          title={
            isEn
              ? '“Unlimited” means normal human usage without restrictions'
              : '«Безлимит» означает нормальное использование человеком без искусственных рамок'
          }
        >
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-surface p-3 border border-stroke">
              <h4 className="font-semibold text-xs text-text mb-1">
                {isEn ? '1. For real people' : '1. Для реальных людей'}
              </h4>
              <p className="text-[11px] text-muted leading-relaxed">
                {isEn
                  ? 'Chat as much as you need for coding, writing, research, and learning.'
                  : 'Общайтесь столько, сколько требуется для вашей работы, учёбы и проектов.'}
              </p>
            </div>
            <div className="rounded-md bg-surface p-3 border border-stroke">
              <h4 className="font-semibold text-xs text-text mb-1">
                {isEn ? '2. Protection from bots' : '2. Защита от спам-ботов'}
              </h4>
              <p className="text-[11px] text-muted leading-relaxed">
                {isEn
                  ? 'Fair Use prevents automated web scraping and DDOS floods so servers stay fast for everyone.'
                  : 'Правила защищают серверы от автоматического парсинга, спам-ботов и перегрузок.'}
              </p>
            </div>
            <div className="rounded-md bg-surface p-3 border border-stroke">
              <h4 className="font-semibold text-xs text-text mb-1">
                {isEn ? '3. Invisible and smooth' : '3. Без внезапных блокировок'}
              </h4>
              <p className="text-[11px] text-muted leading-relaxed">
                {isEn
                  ? 'If you use Ketner AI normally, you will never see any limits or roadblocks.'
                  : 'При обычном использовании вы никогда не столкнётесь с блокировками. Всё работает плавно.'}
              </p>
            </div>
          </div>
        </Callout>
      </section>

      {/* 5. FAQ */}
      <section id="faq" className="scroll-mt-24 flex flex-col gap-4 pb-12">
        <DocHeading id="faq">
          <InfoIcon className="size-5 text-accent" />
          <span>{isEn ? 'Frequently Asked Questions' : 'Часто задаваемые вопросы (FAQ)'}</span>
        </DocHeading>
        <div className="flex flex-col gap-2.5">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.id}
              className="group rounded-md border border-stroke bg-surface transition-colors open:bg-surface-2"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 font-medium text-text select-none list-none [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold">{item.q[language]}</span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 pt-1 text-xs sm:text-sm text-muted leading-relaxed border-t border-stroke mt-1">
                {item.a[language]}
              </div>
            </details>
          ))}
        </div>
      </section>
    </DocsLayout>
  );
}
