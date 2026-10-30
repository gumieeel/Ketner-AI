import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { LEGAL_DOCUMENTS, SUPPORT_EMAIL } from '@/features/content/legal';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/cn';
import { sectionLinks } from '@/lib/site-links';

type Status = 'idle' | 'sending' | 'sent';

/** Темы совпадают с сервером: apps/mock-api/src/store/contact-store.ts (CONTACT_TOPICS). */
type Topic = 'bug' | 'idea' | 'payment' | 'other';

const TOPICS: { id: Topic; label: string; hint: string; placeholder: string }[] = [
  {
    id: 'bug',
    label: 'Ошибка',
    hint: 'Что-то сломалось или работает не так',
    placeholder:
      'Что вы делали, что ожидали и что произошло. Укажите модель, раздел (чат, Code, картинки) и примерное время.',
  },
  {
    id: 'idea',
    label: 'Идея или функция',
    hint: 'Чего не хватает в Ketner AI',
    placeholder: 'Какую задачу хотите решить и как это могло бы работать.',
  },
  {
    id: 'payment',
    label: 'Оплата и возврат',
    hint: 'Счёт, кредиты, возврат',
    placeholder:
      'Почта аккаунта, пакет кредитов, способ и время оплаты. Номер карты не присылайте.',
  },
  { id: 'other', label: 'Другое', hint: 'Вопрос, данные, сотрудничество', placeholder: '' },
];

async function sendContact(payload: {
  topic: Topic;
  name: string;
  email: string;
  message: string;
  website: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.ok) return;
  let message = 'Не удалось отправить сообщение. Напишите нам на почту.';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // не JSON
  }
  throw new Error(message);
}

const textareaClass = cn(
  'min-h-32 w-full rounded-md border border-stroke bg-surface px-3.5 py-3 text-base text-text placeholder:text-subtle md:text-[15px]',
  'hover:border-stroke-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft',
);

/** Контакты: почта поддержки, бот в Telegram и форма обратной связи. */
export function ContactsPage() {
  const [topic, setTopic] = useState<Topic>('bug');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus('sending');
    try {
      await sendContact({ topic, name, email, message, website });
      setStatus('sent');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение.');
      setStatus('idle');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">Контакты</h1>
        <p className="text-[15px] leading-7 text-muted">
          Нашли ошибку, не хватает функции, вопрос по оплате, возврату или данным — пишите, ответим
          на почту, которую вы укажете. Обычно в течение суток. Ответы на частые вопросы — в{' '}
          <a className="underline underline-offset-4" href={sectionLinks().faq}>
            разделе FAQ
          </a>
          .
        </p>
      </header>

      <section aria-label="Способы связи" className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-xl border border-stroke bg-surface p-4">
          <span className="text-[13px] text-subtle">Почта поддержки</span>
          <a
            className="text-[16px] font-medium text-text underline underline-offset-4"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-stroke bg-surface p-4">
          <span className="text-[13px] text-subtle">Telegram</span>
          <a
            className="text-[16px] font-medium text-text underline underline-offset-4"
            href="https://t.me/ketner_support_bot"
            target="_blank"
            rel="noreferrer"
          >
            @ketner_support_bot
          </a>
        </div>
      </section>

      <section aria-labelledby="known-issues-title" className="flex flex-col gap-3">
        <h2 id="known-issues-title" className="text-xl font-semibold tracking-tight">
          Уже знаем и работаем
        </h2>
        <p className="text-[15px] leading-7 text-muted">
          Об этих проблемах писать не нужно — они в работе. Если ваша ошибка не похожа ни на одну из
          них, сообщите через форму ниже. Состояние сервиса прямо сейчас — на странице{' '}
          <Link className="underline underline-offset-4" to="/status">
            «Статус»
          </Link>
          .
        </p>
        <details className="group rounded-xl border border-stroke bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[15px] font-medium text-text">
            Известные проблемы ({KNOWN_ISSUES.length})
            <span
              aria-hidden="true"
              className="text-subtle transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <ul className="flex flex-col divide-y divide-stroke/60 border-t border-stroke">
            {KNOWN_ISSUES.map((issue) => (
              <li key={issue.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="text-[14px] font-medium text-text">{issue.title}</span>
                <span className="text-[14px] leading-6 text-muted">{issue.details}</span>
                {issue.workaround ? (
                  <span className="text-[14px] leading-6 text-muted">
                    <span className="text-text">Что делать сейчас:</span> {issue.workaround}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section aria-labelledby="contact-form-title" className="flex flex-col gap-4">
        <h2 id="contact-form-title" className="text-xl font-semibold tracking-tight">
          Форма обратной связи
        </h2>
        {status === 'sent' ? (
          <p
            role="status"
            className="rounded-xl border border-stroke bg-surface p-4 text-[15px] leading-6 text-text"
          >
            Спасибо, сообщение отправлено. Ответим на {email}.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[14px] text-muted">Тема</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {TOPICS.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-2.5 transition-colors',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-soft',
                      topic === option.id
                        ? 'border-accent bg-accent-soft/40'
                        : 'border-stroke bg-surface hover:border-stroke-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="topic"
                      value={option.id}
                      checked={topic === option.id}
                      onChange={() => setTopic(option.id)}
                      className="sr-only"
                    />
                    <span className="text-[15px] font-medium text-text">{option.label}</span>
                    <span className="text-[13px] text-subtle">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1.5 text-[14px] text-muted">
              Имя
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                maxLength={100}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] text-muted">
              Почта для ответа
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] text-muted">
              Сообщение
              <textarea
                className={textareaClass}
                value={message}
                placeholder={TOPICS.find((option) => option.id === topic)?.placeholder}
                onChange={(event) => setMessage(event.target.value)}
                required
                minLength={10}
                maxLength={4000}
              />
            </label>
            {/* Ловушка для ботов: людям не видна. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Сайт
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </label>
            </div>
            {error ? (
              <p role="alert" className="text-[14px] text-danger">
                {error}
              </p>
            ) : null}
            <p className="text-[13px] leading-5 text-subtle">
              Отправляя форму, вы соглашаетесь с{' '}
              <Link className="underline underline-offset-4" to={LEGAL_DOCUMENTS.privacy.path}>
                политикой конфиденциальности
              </Link>
              .
            </p>
            <Button type="submit" loading={status === 'sending'} className="self-start">
              Отправить
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
