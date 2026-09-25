import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeftIcon, CheckIcon, SparkleIcon, TerminalIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import type { PlanId } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface PlanDetail {
  id: PlanId;
  title: string;
  price: string;
  badge: string;
  description: string;
  limitDetails: string;
  models: string[];
  features: string[];
  useCases: string[];
  popular?: boolean;
}

const PLAN_DETAILS: PlanDetail[] = [
  {
    id: 'free',
    title: 'Free',
    price: '0 ₽',
    badge: 'Базовый',
    description:
      'Идеально для знакомства с платформой, базовых вопросов и повседневных поисковых задач.',
    limitDetails: '3 сообщения в час (счётчик обновляется каждый час).',
    models: ['Gemini 3.8 Flash — быстрая и отзывчивая модель для повседневных диалогов.'],
    features: [
      'Полная история диалогов и сохранение сессий',
      'Базовое контекстное окно (20 сообщений)',
      'Синхронизация между устройствами',
      'Без необходимости привязки банковской карты',
    ],
    useCases: [
      'Быстрые консультации и справка',
      'Простые переводы и редактирование заметок',
      'Знакомство с возможностями Ketner AI',
    ],
  },
  {
    id: 'gpt-pro',
    title: 'GPT Pro',
    price: '1 199 ₽',
    badge: 'OpenAI Family',
    description:
      'Полный спектр флагманских моделей OpenAI: от передовых рассуждений GPT-6 Astra до скоростной Luna и математического o3-mini.',
    limitDetails:
      '5-часовой плавающий лимит (rolling limit): объём запросов восстанавливается непрерывно каждые 5 часов с момента использования.',
    models: [
      'GPT-6 Astra — непревзойдённый флагман с глубоким многоуровневым рассуждением',
      'GPT-6 Luna — высокоскоростная версия для автономных агентов и оперативного кода',
      'GPT-5.5 Omni — мультимодальный эксперт для текстов, данных и структурирования',
      'o3-mini — рассуждающая модель для сложных алгоритмов и математических доказательств',
    ],
    features: [
      'Расширенное контекстное окно до 120 сообщений',
      'Приоритет в очереди вычислений в часы пиковой нагрузки',
      'Поддержка углублённого режима chain-of-thought',
      'Ранний доступ к обновлениям архитектуры GPT-6',
    ],
    useCases: [
      'Проектирование сложных архитектур программных систем',
      'Аналитическая работа и синтез масштабных отчётов',
      'Генерация и дебаг продакшен-кода на Python, TypeScript, Rust, Go',
    ],
  },
  {
    id: 'claude-pro',
    title: 'Claude Pro',
    price: '1 199 ₽',
    badge: 'Anthropic Family',
    description:
      'Золотой стандарт разработки, рефакторинга кода и безупречной стилистики с моделями Claude 4.5 и семейством Fable.',
    limitDetails:
      '5-часовой плавающий лимит (rolling limit): прозрачный учёт запросов с непрерывным пополнением.',
    models: [
      'Claude 4.5 Sonnet — признанный лидер в анализе кода, архитектуре и логических связях',
      'Claude 4.5 Opus — мощнейший синтез для сложных научных и юридических задач',
      'Fable 5.5 — специализированная модель для точного следования многостраничным инструкциям',
      'Fable 5.1 Haiku — моментальный отклик и лёгкий контекстный анализ',
    ],
    features: [
      'Глубокий статический анализ и понимание кодовой базы',
      'Точнейшее соблюдение системных промптов и ограничений',
      'Улучшенное понимание форматирования Markdown и JSON-схем',
      'Приоритетная пропускная способность серверов',
    ],
    useCases: [
      'Крупномасштабный рефакторинг и аудит безопасности кода',
      'Написание технической документации и архитектурных RFC',
      'Решение нестандартных инженерных задач с комплексными зависимостями',
    ],
  },
  {
    id: 'gemini-pro',
    title: 'Gemini Pro',
    price: '1 199 ₽',
    badge: 'Google Family',
    description:
      'Колоссальное контекстное окно до 2 000 000+ токенов и передовые мультимодальные вычисления Google.',
    limitDetails:
      '5-часовой плавающий лимит (rolling limit): высокий объём токенов с непрерывным пополнением баланса.',
    models: [
      'Gemini 3.8 Pro — рекордное контекстное окно 2M+ токенов для целых репозиториев и книг',
      'Gemini 3.5 Ultra — максимальная глубина знаний и рассуждений',
      'Gemini Flash Thinking 2.5 — прозрачная генерация логических цепочек с открытым ходом мыслей',
    ],
    features: [
      'Возможность передавать огромные дампы кода и архивы документов',
      'Быстрый мультимодальный анализ данных и схем',
      'Интегрированные возможности верификации фактов',
      'Гарантированная доступность в пиковые часы',
    ],
    useCases: [
      'Анализ монорепозиториев целиком без обрезки контекста',
      'Исследование массивных наборов документации и научных статей',
      'Быстрый брейншторминг с проверкой гипотез в реальном времени',
    ],
  },
  {
    id: 'ultra',
    title: 'Ultra',
    price: '2 499 ₽',
    badge: 'All-Inclusive · No Limits',
    popular: true,
    description:
      'Абсолютная свобода: доступ ко всем семействам моделей без лимитов. Бесконечный кодинг для профессионалов и команд.',
    limitDetails:
      'Без лимитов (Unlimited): отсутствие 5-часовых задержек и ограничений на количество сообщений. Бесконечный кодинг 24/7.',
    models: [
      'Все флагманы GPT: GPT-6 Astra, GPT-6 Luna, GPT-5.5 Omni, o3-mini',
      'Все флагманы Claude: Claude 4.5 Sonnet, Claude 4.5 Opus, Fable 5.5, Fable 5.1 Haiku',
      'Все флагманы Gemini: Gemini 3.8 Pro (2M контекст), Gemini 3.5 Ultra, Flash Thinking 2.5',
    ],
    features: [
      'Полный безлимит сообщений — работайте сутками без кулдаунов',
      'Максимальное контекстное окно (до 500 сообщений в истории активного диалога)',
      'Наивысший приоритет GPU-кластера (Dedicated High-Priority Queue)',
      'Мгновенное переключение между моделями разных провайдеров в одном чате',
      'Персональная инженерная поддержка и ранний доступ ко всем новым моделям',
    ],
    useCases: [
      'Непрерывная разработка и парное программирование по 10–12 часов в день',
      'Сравнение ответов разных топовых моделей на одном и том же кейсе',
      'Профессиональная разработка enterprise-уровня без ограничений по времени',
    ],
  },
];

