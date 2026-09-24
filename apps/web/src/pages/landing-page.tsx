import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  SparkleIcon,
  TerminalIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

type DemoModel = 'gpt-6' | 'claude-45' | 'gemini-38';

interface DemoContent {
  modelName: string;
  family: string;
  badge: string;
  speed: string;
  prompt: string;
  responseHeadline: string;
  codeSnippet: string;
  highlights: string[];
}

const DEMO_PREVIEWS: Record<DemoModel, DemoContent> = {
  'gpt-6': {
    modelName: 'GPT-6 Astra',
    family: 'OpenAI Family',
    badge: 'Deep Reasoning · Multi-Agent',
    speed: '140 токенов/сек · 18 мс latency',
    prompt:
      'Спроектируй микросервисную архитектуру с распределённой очередью задач и rolling limit.',
    responseHeadline: 'Архитектурный анализ и реализация Token Bucket с скользящим окном:',
    codeSnippet: `// Распределённый менеджер лимитов (Redis + Node.js Worker)
export class RollingRateLimiter {
  constructor(private readonly redis: RedisClient, private readonly windowMs = 5 * 3600 * 1000) {}

  async checkLimit(userId: string, maxRequests = 120): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const key = \`limits:user:\${userId}\`;
    const clearBefore = now - this.windowMs;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, clearBefore);
    pipeline.zcard(key);
    pipeline.zadd(key, now, \`\${now}-\${Math.random()}\`);
    pipeline.pexpire(key, this.windowMs);

    const [, count] = await pipeline.exec();
    return { allowed: (count as number) < maxRequests, remaining: Math.max(0, maxRequests - (count as number)) };
  }
}`,
    highlights: [
      'Многоуровневый алгоритмический синтез',
      'Встроенная поддержка рассуждающих моделей o3-mini',
      'Проектирование высоконагруженных распределённых систем',
    ],
  },
  'claude-45': {
    modelName: 'Claude 4.5 Sonnet',
    family: 'Anthropic Family',
    badge: 'Code Synthesis · Security Audit',
    speed: '160 токенов/сек · 16 мс latency',
    prompt: 'Проведи аудит безопасности и оптимизируй параллельную обработку потоков в TypeScript.',
    responseHeadline: 'Аудит безопасности и идиоматичный async-pipeline с изоляцией ресурсов:',
    codeSnippet: `// Типобезопасный пул воркеров с гарантией освобождения ресурсов
import { AsyncLocalStorage } from 'node:async_hooks';

export async function processConcurrently<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}`,
    highlights: [
      'Лучший в мире рефакторинг и статический анализ кода',
      'Безупречное следование сложным архитектурным гайдлайнам',
      'Семейство Fable 5.5 для работы с длинными документами',
    ],
  },
  'gemini-38': {
    modelName: 'Gemini 3.8 Pro',
    family: 'Google Family',
    badge: '2M+ Token Context · Multimodal',
    speed: '180 токенов/сек · 14 мс latency',
    prompt: 'Проанализируй монорепозиторий из 300+ файлов и составь карту зависимостей пакетов.',
    responseHeadline: 'Контекстный анализ графа зависимостей монорепозитория (2.1M токенов):',
    codeSnippet: `// Граф зависимостей монорепозитория (@ketner/web -> @ketner/mock-api)
graph TD
  WebClient["@ketner/web (Vite + React 19)"] --> StateStore["Zustand Stores (Auth, Chat, Billing)"]
  StateStore --> APILayer["REST + SSE Client (Fetch Stream)"]
  APILayer --> ServerProxy["Express 5 Router (/api)"]
  ServerProxy --> ModelsHub["Multi-Model Resolver (GPT-6, Claude 4.5, Gemini 3.8)"]
  ModelsHub --> RollingLimiter["5-Hour Sliding Window Engine"]`,
    highlights: [
      'Окно контекста до 2 000 000+ токенов — целые репозитории за раз',
      'Прозрачный режим рассуждений Flash Thinking 2.5',
      'Мгновенная мультимодальная обработка схем и документов',
    ],
  },
};

const FEATURES = [
  {
    icon: '🧠',
    title: 'Мультимодельный хаб 2026',
    description:
      'Мгновенное переключение между GPT-6 Astra, Claude 4.5 Sonnet и Gemini 3.8 Pro в одном окне без смены контекста.',
  },
  {
    icon: '⏱️',
    title: 'Честные скользящие лимиты',
    description:
      '5-часовое непрерывное плавающее окно вместо суточных банов. Каждый отправленный запрос возвращается в баланс через 5 часов.',
  },
  {
    icon: '🚀',
    title: 'Режим Ultra — бесконечный кодинг',
    description:
      'Полный безлимит для профессионалов: пишите код сутками без пауз и задержек с выделенным наивысшим приоритетом GPU.',
  },
  {
    icon: '📖',
    title: 'Открытая документация',
    description:
      'Честные спецификации контекстных окон, лимитов и сравнительная матрица всех доступных тарифов платформы.',
  },
];

