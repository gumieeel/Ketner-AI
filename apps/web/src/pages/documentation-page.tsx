import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeftIcon, CheckIcon, SparkleIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface PlanCardInfo {
  id: string;
  name: string;
  price: string;
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
    price: '0 ₽ / $0',
    badge: { ru: 'Попробуйте AI', en: 'Try AI' },
    desc: {
      ru: 'Идеально для первого знакомства, быстрых вопросов и повседневных задач.',
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
    price: '990 ₽ / $9.99',
    badge: { ru: 'Безлимитный AI', en: 'Unlimited AI' },
    desc: {
      ru: 'Безлимитное общение с AI для повседневной работы, учёбы и генерации текстов.',
      en: 'Unlimited AI chat for daily workflows, study, and text generation.',
    },
    speed: { ru: 'Обычная скорость', en: 'Normal generation speed' },
    priority: { ru: 'Повышенный приоритет', en: 'Enhanced queue priority' },
    context: { ru: 'Расширенный контекст', en: 'Extended context' },
    features: {
      ru: [
        'Безлимитный доступ ко всем моделям через Auto',
        'Отсутствие поминутных ограничений',
        'Автоматический выбор оптимальной модели',
        'Расширенное окно памяти для длинных диалогов',
      ],
      en: [
        'Unlimited access to all models via Auto',
        'No per-minute interruptions',
        'Automatic selection of the best model',
        'Extended memory window for long conversations',
      ],
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '1 990 ₽ / $19.99',
    badge: { ru: 'Быстрее и умнее', en: 'Faster & smarter' },
    desc: {
      ru: 'Все мировые флагманы в одной подписке. Для разработчиков, аналитиков и авторов.',
      en: 'All world flagship models in one subscription. For developers, analysts, and creators.',
    },
    speed: { ru: 'Высокая скорость', en: 'High generation speed' },
    priority: { ru: 'Высокий приоритет', en: 'High server priority' },
    context: { ru: 'Глубокий контекст', en: 'Deep multi-turn context' },
    features: {
      ru: [
        'Все флагманы: GPT-6 Astra, Claude 3.5 Sonnet, Gemini Pro',
        'Ручной выбор конкретной модели без ограничений',
        'Высокий серверный приоритет даже в часы пик',
        'Глубокий анализ кода, логики и сложных концепций',
      ],
      en: [
        'All flagships: GPT-6 Astra, Claude 3.5 Sonnet, Gemini Pro',
        'Manual model selection without restrictions',
        'High server priority even during peak hours',
        'Deep analysis of code, logic, and complex concepts',
      ],
    },
    popular: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '2 499 ₽ / $39.99',
    badge: { ru: 'Максимальная мощность', en: 'Maximum performance' },
    desc: {
      ru: 'Максимальная производительность для профессионалов, команд и сложных проектов.',
      en: 'Peak performance for power users, teams, and demanding projects.',
    },
    speed: { ru: 'Максимальная скорость', en: 'Maximum dedicated throughput' },
    priority: { ru: 'Выделенный VIP-приоритет', en: 'Dedicated VIP priority' },
    context: { ru: 'Огромный контекст', en: 'Massive project context' },
    features: {
      ru: [
        'Выделенные серверные мощности для мгновенных ответов',
        'Наивысший VIP-приоритет в очереди обработки',
        'Огромный контекст для загрузки кода и больших документов',
        'Параллельные сессии без задержек и ожидания',
      ],
      en: [
        'Dedicated server capacity for instantaneous answers',
        'Highest VIP queue priority',
        'Massive context for analyzing full codebases and documents',
        'Parallel sessions without delays or waiting',
      ],
    },
  },
];

interface FaqItem {
  q: { ru: string; en: string };
  a: { ru: string; en: string };
}

const FAQ_LIST: FaqItem[] = [
  {
    q: {
      ru: 'Это правда безлимитно?',
      en: 'Is it really unlimited?',
    },
    a: {
      ru: 'Да! Для реального человека в рамках платных тарифов нет ограничений по количеству сообщений или токенов. Вы можете комфортно решать рабочие, учебные и творческие задачи каждый день без подсчёта кредитов.',
      en: 'Yes! For human usage on paid tiers, there are no artificial token counters or message caps. You can tackle your work, study, and creative tasks every day without calculating credits.',
    },
  },
  {
    q: {
      ru: 'Какие модели доступны в Ketner AI?',
      en: 'Which AI models are included in Ketner AI?',
    },
    a: {
      ru: 'Вам доступны лучшие флагманы мира: OpenAI (GPT-6 Astra, GPT-4o), Anthropic (Claude 3.5 Sonnet), Google (Gemini 2.5 Pro / Flash), а также оптимизированная внутренняя модель Ketner Mini. Мы постоянно добавляем новые модели сразу после их официального релиза.',
      en: 'You get access to top global flagships: OpenAI (GPT-6 Astra, GPT-4o), Anthropic (Claude 3.5 Sonnet), Google (Gemini 2.5 Pro / Flash), and optimized Ketner Mini. New state-of-the-art models are added as soon as they release.',
    },
  },
  {
    q: {
      ru: 'Почему ответы приходят так быстро?',
      en: 'Why are responses so fast?',
    },
    a: {
      ru: 'Наша система интеллектуальной маршрутизации анализирует ваш вопрос и направляет его к наиболее быстрому и точному провайдеру, кэширует частые запросы и использует параллельные соединения с облачными кластерами AI.',
      en: 'Our smart routing system classifies your query in milliseconds, sends it to the most efficient provider, caches frequent answers, and connects to high-speed cloud clusters.',
    },
  },
  {
    q: {
      ru: 'Могу ли я выбрать модель самостоятельно?',
      en: 'Can I choose the model manually?',
    },
    a: {
      ru: 'Конечно. По умолчанию включён режим «Best AI (Auto)», в котором система сама подбирает идеальную модель под сложность вопроса. Но в любой момент в выпадающем меню чата вы можете переключиться на нужную модель вручную.',
      en: 'Absolutely. By default, "Best AI (Auto)" chooses the best model for the task. However, you can click the model picker at any time to explicitly pick GPT, Claude, or Gemini.',
    },
  },
  {
    q: {
      ru: 'Чем Ketner AI отличается от ChatGPT Plus?',
      en: 'How does Ketner AI differ from ChatGPT Plus?',
    },
    a: {
      ru: 'Подписка ChatGPT Plus стоит $20 и привязывает вас только к одной компании (OpenAI). В Ketner AI за одну доступную подписку вы получаете сразу все ведущие нейросети мира: GPT, Claude и Gemini в едином окне, экономя десятки тысяч рублей на отдельных подписках.',
      en: 'A standard ChatGPT Plus subscription costs $20 and locks you into OpenAI only. With Ketner AI, a single subscription gives you all premier world-class models — GPT, Claude, and Gemini — in one unified interface, saving you time and hundreds of dollars.',
    },
  },
];

export function DocumentationPage() {
  const { language } = useTranslation();
  const location = useLocation();
  const isEn = language === 'en';

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.replace('#', '');
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.hash]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 py-8 md:px-8">
      {/* Шапка */}
      <div className="flex flex-col gap-4 border-b border-stroke/20 pb-8">
        <Link
          to="/chat"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors"
        >
          <ArrowLeftIcon className="text-sm" />
          {isEn ? 'Back to chat' : 'Вернуться в чат'}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-text">
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
              <SparkleIcon className="text-base" />
              {isEn ? 'View plans' : 'Перейти к тарифам'}
            </Button>
          </Link>
        </div>

        {/* Быстрая навигация */}
        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href="#what-is-ketner"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            {isEn ? '✨ What is Ketner' : '✨ Что такое Ketner'}
          </a>
          <a
            href="#how-it-works"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            {isEn ? '⚡ How it works' : '⚡ Как это работает'}
          </a>
          <a
            href="#plans"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            {isEn ? '💎 Plans & Speeds' : '💎 Тарифные планы и лимиты'}
          </a>
          <a
            href="#fair-use"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            {isEn ? '🛡️ Fair Use' : '🛡️ Честное использование (Fair Use)'}
          </a>
          <a
            href="#faq"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            {isEn ? '❓ FAQ' : '❓ Часто задаваемые вопросы'}
          </a>
        </div>
      </div>

      {/* 1. Что такое Ketner */}
      <section id="what-is-ketner" className="scroll-mt-20 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <h2 className="text-2xl font-bold tracking-tight text-text">
            {isEn ? 'What is Ketner' : 'Что такое Ketner'}
          </h2>
        </div>
        <Card className="p-6 md:p-8 bg-surface border-stroke/30">
          <p className="text-lg md:text-xl font-medium text-text leading-relaxed">
            {isEn
              ? 'One service instead of dozens of subscriptions. Access the world’s best AI models in a single place.'
              : 'Один сервис вместо десятка подписок. Доступ к лучшим AI-моделям мира в одном окне.'}
          </p>
          <p className="mt-3 text-sm md:text-base text-muted leading-relaxed">
            {isEn
              ? 'Forget about switching between separate accounts, paying $20 to each provider, and managing API keys. Ketner AI brings together OpenAI GPT, Anthropic Claude, and Google Gemini under one seamless, unlimited subscription.'
              : 'Забудьте о переключении между сайтами, раздельной оплате каждому провайдеру и сложных API-ключах. Ketner AI объединяет GPT от OpenAI, Claude от Anthropic и Gemini от Google в едином удобном интерфейсе без подсчёта токенов.'}
          </p>
        </Card>
      </section>

      {/* 2. Как это работает */}
      <section id="how-it-works" className="scroll-mt-20 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <h2 className="text-2xl font-bold tracking-tight text-text">
            {isEn ? 'How it works' : 'Как это работает'}
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-2 p-6 border-stroke/25">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
              1
            </div>
            <CardTitle className="text-base text-text">
              {isEn ? 'Type your question' : 'Вы пишете вопрос'}
            </CardTitle>
            <CardText className="text-xs md:text-sm text-muted">
              {isEn
                ? 'Ask for code, translation, writing, analysis, or any creative task in your regular language.'
                : 'Задайте любой вопрос: напишите код, попросите сделать рерайтинг, перевод или сложный анализ.'}
            </CardText>
          </Card>

          <Card className="flex flex-col gap-2 p-6 border-stroke/25">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
              2
            </div>
            <CardTitle className="text-base text-text">
              {isEn ? 'We pick the best model' : 'Система подбирает модель'}
            </CardTitle>
            <CardText className="text-xs md:text-sm text-muted">
              {isEn
                ? 'Smart Auto Router chooses the best model for your task, or you can pick your favorite model manually.'
                : 'Интеллектуальный маршрутизатор мгновенно выбирает лучшую модель (или вы выбираете её вручную).'}
            </CardText>
          </Card>

          <Card className="flex flex-col gap-2 p-6 border-stroke/25">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
              3
            </div>
            <CardTitle className="text-base text-text">
              {isEn ? 'You get the answer' : 'Вы получаете ответ'}
            </CardTitle>
            <CardText className="text-xs md:text-sm text-muted">
              {isEn
                ? 'Streamed instantly to your screen with full markdown, code highlights, and preserved context.'
                : 'Мгновенный потоковый ответ с форматированием, подсветкой кода и сохранением контекста.'}
            </CardText>
          </Card>
        </div>
      </section>

      {/* 3. Тарифные планы и лимиты */}
      <section id="plans" className="scroll-mt-20 flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">💎</span>
            <h2 className="text-2xl font-bold tracking-tight text-text">
              {isEn ? 'Plans & Speeds' : 'Тарифные планы и лимиты'}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            {isEn
              ? 'Simple transparent plans categorized by speed, priority, and model capabilities — no token math.'
              : 'Понятные тарифы, которые различаются скоростью, приоритетом и глубиной контекста — никаких токенов.'}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {PLANS_DATA.map((plan) => (
            <Card
              key={plan.id}
              className={cn(
                'flex flex-col justify-between p-6 transition-all',
                plan.popular
                  ? 'border-accent bg-gradient-to-b from-accent/5 via-surface to-surface shadow-md'
                  : 'border-stroke/25',
              )}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl font-bold text-text">{plan.name}</CardTitle>
                    <Badge tone={plan.popular ? 'brand' : 'neutral'}>
                      {plan.badge[language]}
                    </Badge>
                  </div>
                  <span className="text-lg font-bold text-text">{plan.price}</span>
                </div>

                <p className="mt-2 text-xs md:text-sm text-muted leading-relaxed">
                  {plan.desc[language]}
                </p>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-canvas px-2.5 py-1 text-text/90 border border-stroke/20">
                    ⚡ {plan.speed[language]}
                  </span>
                  <span className="rounded bg-canvas px-2.5 py-1 text-text/90 border border-stroke/20">
                    🚀 {plan.priority[language]}
                  </span>
                  <span className="rounded bg-canvas px-2.5 py-1 text-text/90 border border-stroke/20">
                    🧠 {plan.context[language]}
                  </span>
                </div>

                <ul className="mt-5 space-y-2 text-xs md:text-sm text-text/80">
                  {plan.features[language].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 shrink-0 text-accent text-sm" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-stroke/15">
                <Link to={plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`}>
                  <Button
                    variant={plan.popular ? 'primary' : 'outline'}
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
          ))}
        </div>
      </section>

      {/* 4. Fair Use */}
      <section id="fair-use" className="scroll-mt-20 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🛡️</span>
          <h2 className="text-2xl font-bold tracking-tight text-text">
            {isEn ? 'Fair Use Policy' : 'Честное использование (Fair Use)'}
          </h2>
        </div>
        <Card className="p-6 md:p-8 bg-surface border-stroke/30">
          <p className="text-base md:text-lg font-medium text-text leading-relaxed">
            {isEn
              ? '“Unlimited” means normal human usage without restrictions.'
              : '«Безлимит» означает нормальное использование человеком без искусственных рамок.'}
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-canvas p-4 border border-stroke/20">
              <h4 className="font-semibold text-sm text-text">
                {isEn ? '1. For real people' : '1. Для реальных людей'}
              </h4>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                {isEn
                  ? 'Chat as much as you need for coding, writing, research, and learning.'
                  : 'Общайтесь столько, сколько требуется для вашей работы, учёбы и проектов.'}
              </p>
            </div>
            <div className="rounded-xl bg-canvas p-4 border border-stroke/20">
              <h4 className="font-semibold text-sm text-text">
                {isEn ? '2. Protection from bots' : '2. Защита от спам-ботов'}
              </h4>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                {isEn
                  ? 'Fair Use prevents automated web scraping and DDOS floods so servers stay fast for everyone.'
                  : 'Правила защищают серверы от автоматического парсинга, спам-ботов и перегрузок.'}
              </p>
            </div>
            <div className="rounded-xl bg-canvas p-4 border border-stroke/20">
              <h4 className="font-semibold text-sm text-text">
                {isEn ? '3. Invisible and smooth' : '3. Без внезапных блокировок'}
              </h4>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                {isEn
                  ? 'If you use Ketner AI normally, you will never see any limits or roadblocks.'
                  : 'При обычном использовании вы никогда не столкнётесь с блокировками. Всё работает плавно.'}
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* 5. FAQ */}
      <section id="faq" className="scroll-mt-20 flex flex-col gap-4 pb-12">
        <div className="flex items-center gap-2">
          <span className="text-lg">❓</span>
          <h2 className="text-2xl font-bold tracking-tight text-text">
            {isEn ? 'Frequently Asked Questions' : 'Часто задаваемые вопросы (FAQ)'}
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {FAQ_LIST.map((item) => (
            <Card key={item.q.en} className="flex flex-col gap-2 p-5 border-stroke/25">
              <CardTitle className="text-sm md:text-base font-semibold text-text">
                {item.q[language]}
              </CardTitle>
              <CardText className="text-xs md:text-sm text-muted leading-relaxed">
                {item.a[language]}
              </CardText>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
