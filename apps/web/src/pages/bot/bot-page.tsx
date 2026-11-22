import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import {
  BotApiError,
  conversationStore,
  fetchHistory,
  fetchPublicBot,
  sendBotMessage,
  sendLead,
  type PublicBot,
  type PublicBotMessage,
} from '@/features/bots/api';
import { usePreferences } from '@/features/preferences/preferences-store';
import { translate, useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

const MESSAGE_MAX = 1000;
/** Места, где раскрывается форма заявки, кроме сообщений бота (там — id сообщения). */
const END = 'end';
const PAUSED = 'paused';
/** Отступ от края области переписки при показе раскрытой формы, px. */
const EDGE = 12;

/**
 * Страница бота для клиентов: ketner.org/b/<адрес> (docs/AUTOMATION_PLAN.md, этап B).
 *
 * Открывается без входа, отдельно от сайта Ketner (без шапки и меню) и во фрейме на сайте бизнеса
 * (`?embed=1`, виджет public/widget.js). Ссылок внутрь Ketner здесь нет — только наружу в новой
 * вкладке, чтобы фрейм не превращался в окно кабинета. Язык страницы — язык бота.
 */
export function BotPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  // Виджет передаёт тему сайта бизнеса (`?theme=light|dark`): только на эту страницу, без сохранения.
  const theme = params.get('theme');
  useEffect(() => {
    if (theme === 'light' || theme === 'dark') usePreferences.setState({ theme });
  }, [theme]);
  return <BotChat key={slug} slug={slug.toLowerCase()} embed={params.get('embed') === '1'} />;
}

type Item = PublicBotMessage & { pending?: boolean };