const PRICING_PREVIEW = [
  { id: 'free', name: 'Free', price: '0 ₽', models: 'Gemini 3.8 Flash', limit: '3 сообщ./час' },
  {
    id: 'gpt-pro',
    name: 'GPT Pro',
    price: '1 199 ₽',
    models: 'GPT-6 Astra, Luna, 5.5',
    limit: '5-часовой лимит',
  },
  {
    id: 'claude-pro',
    name: 'Claude Pro',
    price: '1 199 ₽',
    models: 'Claude 4.5, Fable 5.5',
    limit: '5-часовой лимит',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    price: '1 199 ₽',
    models: 'Gemini 3.8 Pro 2M',
    limit: '5-часовой лимит',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '2 499 ₽',
    models: 'Все модели включены',
    limit: 'Без лимитов',
    highlight: true,
  },
];

export function LandingPage() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const [activeDemo, setActiveDemo] = useState<DemoModel>('gpt-6');

  const demo = DEMO_PREVIEWS[activeDemo];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-16 px-4 py-12 md:px-8 animate-fade-in">
      {/* Главный Hero-блок */}
      <section className="relative flex w-full max-w-4xl flex-col items-center text-center gap-6 pt-6">
        {/* Анимированный фоновый ореол за логотипом */}
        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-accent/20 blur-2xl animate-pulse pointer-events-none" />
          <img
            src="/logo-mark.png"
            alt="Ketner AI"
            className="relative size-24 object-contain drop-shadow-2xl md:size-28 animate-float"
          />
        </div>

        {/* Бейдж новостей */}
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent backdrop-blur-md animate-slide-up">
          <span className="size-2 rounded-full bg-accent animate-ping" />
          <span>Доступны флагманы 2026: GPT-6 Astra · Claude 4.5 Sonnet · Gemini 3.8 Pro</span>
        </div>

        {/* Заголовок */}
        <div className="flex flex-col gap-2 animate-slide-up">
          <h1 className="text-4xl font-extrabold tracking-tight text-text sm:text-5xl md:text-6xl">
            {t('landing.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-lg font-medium text-accent md:text-xl">
            Единая интеллектуальная среда для глубокого мышления и кодинга
          </p>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 md:text-base">
            {t('landing.subtitle')} Все передовые языковые модели мира в одном быстром интерфейсе с
            честной политикой лимитов.
          </p>
        </div>

        {status === 'authenticated' && user ? (
          <p className="rounded-full bg-accent/10 px-4 py-1 text-xs font-semibold text-accent border border-accent/20">
            Вы вошли как {user.name || user.email}
          </p>
        ) : null}

        {/* Кнопки призыва к действию */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Link to="/chat">
            <Button
              size="lg"
              className="gap-2 shadow-lg shadow-accent/25 hover:shadow-accent/40 font-semibold px-6"
            >
              <span>{t('landing.cta')}</span>
              <ArrowRightIcon className="text-base" />
            </Button>
          </Link>
          <Link to="/pricing">
            <Button size="lg" variant="outline" className="gap-2 px-5">
              <SparkleIcon className="text-base text-accent" />
              <span>{t('nav.pricing')}</span>
            </Button>
          </Link>
          <Link to="/docs">
            <Button size="lg" variant="ghost" className="gap-2 text-muted hover:text-text px-4">
              <BookOpenIcon className="text-base" />
              <span>{t('nav.docs')}</span>
            </Button>
          </Link>
        </div>
      </section>

      {/* Интерактивная живая демонстрация возможностей (Live Product Mockup) */}
      <section className="w-full max-w-4xl">
        <div className="overflow-hidden rounded-2xl border border-stroke/25 bg-surface/90 shadow-2xl backdrop-blur-xl transition-all duration-300">
          {/* Верхняя панель окна в стиле IDE / macOS */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke/20 bg-canvas/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-red-500/80" />
              <span className="size-3 rounded-full bg-yellow-500/80" />
              <span className="size-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-xs font-medium text-muted">
                Ketner AI Studio · Live Preview
              </span>
            </div>

            {/* Вкладки переключения моделей */}
            <div className="flex items-center gap-1 rounded-lg bg-surface/80 p-1 border border-stroke/20">
              <button
                type="button"
                onClick={() => setActiveDemo('gpt-6')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                  activeDemo === 'gpt-6'
                    ? 'bg-accent text-[var(--color-accent-text)] shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                GPT-6 Astra
              </button>
              <button
                type="button"
                onClick={() => setActiveDemo('claude-45')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                  activeDemo === 'claude-45'
                    ? 'bg-accent text-[var(--color-accent-text)] shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                Claude 4.5 Sonnet
              </button>
              <button
                type="button"
                onClick={() => setActiveDemo('gemini-38')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                  activeDemo === 'gemini-38'
                    ? 'bg-accent text-[var(--color-accent-text)] shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                Gemini 3.8 Pro
              </button>
            </div>
          </div>

          {/* Тело интерактивного диалога */}
          <div className="flex flex-col gap-4 p-5 md:p-6">
            {/* Сообщение пользователя */}
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                Вы
              </span>
              <div className="rounded-xl bg-canvas/70 px-4 py-2.5 text-sm text-text border border-stroke/15">
                {demo.prompt}
              </div>
            </div>

            {/* Ответ ассистента */}
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-[var(--color-accent-text)] shadow-md">
                K
              </span>
              <div className="flex flex-1 flex-col gap-3 rounded-xl bg-canvas/40 p-4 border border-stroke/15">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke/10 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text">{demo.modelName}</span>
                    <Badge tone="brand">{demo.badge}</Badge>
                  </div>
                  <span className="text-[11px] text-muted">{demo.speed}</span>
                </div>

                <p className="text-xs md:text-sm text-text/90 font-medium">
                  {demo.responseHeadline}
                </p>

                {/* Блок с кодом */}
                <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3.5 font-mono text-xs text-zinc-100 shadow-inner">
                  <code>{demo.codeSnippet}</code>
                </pre>

                {/* Пункты преимуществ */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {demo.highlights.map((h) => (
                    <span
                      key={h}
                      className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                    >
                      <CheckIcon className="text-xs" />
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Баннер быстрого запуска в чате */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent/10 p-3 border border-accent/25">
              <div className="flex items-center gap-2">
                <SparkleIcon className="text-base text-accent" />
                <span className="text-xs font-medium text-text">
                  Попробуйте модель {demo.modelName} прямо сейчас в диалоге
                </span>
              </div>
              <Link to="/chat">
                <Button size="sm" variant="primary" className="text-xs">
                  Открыть в чате →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Раздел 4 ключевых возможностей */}
      <section className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((item) => (
          <Card
            key={item.title}
            className="card-interactive flex flex-col justify-between p-5 border border-stroke/20 bg-surface/80 backdrop-blur-sm"
          >
            <div>
              <div className="mb-3 text-2xl">{item.icon}</div>
              <h3 className="text-base font-bold tracking-tight text-text">{item.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                {item.description}
              </p>
            </div>
          </Card>
        ))}
      </section>

      {/* Тизер тарифов: 5 планов в одну строку */}
      <section className="flex w-full flex-col items-center gap-6 rounded-2xl border border-stroke/20 bg-surface/60 p-6 md:p-8 backdrop-blur-md">
        <div className="flex flex-col items-center text-center gap-1.5">
          <Badge tone="brand">Тарифы для любых задач</Badge>
          <h2 className="text-2xl font-bold tracking-tight text-text">
            Выберите оптимальный тариф
          </h2>
          <p className="text-xs md:text-sm text-muted max-w-lg">
            От бесплатного старта на Gemini 3.8 Flash до бесконечного кодинга на Ultra.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {PRICING_PREVIEW.map((plan) => (
            <Link
              key={plan.id}
              to={`/docs#plan-${plan.id}`}
              className={cn(
                'card-interactive flex flex-col justify-between rounded-xl p-4 border transition-all text-left',
                plan.highlight
                  ? 'border-accent bg-accent/10 shadow-md'
                  : 'border-stroke/20 bg-canvas/70 hover:border-accent/40',
              )}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-text">{plan.name}</span>
                  {plan.highlight && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-accent-text)]">
                      TOP
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xl font-extrabold text-text">{plan.price}</p>
                <p className="mt-1 text-[11px] text-accent font-medium">{plan.models}</p>
              </div>
              <p className="mt-3 text-[11px] text-muted border-t border-stroke/10 pt-2">
                ⏱️ {plan.limit}
              </p>
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link to="/pricing">
            <Button variant="primary" size="md">
              Сравнить все тарифы детально →
            </Button>
          </Link>
          <Link to="/api-docs">
            <Button variant="outline" size="md" className="flex items-center gap-1.5">
              <TerminalIcon className="text-base text-accent" />
              API & Агенты
            </Button>
          </Link>
          <Link to="/docs">
            <Button variant="outline" size="md">
              Читать документацию
            </Button>
          </Link>
        </div>
      </section>

      {/* Финальный призыв к действию */}
      <section className="flex flex-col items-center gap-4 text-center pb-8">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text">
          Готовы испытать интеллект нового поколения?
        </h2>
        <p className="text-sm text-muted max-w-md">
          Начните диалог прямо сейчас бесплатно и оцените скорость отклика и точность моделей.
        </p>
        <Link to="/chat">
          <Button size="lg" className="px-8 shadow-xl shadow-accent/20">
            {t('landing.cta')}
          </Button>
        </Link>
      </section>
    </div>
  );
}
