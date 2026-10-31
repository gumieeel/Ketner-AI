import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import planFacts from '@/features/billing/plan-facts.json';
import { fetchMeta } from '@/features/chat/api';
import type { ChatMeta, ModelInfo } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { formatCredits } from '@/lib/format-date';
import { LandingProviders } from '@/pages/landing/providers';
import { LandingSavings } from '@/pages/landing/savings';
import { LandingWorkspaces } from '@/pages/landing/workspaces';

interface ImageModelInfo {
  id: keyof typeof planFacts.levels.credits.imagesPerDay;
  name: string;
  developer: string;
  provider: string;
  note?: string;
}

/** Модели картинок: разработчик и через кого мы их вызываем. Лимиты — из plan-facts.json. */
const IMAGE_MODELS: readonly ImageModelInfo[] = [
  {
    id: 'flux-schnell',
    name: 'FLUX.1 schnell',
    developer: 'Black Forest Labs',
    provider: 'Cloudflare Workers AI',
    note: 'только квадрат',
  },
  {
    id: 'flux-2-klein',
    name: 'FLUX.2 klein',
    developer: 'Black Forest Labs',
    provider: 'Cloudflare Workers AI',
  },
  { id: 'flux-2-dev', name: 'FLUX.2 dev', developer: 'Black Forest Labs', provider: 'Runware' },
  {
    id: 'seedream-5-flash',
    name: 'Seedream 5.0 Flash',
    developer: 'ByteDance',
    provider: 'Runware',
    note: 'пока только квадрат',
  },
  { id: 'flux-2-pro', name: 'FLUX.2 pro', developer: 'Black Forest Labs', provider: 'Runware' },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    developer: 'Google',
    provider: 'Runware',
    note: 'пока только квадрат',
  },
];