function BotChat({ slug, embed }: { slug: string; embed: boolean }) {
  const preferred = useTranslation().language;
  const [bot, setBot] = useState<PublicBot | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [messages, setMessages] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  // Форма заявки свёрнута, пока посетитель сам её не раскроет. `at` — где она раскрыта: под ответом
  // бота с предложением (id сообщения), под отметкой «бот не отвечает» или в конце переписки
  // (постоянная кнопка в шапке). `question` — сообщение посетителя, к которому относится заявка.
  const [form, setForm] = useState<{ at: string; question: string } | null>(null);
  // Имя и контакт сохраняются, если форму свернули и раскрыли снова.
  const [lead, setLead] = useState({ name: '', contact: '' });
  // Где показать «Заявка отправлена»; после заявки бот больше не предлагает форму в сообщениях.
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [leadLeft, setLeadLeft] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const inputId = useId();
  const baseId = useId();

  const language = bot?.language ?? preferred;
  const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(language, key, vars);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const info = await fetchPublicBot(slug);
      setBot(info);
      document.title = info.name;
      const saved = conversationStore.get(slug);
      if (saved) {
        try {
          setMessages(await fetchHistory(slug, saved));
          setConversationId(saved);
        } catch {
          conversationStore.clear(slug);
        }
      }
    } catch (caught) {
      if (caught instanceof BotApiError && caught.status === 404) setMissing(true);
      else setLoadError(true);
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);

  // К концу переписки — только когда появилось новое сообщение. Раскрытие и сворачивание формы
  // переписку не двигают (раскрытая форма лишь показывается целиком, если ушла за край).
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, sending]);

  const openForm = (at: string, question: string) => {
    setForm({ at, question });
    if (sentAt === at) setSentAt(null);
  };
  const toggleForm = (at: string, question: string) => {
    if (form?.at === at) setForm(null);
    else openForm(at, question);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending || !bot) return;
    setSending(true);
    setError(null);
    const temporary: Item = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      offerContact: false,
      status: 'complete',
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((current) => [...current, temporary]);
    setDraft('');
    try {
      const result = await sendBotMessage(slug, content, conversationId);
      setConversationId(result.conversationId);
      conversationStore.set(slug, result.conversationId);
      setMessages((current) => [
        ...current.map((item) => (item.id === temporary.id ? { ...item, pending: false } : item)),
        result.message,
      ]);
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== temporary.id));
      setDraft(content);
      if (caught instanceof BotApiError && caught.code === 'bot_paused') {
        setBot({ ...bot, status: 'paused' });
      } else {
        setError(
          caught instanceof BotApiError && caught.status === 0
            ? 'botPage.error.network'
            : caught instanceof BotApiError && caught.status === 429
              ? 'botPage.error.tooMany'
              : 'botPage.error.generic',
        );
      }
    } finally {
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };
  const restart = () => {
    conversationStore.clear(slug);
    setConversationId(null);
    setMessages([]);
    setForm(null);
    setSentAt(null);
    setLeadLeft(false);
    setError(null);
  };

  if (missing) {
    return (
      <Shell embed={embed}>
        <div className="m-auto max-w-sm px-6 text-center">
          <h1 className="text-[22px] font-medium text-text">{t('botPage.notFound')}</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">{t('botPage.notFoundLead')}</p>
        </div>
      </Shell>
    );
  }
  if (!bot) {
    return (
      <Shell embed={embed}>
        <div className="m-auto flex flex-col items-center gap-3 px-6 text-center">
          {loadError ? (
            <>
              <p className="text-[15px] text-muted">{t('botPage.error.network')}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('botPage.retry')}
              </Button>
            </>
          ) : (
            <Spinner />
          )}
        </div>
      </Shell>
    );
  }

  const paused = bot.status === 'paused';
  const asked = messages.some((item) => item.role === 'user');
  const lastUser = [...messages].reverse().find((item) => item.role === 'user')?.content ?? '';
  /** Вопрос посетителя, на который отвечает сообщение бота с номером `index`. */
  const questionBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === 'user') return messages[i]!.content;
    }
    return '';
  };
  const formId = (at: string) => `${baseId}-form-${at}`;
  const collapse = (at: string) => {
    setForm(null);
    // Фокус — на кнопку, которая раскрыла форму, без прокрутки: переписка остаётся на месте.
    requestAnimationFrame(() => toggles.current.get(at)?.focus({ preventScroll: true }));
  };
  const toggleRef = (at: string) => (node: HTMLButtonElement | null) => {
    if (node) toggles.current.set(at, node);
    else toggles.current.delete(at);
  };
  /** Раскрытая форма или «заявка отправлена» на месте `at`. */
  const contactPanel = (at: string) =>
    form?.at === at ? (
      <ContactForm
        id={formId(at)}
        t={t}
        question={form.question}
        lead={lead}
        onLead={setLead}
        onCollapse={() => collapse(at)}
        onSend={async (sent) => {
          await sendLead(slug, sent, conversationId);
          setForm(null);
          setSentAt(at);
          setLeadLeft(true);
        }}
      />
    ) : sentAt === at ? (
      <p
        role="status"
        className="mt-2 w-full rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-[14px] leading-6 text-text"
      >
        {t('botPage.contact.sent')}
      </p>
    ) : null;
  /** Маленькая кнопка «Оставить заявку» под сообщением: раскрывает и сворачивает форму на месте. */
  const inlineOffer = (at: string, question: string) => (
    <>
      <button
        ref={toggleRef(at)}
        type="button"
        aria-expanded={form?.at === at}
        aria-controls={form?.at === at ? formId(at) : undefined}
        onClick={() => toggleForm(at, question)}
        className="mt-2 inline-flex min-h-9 items-center rounded-full border border-accent/35 bg-surface px-3.5 text-[14px] font-medium text-accent hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        {t('botPage.contactButton')}
      </button>
      {contactPanel(at)}
    </>
  );

  return (
    <Shell embed={embed}>
      <header className="flex items-center justify-between gap-3 border-b max-sm:gap-2 border-stroke px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-medium text-text max-sm:text-[15px]">
            {bot.name}
          </h1>
          {/* Одна строка: на узком экране — короткая пометка, иначе шапка вырастает в три строки. */}
          <p className="truncate text-[12px] text-subtle">
            <span className="sm:hidden">{t('botPage.aiNoteShort')}</span>
            <span className="max-sm:hidden">{t('botPage.aiNote')}</span>
          </p>
        </div>
        {/* Постоянная кнопка: форма в конце переписки, всегда доступна (и после заявки). */}
        <button
          ref={toggleRef(END)}
          type="button"
          // На узком экране кнопка компактнее: имя бота не обрезается.
          className={buttonClasses({
            variant: 'outline',
            size: 'sm',
            className: 'shrink-0 max-sm:h-9 max-sm:min-h-9 max-sm:px-2.5 max-sm:text-[13px]',
          })}
          aria-expanded={form?.at === END}
          aria-controls={form?.at === END ? formId(END) : undefined}
          onClick={() => toggleForm(END, lastUser)}
        >
          {t('botPage.contactButton')}
        </button>
      </header>

      {/*
        relative: подписи для экранных чтецов в сообщениях (sr-only — position: absolute) иначе
        отсчитываются от страницы, а не от области переписки, и растягивают документ на всю длину
        диалога — страницу можно было прокручивать вниз в пустоту. overscroll-contain: прокрутка до
        конца переписки во фрейме виджета не уходит в страницу сайта.
      */}
      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-5">
          {paused ? (
            <div className="flex flex-col items-start">
              <p className="w-full rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[14px] leading-6 text-text">
                {t('botPage.paused')}
              </p>
              {inlineOffer(PAUSED, lastUser)}
            </div>
          ) : null}
          <ol className="flex flex-col gap-3" aria-live="polite" aria-label={bot.name}>
            {bot.greeting ? (
              <Bubble role="assistant" label={bot.name}>
                {bot.greeting}
              </Bubble>
            ) : null}
            {messages.map((item, index) => (
              <Bubble
                key={item.id}
                role={item.role}
                label={item.role === 'user' ? t('botPage.you') : bot.name}
                faded={item.pending}
                error={item.status === 'error'}
                after={
                  item.role === 'assistant' && item.offerContact && !leadLeft
                    ? inlineOffer(item.id, questionBefore(index))
                    : contactPanel(item.id)
                }
              >
                {item.content}
              </Bubble>
            ))}
            {sending ? (
              <li className="flex items-center gap-2 text-[14px] text-muted">
                <Spinner /> {t('botPage.thinking')}
              </li>
            ) : null}
          </ol>
          {contactPanel(END)}
        </div>
        {/* После нижнего отступа: «к концу переписки» — это настоящий конец прокрутки. */}
        <div ref={endRef} />
      </main>

      <footer className="border-t border-stroke bg-canvas">
        <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {!asked && !paused && bot.quickReplies.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {bot.quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  disabled={sending}
                  onClick={() => void send(reply)}
                  className="min-h-9 rounded-full border border-stroke bg-surface px-3.5 py-1.5 text-[14px] text-text hover:border-stroke-strong focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-60"
                >
                  {reply}
                </button>
              ))}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mb-2 text-[14px] text-danger">
              {t(error)}
            </p>
          ) : null}
          {!paused ? (
            <form onSubmit={submit} className="flex items-end gap-2">
              <label htmlFor={inputId} className="sr-only">
                {t('botPage.input')}
              </label>
              <textarea
                id={inputId}
                value={draft}
                rows={1}
                maxLength={MESSAGE_MAX}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('botPage.placeholder')}
                className="max-h-36 min-h-11 flex-1 resize-none rounded-xl border border-stroke bg-surface px-4 py-2.5 text-[16px] leading-6 text-text [field-sizing:content] placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <Button type="submit" loading={sending} disabled={sending || !draft.trim()}>
                {t('botPage.send')}
              </Button>
            </form>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-subtle">
            <a
              href="https://ketner.org/"
              target="_blank"
              rel="noopener"
              className="underline-offset-4 hover:text-text hover:underline"
            >
              {t('botPage.poweredBy')}
            </a>
            {messages.length > 0 ? (
              <button
                type="button"
                onClick={restart}
                className="min-h-8 underline-offset-4 hover:text-text hover:underline"
              >
                {t('botPage.newConversation')}
              </button>
            ) : null}
          </div>
        </div>
      </footer>
    </Shell>
  );
}

