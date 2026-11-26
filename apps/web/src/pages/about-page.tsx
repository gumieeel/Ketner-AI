import { Link } from 'react-router-dom';
import { STARTING_PRICE } from '@/features/billing/tiers';
import { ROADMAP } from '@/features/content/changelog';
import { SUPPORT_EMAIL } from '@/features/content/legal';
import { PROJECT, SUPPORT_TELEGRAM_URL } from '@/features/content/project';

const linkClass = 'text-text underline underline-offset-4 hover:text-accent';

const TIMELINE: { date: string; text: string }[] = [
  { date: PROJECT.developmentStarted, text: 'Начало разработки.' },
  { date: PROJECT.launched, text: 'Сайт заработал с настоящими моделями — дата запуска.' },
  { date: PROJECT.paymentsStarted, text: 'Первые платежи на сайте.' },
  {
    date: PROJECT.businessPlatform,
    text: 'Ketner стал платформой ИИ-агентов для бизнеса: анализ, помощники и боты для клиентов. Общий чат, Ketner Code, картинки и API для разработчиков закрыты.',
  },
];

/** «О проекте»: кто делает Ketner AI, зачем, на каком этапе и что дальше. */
export function AboutPage() {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          О проекте
        </h1>
        <p className="text-[17px] leading-8 text-muted">
          Ketner AI — платформа ИИ-агентов для малого и среднего бизнеса. Вы описываете, как
          работает бизнес, Ketner находит, что можно автоматизировать, и помогает создать помощника
          или ИИ-агента для клиентов — без программиста.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Кто мы</h2>
        <p className="text-[15px] leading-7 text-muted">
          Ketner AI создаёт {PROJECT.team}. Это независимый проект: мы не связаны с OpenAI,
          Anthropic, Google, xAI и другими компаниями, чьи модели работают в сервисе, и не
          представляем их.
        </p>
        <p className="text-[15px] leading-7 text-muted">
          Собственные модели мы не обучаем. Помощники и боты отвечают с помощью моделей разных
          разработчиков: запрос уходит модели через OpenRouter или напрямую через API разработчика.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Какую задачу решаем</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          <li>
            Малому бизнесу трудно понять, что из ИИ ему действительно поможет. Анализ Ketner
            показывает это на примере вашего бизнеса и честно говорит, чего пока нельзя.
          </li>
          <li>
            ИИ-агент для клиентов отвечает на частые вопросы и собирает заявки: на своей странице,
            по ссылке, QR-коду и кнопке на сайте.
          </li>
          <li>
            Анализ, создание и проверка — бесплатно. Платите только за работающие решения: тариф на
            аккаунт от {STARTING_PRICE} в месяц, подробности — на странице{' '}
            <Link to="/pricing" className={linkClass}>
              «Тарифы»
            </Link>
            .
          </li>
          <li>Интеграции с вашими системами делает команда Ketner — на платном тарифе.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Этап разработки</h2>
        <p className="text-[15px] leading-7 text-muted">
          <span className="font-medium text-text">{PROJECT.stage}.</span> Сайт работает с настоящими
          моделями, но продукт молодой: функции меняются быстро, часть ещё не готова. Что пока не
          работает, честно перечислено в разделе{' '}
          <Link to="/changelog#limitations" className={linkClass}>
            «Известные ограничения»
          </Link>
          , а текущее состояние сервиса — на странице{' '}
          <Link to="/status" className={linkClass}>
            «Статус»
          </Link>
          .
        </p>
        <ol className="mt-1 flex flex-col gap-0 border-l border-stroke pl-5">
          {TIMELINE.map((step) => (
            <li key={step.date} className="relative py-2 text-[15px] leading-6">
              <span
                aria-hidden="true"
                className="absolute top-[15px] -left-[24.5px] size-2 rounded-full bg-accent"
              />
              <span className="font-medium text-text">{step.date}</span>
              <span className="text-muted"> — {step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Планы</h2>
        <p className="text-[15px] leading-7 text-muted">
          Над этим работаем сейчас. Это планы, а не обещания: сроков нет, порядок может меняться.
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          {ROADMAP.slice(0, 5).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-[15px] leading-7 text-muted">
          Что уже вышло и когда — в{' '}
          <Link to="/changelog" className={linkClass}>
            журнале обновлений
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-stroke pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Связаться с нами</h2>
        <ul className="flex flex-col gap-1.5 text-[15px] leading-7 text-muted">
          <li>
            Почта:{' '}
            <a className={linkClass} href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </li>
          <li>
            Telegram:{' '}
            <a className={linkClass} href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer">
              @{PROJECT.supportTelegram}
            </a>
          </li>
          <li>
            Ошибки и идеи:{' '}
            <Link to="/contacts?topic=bug" className={linkClass}>
              форма обратной связи
            </Link>
          </li>
        </ul>
      </section>
    </article>
  );
}