function formatTokens(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${String(millions).replace('.', ',')} млн токенов`;
  }
  return `${Math.round(tokens / 1000)} тыс. токенов`;
}

/** Цена типичного запроса: «≈ 35,2 кр.» (в режиме Max — «≈ 85,2 кр.»), у бесплатных — без кредитов. */
function priceLine(model: ModelInfo): string | null {
  if (model.free) return 'бесплатно, кредиты не тратятся';
  if (model.requestCredits === undefined) return null;
  const standard = `≈ ${formatCredits(model.requestCredits, 'ru', 1)} кр.`;
  return model.requestCreditsMax
    ? `${standard} · в режиме Max ≈ ${formatCredits(model.requestCreditsMax, 'ru', 1)} кр.`
    : standard;
}

function ModelCard({ model }: { model: ModelInfo }) {
  const price = priceLine(model);
  const context = formatTokens(model.contextWindow);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[16px] font-semibold text-text">{model.name}</h3>
          {model.baseModelName ? (
            <p className="text-[13px] text-accent">
              Наше название для {model.baseModelName} от {model.developer}
            </p>
          ) : null}
        </div>
        {model.developer ? <Badge tone="outline">{model.developer}</Badge> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-5">
        {model.upstreamModel ? (
          <>
            <dt className="text-subtle">У поставщика</dt>
            <dd className="min-w-0 font-mono text-[12px] break-all text-muted">
              {model.upstreamModel}
            </dd>
          </>
        ) : null}
        {context ? (
          <>
            <dt className="text-subtle">Окно контекста</dt>
            <dd className="text-muted">{context}</dd>
          </>
        ) : null}
        {price ? (
          <>
            <dt className="text-subtle">Запрос стоит</dt>
            <dd className="text-muted">{price}</dd>
          </>
        ) : null}
        {model.fallbackModelName && !model.free ? (
          <>
            <dt className="text-subtle">Не хватает кредитов</dt>
            <dd className="text-muted">отвечает {model.fallbackModelName}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

/** Прозрачность моделей: кто разработал каждую модель, что стоит за нашими названиями и сколько стоит запрос в кредитах. */
export function ModelsPage() {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMeta()
      .then((data) => {
        if (active) setMeta(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = (meta?.models ?? []).filter((model) => model.id !== 'auto');
  const aliases = models.filter((model) => model.baseModelName);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
      <header className="flex max-w-3xl flex-col gap-3">
        {/* Посыл прежней главной агрегатора: все модели в одном чате, без подписки. */}
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          {t('home.heroTitleA')} {t('home.heroTitleB')}
        </h1>
        <p className="text-[17px] leading-8 text-muted">
          Ketner AI не обучает собственные модели. Каждый ответ даёт модель стороннего разработчика:
          мы передаём запрос через OpenRouter или напрямую через API разработчика и возвращаем
          ответ. Под ответом в чате всегда видно, какая модель ответила на самом деле.
        </p>
        <p className="max-w-3xl text-[15px] leading-7 text-muted">
          Все модели открыты каждому, платят только кредиты. Запрос списывает их по реальной
          стоимости: короткий вопрос к Ketner Mini обходится примерно в 2 кредита, большой — к
          Claude Opus в десятки. Цена на карточках — для обычного запроса; длинные диалоги и
          вложения стоят дороже. Когда кредитов не хватает, отвечает модель дешевле, а когда они
          кончились — бесплатная модель.{' '}
          <Link to="/pricing" className="text-text underline underline-offset-4">
            Как работают кредиты
          </Link>
          .
        </p>
        {aliases.length > 0 ? (
          <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-[15px] leading-7 text-text">
            {aliases.map((model, index) => (
              <span key={model.id}>
                {index > 0 ? ' ' : ''}
                <span className="font-medium">{model.name}</span> — это {model.baseModelName} от{' '}
                {model.developer}.
              </span>
            ))}{' '}
            Названия наши, модели — нет.
          </p>
        ) : null}
      </header>

      <LandingProviders />

      {failed ? (
        <p
          role="alert"
          className="rounded-xl border border-stroke bg-surface p-4 text-[15px] text-muted"
        >
          Не удалось загрузить список моделей. Обновите страницу или загляните на{' '}
          <Link to="/status" className="text-text underline underline-offset-4">
            страницу статуса
          </Link>
          .
        </p>
      ) : !meta ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Загрузка моделей">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (
        <section aria-labelledby="models-all" className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 id="models-all" className="text-xl font-semibold tracking-tight">
              Доступны всем
            </h2>
            <Badge tone="brand">Кредиты</Badge>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {models.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </ul>
        </section>
      )}

      {/* Разделы прежней главной: что умеет сервис и сколько стоили бы отдельные подписки. */}
      <LandingWorkspaces />
      <LandingSavings />

      <section className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Кто отвечает бесплатно</h2>
        <p className="text-[15px] leading-7 text-muted">
          Пока у вас нет купленных кредитов, запрос к Ketner Mini идёт не на него, а на бесплатные
          версии моделей у OpenRouter. Они не тратят кредиты. Их лимит общий на весь сервис; когда
          он исчерпан, отвечает Ketner Mini. Эти же модели отвечают, когда кредиты кончились.
        </p>
        {meta?.freeTierModels?.length ? (
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
            {meta.freeTierModels.map((model) => (
              <li key={model.id}>
                <span className="font-medium text-text">
                  {model.name.replace(/\s*\(Free\)$/, '')}
                </span>{' '}
                от {model.developer} —{' '}
                {model.id === 'north-mini-code' ? 'агент Ketner Code' : 'чат и гости без аккаунта'}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[15px] leading-7 text-muted">
          Поставщики бесплатных моделей могут сохранять запросы и использовать их для обучения. Не
          отправляйте им личные данные, пароли и коммерческую тайну. Подробнее — в{' '}
          <Link to="/privacy" className="text-text underline underline-offset-4">
            политике конфиденциальности
          </Link>
          .
        </p>
      </section>

      <section className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Как работает режим Auto</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          <li>Простые вопросы отвечает Ketner Mini, обычные задачи — Ketner Pro.</li>
          <li>
            До первой покупки Auto всегда выбирает Ketner Mini, чтобы пробные кредиты не уходили
            зря. После покупки задачи по коду, математике и логике средней сложности получает
            GLM-5.3 (Z.ai), сложные — GPT-6.1 Sol (OpenAI), пока хватает кредитов.
          </li>
          <li>Claude Opus 5.5 и GPT-6 Astra Auto не выбирает: только если выбрать их вручную.</li>
          <li>Какая модель ответила и почему, видно под ответом.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Модели изображений</h2>
        <p className="max-w-3xl text-[15px] leading-7 text-muted">
          Подсказку перед генерацией проверяет и переводит на английский Ketner Mini; запрещённые
          запросы не выполняются. Картинки тоже тратят кредиты (по стоимости генерации), а в сутки
          их можно сделать не больше лимита: он выше после первой покупки.
        </p>
        {/* Таблица прокручивается на узком экране: область доступна с клавиатуры. */}
        <div
          className="overflow-x-auto rounded-xl border border-stroke focus-visible:outline-2 focus-visible:outline-accent"
          tabIndex={0}
          role="region"
          aria-label="Модели изображений"
        >
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead className="bg-surface-2 text-text">
              <tr>
                <th scope="col" className="p-3 font-semibold">
                  Модель
                </th>
                <th scope="col" className="p-3 font-semibold">
                  Разработчик
                </th>
                <th scope="col" className="p-3 font-semibold">
                  Через
                </th>
                <th scope="col" className="p-3 font-semibold">
                  До покупки
                </th>
                <th scope="col" className="p-3 font-semibold">
                  После покупки
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke bg-surface text-muted">
              {IMAGE_MODELS.map((model) => (
                <tr key={model.id}>
                  <th scope="row" className="p-3 font-medium text-text">
                    {model.name}
                    {model.note ? (
                      <span className="block text-[12px] font-normal text-subtle">
                        {model.note}
                      </span>
                    ) : null}
                  </th>
                  <td className="p-3">{model.developer}</td>
                  <td className="p-3">{model.provider}</td>
                  {(['free', 'credits'] as const).map((level) => {
                    const limits = planFacts.levels[level].imagesPerDay as Record<string, number>;
                    return (
                      <td key={level} className="p-3 tabular-nums">
                        {limits[model.id] ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Чего модели не умеют</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          <li>Модели ошибаются и могут уверенно выдумывать факты. Проверяйте важное.</li>
          <li>Поиска в интернете нет: о событиях после даты обучения модель может не знать.</li>
          <li>Картинки и PDF из вложений модели пока не видят.</li>
          <li>
            Набор моделей меняется: новые добавляем после проверки цены и качества, устаревшие
            убираем. Изменения — в{' '}
            <Link to="/changelog" className="text-text underline underline-offset-4">
              журнале обновлений
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