/** Во фрейме виджета страница занимает окно чата целиком; отдельно — тот же экран. */
function Shell({ embed, children }: { embed: boolean; children: ReactNode }) {
  return (
    <div data-embed={embed ? '' : undefined} className="flex h-dvh flex-col bg-canvas text-text">
      {children}
    </div>
  );
}

function Bubble({
  role,
  label,
  faded = false,
  error = false,
  after,
  children,
}: {
  role: 'user' | 'assistant';
  label: string;
  faded?: boolean;
  error?: boolean;
  /** Под сообщением: кнопка «Оставить заявку» и форма, раскрытая на месте. */
  after?: ReactNode;
  children: string;
}) {
  return (
    <li className={cn('flex flex-col', role === 'user' ? 'items-end' : 'items-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap',
          role === 'user'
            ? 'bg-accent-soft text-text'
            : 'border border-stroke bg-surface text-text',
          faded && 'opacity-70',
          error && 'border-danger/40',
        )}
      >
        <span className="sr-only">{label}: </span>
        {children}
      </p>
      {after}
    </li>
  );
}

function ContactForm({
  id,
  t,
  question,
  lead,
  onLead,
  onCollapse,
  onSend,
}: {
  id: string;
  t: (key: TranslationKey) => string;
  /** Вопрос посетителя, к которому относится заявка (можно поправить). */
  question: string;
  /** Имя и контакт живут у страницы: свернули и раскрыли форму — они на месте. */
  lead: { name: string; contact: string };
  onLead: (lead: { name: string; contact: string }) => void;
  onCollapse: () => void;
  onSend: (lead: { name: string; contact: string; question: string }) => Promise<void>;
}) {
  const ref = useRef<HTMLFormElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(question);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  // Раскрытая форма показывается без перескока к концу переписки: переписка прокручивается ровно
  // настолько, насколько форма ушла за нижний край, но не дальше, чем кнопка «Оставить заявку»
  // над ней (на узком экране форма выше окна — сообщение бота и кнопка остаются видны). Фокус —
  // в первое поле, без второй прокрутки.
  useEffect(() => {
    const form = ref.current;
    const scroller = form?.closest('main');
    if (form && scroller) {
      const view = scroller.getBoundingClientRect();
      const box = form.getBoundingClientRect();
      const toggle = form.previousElementSibling;
      const top =
        toggle instanceof HTMLButtonElement ? toggle.getBoundingClientRect().top : box.top;
      const overflow = box.bottom + EDGE - view.bottom;
      const room = top - view.top - EDGE;
      if (overflow > 0 && room > 0) scroller.scrollTop += Math.min(overflow, room);
    }
    firstRef.current?.focus({ preventScroll: true });
  }, []);
  const { name, contact } = lead;
  const field =
    'h-11 w-full rounded-xl border border-stroke bg-canvas px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <form
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      // Форма лежит в переписке (aria-live): раскрытие не зачитывается целиком — фокус уже в поле.
      aria-live="off"
      className="mt-2 flex w-full flex-col gap-3 rounded-2xl border border-stroke-strong bg-surface px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || contact.trim().length < 3) return;
        setBusy(true);
        setError(null);
        onSend({ name: name.trim(), contact: contact.trim(), question: text.trim() }).catch(
          (caught: unknown) => {
            setError(
              caught instanceof BotApiError && caught.status === 0
                ? 'botPage.error.network'
                : caught instanceof BotApiError && caught.status === 429
                  ? 'botPage.error.tooMany'
                  : 'botPage.error.generic',
            );
            setBusy(false);
          },
        );
      }}
    >
      <h2 id={`${id}-title`} className="text-[16px] font-medium text-text">
        {t('botPage.contact.title')}
      </h2>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">{t('botPage.contact.name')}</span>
        <input
          ref={firstRef}
          required
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(event) => onLead({ name: event.target.value, contact })}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">{t('botPage.contact.contact')}</span>
        <input
          required
          minLength={3}
          maxLength={120}
          autoComplete="tel"
          value={contact}
          onChange={(event) => onLead({ name, contact: event.target.value })}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">{t('botPage.contact.question')}</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={cn(field, 'h-auto resize-y py-2.5 leading-6')}
        />
      </label>
      {error ? (
        <p role="alert" className="text-[14px] text-danger">
          {t(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={busy || !name.trim() || contact.trim().length < 3}
        >
          {t('botPage.contact.send')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCollapse}>
          {t('botPage.contact.collapse')}
        </Button>
      </div>
    </form>
  );
}