const FAQ_ITEMS = [
  {
    q: 'Что такое 5-часовой плавающий лимит (rolling limit)?',
    a: 'В отличие от традиционных суточных ограничений, которые сбрасываются раз в сутки в полночь, 5-часовое скользящее окно оценивает вашу активность за последние 5 часов. Каждое отправленное сообщение освобождает свой слот ровно через 5 часов после отправки. Это обеспечивает равномерный доступ в течение рабочего дня без резких блокировок.',
  },
  {
    q: 'Чем Ultra отличается от специализированных Pro-тарифов?',
    a: 'Тарифы GPT Pro, Claude Pro и Gemini Pro дают доступ к моделям одного конкретного провайдера с 5-часовым плавающим лимитом по выгодной цене 1 199 ₽/мес. Тариф Ultra (2 499 ₽/мес) объединяет все три семейства (GPT-6, Claude 4.5, Gemini 3.8) в один аккаунт и полностью снимает лимиты, позволяя вести непрерывный кодинг без пауз.',
  },
  {
    q: 'Могу ли я сменить тариф в любое время?',
    a: 'Да! Вы можете перейти на любой тариф в любой момент на странице тарифов или в настройках профиля. Новый тариф активируется мгновенно.',
  },
  {
    q: 'Как работает режим автовыбора модели (Auto Mode)?',
    a: 'Auto Mode анализирует специфику вашей задачи (код, математика, архитектурный анализ, перевод, текст) и направляет запрос в наиболее подходящую модель среди доступных в вашем тарифе. При этом, если вы вручную выбрали конкретную модель (например, GPT-6 Astra или Claude 4.5 Sonnet), система гарантированно использует именно её и никогда не подменяет на дешёвые аналоги.',
  },
  {
    q: 'Что такое политика добросовестного использования (Fair Use)?',
    a: 'Политика Fair Use защищает стабильность и скорость работы платформы для всех пользователей. Она предотвращает перегрузку серверов скриптами и автоматизированным спамом через мягкое управление параллельными запросами и скользящими окнами активности. При обычном профессиональном использовании лимиты не ощущаются.',
  },
  {
    q: 'Как работает лимит на бесплатном тарифе Free?',
    a: 'На тарифе Free доступно 3 сообщения в час с моделью Gemini 3.8 Flash. Счётчик сообщений восстанавливается каждый час. Этого достаточно для быстрых вопросов и тестирования платформы.',
  },
  {
    q: 'Безопасны ли мои диалоги и код?',
    a: 'Все запросы передаются по защищённому каналу с шифрованием TLS/HTTPS. Ваши промпты и код не используются для дообучения сторонних моделей и хранятся исключительно в изолированном защищённом профиле аккаунта.',
  },
];

