import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LEGAL_DOCUMENTS, SUPPORT_EMAIL } from '@/features/content/legal';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';

type Status = 'idle' | 'sending' | 'sent';

async function sendContact(payload: {
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
  useDocumentTitle('Контакты — Ketner AI');
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
      await sendContact({ name, email, message, website });
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
          Вопросы по оплате, возврату, работе сервиса или данным — пишите, ответим на почту, которую
          вы укажете. Обычно в течение суток.
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