export function DocumentationPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { planId } = useParams<{ planId?: string }>();

  // Плавный скролл к якорю при открытии по хэшу или параметру URL
  useEffect(() => {
    const targetId = planId ? `plan-${planId}` : location.hash.replace('#', '');
    if (targetId) {
      const element = document.getElementById(targetId);
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [location.hash, planId]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 md:px-8 animate-fade-in">
      {/* Шапка документации */}
      <div className="flex flex-col gap-4 border-b border-stroke/20 pb-8">
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <Link to="/pricing" className="hover:text-text transition-colors flex items-center gap-1">
            <ArrowLeftIcon className="text-sm" />
            {t('docs.backToPricing')}
          </Link>
          <span>/</span>
          <span className="text-text">{t('docs.title')}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-text md:text-4xl">
              {t('docs.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {t('docs.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/api-docs">
              <Button variant="outline" size="md">
                <TerminalIcon className="text-base" />
                {t('nav.apiDocs')}
              </Button>
            </Link>
            <Link to="/pricing">
              <Button variant="primary" size="md">
                <SparkleIcon className="text-base" />
                {t('nav.upgrade')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Быстрая навигация */}
        <div className="mt-4 flex flex-wrap gap-2 pt-2">
          <Link
            to="/api-docs"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-accent/40 bg-accent/10 text-accent hover:opacity-90 transition-all flex items-center gap-1.5"
          >
            <TerminalIcon className="text-xs" />
            Подключение агента к машине (API)
          </Link>
          {PLAN_DETAILS.map((p) => (
            <a
              key={p.id}
              href={`#plan-${p.id}`}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 transition-all hover:border-accent hover:text-accent',
                p.popular ? 'bg-accent/10 border-accent/40 text-accent' : 'bg-surface text-muted',
              )}
            >
              {p.title} ({p.price})
            </a>
          ))}
          <a
            href="#limits-guide"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            ⏱️ Политика лимитов
          </a>
          <a
            href="#models-specs"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            🧠 Спецификации моделей
          </a>
          <a
            href="#matrix"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            📊 Сравнение
          </a>
          <a
            href="#faq"
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-stroke/20 bg-surface text-muted hover:border-accent hover:text-accent transition-all"
          >
            ❓ FAQ
          </a>
        </div>
      </div>

      {/* Раздел 1: Карточки тарифов с подробным описанием */}
      <section className="flex flex-col gap-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text">
            {t('docs.plansTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Детальная спецификация каждого тарифа, лимиты запросов и доступные модели.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          {PLAN_DETAILS.map((plan) => (
            <div
              key={plan.id}
              id={`plan-${plan.id}`}
              className={cn(
                'scroll-mt-20 rounded-2xl border p-6 transition-all duration-300 md:p-8 card-interactive',
                plan.popular
                  ? 'border-accent bg-gradient-to-b from-accent/5 via-surface to-surface shadow-lg'
                  : 'border-stroke/25 bg-surface',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stroke/15 pb-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-bold tracking-tight text-text">{plan.title}</h3>
                    <Badge tone={plan.popular ? 'brand' : 'neutral'}>{plan.badge}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300 max-w-2xl leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="text-right">
                    <p className="text-3xl font-bold text-text">
                      {plan.price}
                      <span className="ml-1 text-sm font-normal text-muted">/ месяц</span>
                    </p>
                  </div>
                  <Link to={plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`}>
                    <Button variant={plan.popular ? 'primary' : 'outline'} size="sm">
                      {plan.id === 'free' ? 'Начать бесплатно' : `Подключить ${plan.title}`}
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Лимиты и архитектура */}
              <div className="mt-6 grid gap-6 md:grid-cols-3">
                <div className="flex flex-col gap-2 rounded-xl bg-canvas/60 p-4 border border-stroke/15">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    ⏱️ Политика лимитов
                  </h4>
                  <p className="text-sm font-medium text-text leading-snug">{plan.limitDetails}</p>
                </div>

                <div className="flex flex-col gap-2 rounded-xl bg-canvas/60 p-4 border border-stroke/15 md:col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    🧠 Доступные модели
                  </h4>
                  <ul className="flex flex-col gap-1.5 text-xs text-text/90">
                    {plan.models.map((m) => (
                      <li key={m} className="flex items-start gap-2">
                        <span className="text-accent font-bold">•</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Возможности и сценарии */}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold text-text mb-3">Ключевые возможности:</h4>
                  <ul className="flex flex-col gap-2 text-sm text-text/80">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 shrink-0 text-base text-accent" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-text mb-3">Оптимальные сценарии:</h4>
                  <ul className="flex flex-col gap-2 text-sm text-text/80">
                    {plan.useCases.map((useCase) => (
                      <li key={useCase} className="flex items-start gap-2">
                        <span className="text-accent text-sm">→</span>
                        <span>{useCase}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Раздел 2: Принцип работы 5-часового лимита */}
      <section id="limits-guide" className="scroll-mt-20 flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-text">
          ⏱️ Как устроен 5-часовой плавающий лимит (Rolling Limit)
        </h2>
        <Card className="flex flex-col gap-4 leading-relaxed">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Для тарифов <strong>GPT Pro</strong>, <strong>Claude Pro</strong> и{' '}
            <strong>Gemini Pro</strong> действует система непрерывного скользящего окна. В отличие
            от традиционного дневного лимита, который обнуляется один раз в сутки (например, в 00:00
            UTC), скользящее 5-часовое окно учитывает только запросы, сделанные за последние 300
            минут.
          </p>
          <div className="grid gap-4 md:grid-cols-3 pt-2">
            <div className="rounded-lg bg-canvas p-4 border border-stroke/15">
              <h4 className="font-semibold text-sm text-text">1. Непрерывный возврат</h4>
              <p className="mt-1 text-xs text-muted">
                Каждое отправленное сообщение освобождается в вашем балансе ровно через 5 часов
                после его отправки.
              </p>
            </div>
            <div className="rounded-lg bg-canvas p-4 border border-stroke/15">
              <h4 className="font-semibold text-sm text-text">2. Без утренних задержек</h4>
              <p className="mt-1 text-xs text-muted">
                Если вы работали вечером, к утру лимит полностью обновлён и готов к новому рабочему
                дню.
              </p>
            </div>
            <div className="rounded-lg bg-canvas p-4 border border-stroke/15">
              <h4 className="font-semibold text-sm text-text">3. Ultra без лимитов</h4>
              <p className="mt-1 text-xs text-muted">
                Если вам требуется непрерывный процесс кодинга без пауз, выберите тариф{' '}
                <a href="#plan-ultra" className="text-accent underline">
                  Ultra
                </a>
                .
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* Раздел 3: Спецификации моделей */}
      <section id="models-specs" className="scroll-mt-20 flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-text">{t('docs.modelsTitle')}</h2>
        <Card className="overflow-x-auto p-0 border border-stroke/20">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stroke/20 bg-canvas/60 text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="px-6 py-4">Модель</th>
                <th className="px-6 py-4">Семейство</th>
                <th className="px-6 py-4">Контекстное окно</th>
                <th className="px-6 py-4">Специализация</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke/15">
              <tr>
                <td className="px-6 py-4 font-semibold text-text">Gemini 3.8 Flash</td>
                <td className="px-6 py-4 text-muted">Google</td>
                <td className="px-6 py-4 text-muted">128K токенов</td>
                <td className="px-6 py-4 text-text/80">Повседневный диалог, быстрые ответы</td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-semibold text-text">GPT-6 Astra</td>
                <td className="px-6 py-4 text-muted">OpenAI</td>
                <td className="px-6 py-4 text-muted">256K токенов</td>
                <td className="px-6 py-4 text-text/80">
                  Многоуровневые рассуждения, сложная архитектура
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-semibold text-text">GPT-6 Luna</td>
                <td className="px-6 py-4 text-muted">OpenAI</td>
                <td className="px-6 py-4 text-muted">128K токенов</td>
                <td className="px-6 py-4 text-text/80">
                  Агентные задачи, мгновенное написание функций
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-semibold text-text">Claude 4.5 Sonnet</td>
                <td className="px-6 py-4 text-muted">Anthropic</td>
                <td className="px-6 py-4 text-muted">200K токенов</td>
                <td className="px-6 py-4 text-text/80">
                  Анализ кода, рефакторинг, архитектурные решения
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-semibold text-text">Fable 5.5 / 5.1</td>
                <td className="px-6 py-4 text-muted">Anthropic</td>
                <td className="px-6 py-4 text-muted">128K токенов</td>
                <td className="px-6 py-4 text-text/80">Точное следование строгим инструкциям</td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-semibold text-text">Gemini 3.8 Pro</td>
                <td className="px-6 py-4 text-muted">Google</td>
                <td className="px-6 py-4 text-muted">2 000 000+ токенов</td>
                <td className="px-6 py-4 text-text/80">
                  Массивные монорепозитории, анализ сотен файлов
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </section>

      {/* Раздел 4: Сравнительная матрица */}
      <section id="matrix" className="scroll-mt-20 flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-text">{t('docs.matrixTitle')}</h2>
        <Card className="overflow-x-auto p-0 border border-stroke/20">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stroke/20 bg-canvas/60 text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Характеристика</th>
                <th className="px-4 py-3">Free</th>
                <th className="px-4 py-3">GPT Pro</th>
                <th className="px-4 py-3">Claude Pro</th>
                <th className="px-4 py-3">Gemini Pro</th>
                <th className="px-4 py-3 text-accent font-bold">Ultra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke/15 text-xs md:text-sm">
              <tr>
                <td className="px-4 py-3 font-medium text-text">Стоимость</td>
                <td className="px-4 py-3 text-muted">0 ₽</td>
                <td className="px-4 py-3 text-text">1 199 ₽</td>
                <td className="px-4 py-3 text-text">1 199 ₽</td>
                <td className="px-4 py-3 text-text">1 199 ₽</td>
                <td className="px-4 py-3 font-semibold text-accent">2 499 ₽</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-text">Лимиты запросов</td>
                <td className="px-4 py-3 text-muted">3 сообщ./час</td>
                <td className="px-4 py-3 text-text">5-часовой лимит</td>
                <td className="px-4 py-3 text-text">5-часовой лимит</td>
                <td className="px-4 py-3 text-text">5-часовой лимит</td>
                <td className="px-4 py-3 font-semibold text-accent">Без ограничений</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-text">Семейства моделей</td>
                <td className="px-4 py-3 text-muted">Gemini Flash</td>
                <td className="px-4 py-3 text-text">OpenAI GPT-6</td>
                <td className="px-4 py-3 text-text">Claude 4.5 & Fable</td>
                <td className="px-4 py-3 text-text">Gemini 3.8 Pro</td>
                <td className="px-4 py-3 font-semibold text-accent">Все семейства</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-text">Бесконечный кодинг</td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3 font-bold text-accent">✓ Включено</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-text">Приоритет в очереди</td>
                <td className="px-4 py-3 text-muted">Стандартный</td>
                <td className="px-4 py-3 text-text">Высокий</td>
                <td className="px-4 py-3 text-text">Высокий</td>
                <td className="px-4 py-3 text-text">Высокий</td>
                <td className="px-4 py-3 font-semibold text-accent">Наивысший (Dedicated)</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </section>

      {/* Раздел 5: FAQ */}
      <section id="faq" className="scroll-mt-20 flex flex-col gap-4 pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-text">{t('docs.faqTitle')}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {FAQ_ITEMS.map((item) => (
            <Card key={item.q} className="flex flex-col gap-2">
              <CardTitle className="text-base text-text">{item.q}</CardTitle>
              <CardText className="text-xs md:text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                {item.a}
              </CardText>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
