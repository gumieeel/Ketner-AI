import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  createThread,
  fetchSolution,
  isAssistantDetails,
  listMessages,
  listThreads,
  LIMITS,
  sendMessage,
  type ChatMessage,
  type ChatThread,
  type SolutionDetails,
} from '@/features/builder/api';
import { creditsText } from '@/features/discovery/format';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { resolveImageUrl } from '@/features/images/api';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { solutionInterface } from '@/features/solutions/registry';
import { BuilderGate, Page, UnsupportedSolution } from './shared';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

/** Чат помощника: без выбора модели — Auto подбирает модель под каждое сообщение. */
export function SolutionChatPage() {
  const { solutionId = '' } = useParams();
  return (
    <BuilderGate>
      <SolutionChat key={solutionId} id={solutionId} />
    </BuilderGate>
  );
}

function SolutionChat({ id }: { id: string }) {
  const translator = useTranslation();
  const { t } = translator;
  const [details, setDetails] = useState<SolutionDetails | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastCharge, setLastCharge] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const solution = await fetchSolution(id);
      // Чат — только у помощников; инструмент получает честное «не поддерживается».
      if (solutionInterface(solution.solution) !== 'assistant' || !isAssistantDetails(solution)) {
        if (alive) setUnsupported(true);
        return;
      }
      const list = await listThreads(id);
      if (!alive) return;
      setDetails(solution);
      setThreads(list);
      setThreadId(list[0]?.id ?? null);
    })().catch((caught: unknown) => alive && setError(caught));
    return () => {
      alive = false;
    };
  }, [id]);

  const loadMessages = useCallback(
    async (thread: string) => {
      try {
        setMessages(await listMessages(id, thread));
      } catch (caught) {
        setError(caught);
      }
    },
    [id],
  );
  useEffect(() => {
    if (threadId) void loadMessages(threadId);
    else setMessages([]);
  }, [threadId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming]);

  const newThread = async (): Promise<string | null> => {
    try {
      const thread = await createThread(id);
      setThreads((current) => [thread, ...current]);
      setThreadId(thread.id);
      setMessages([]);
      return thread.id;
    } catch (caught) {
      setError(caught);
      return null;
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setError(null);
    setSending(true);
    const thread = threadId ?? (await newThread());
    if (!thread) {
      setSending(false);
      return;
    }
    setDraft('');
    setLastCharge(null);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      threadId: thread,
      role: 'user',
      content,
      model: null,
      image: null,
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setStreaming('');
    await sendMessage(id, thread, content, {
      onDelta: (text) => setStreaming((current) => (current ?? '') + text),
      onDone: (message, charged) => {
        setMessages((current) => [...current, message]);
        setLastCharge(charged);
      },
      onError: (caught) => setError(caught),
    });
    setStreaming(null);
    setSending(false);
    void loadMessages(thread);
    setThreads((current) =>
      current.map((item) =>
        item.id === thread && item.title.match(/^(Новый чат|New chat)$/)
          ? { ...item, title: content.slice(0, 60) }
          : item,
      ),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  if (unsupported) return <UnsupportedSolution />;
  if (!details) {
    return (
      <Page
        title={t('builder.chat.title')}
        back={{ to: `/solutions/${id}`, label: t('builder.chat.back') }}
      >
        {error ? (
          <div className="mt-8">
            <ErrorNotice error={error} redirect={`/solutions/${id}/chat`} />
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> {t('analysis.page.loading')}
          </p>
        )}
      </Page>
    );
  }

  const active = details.solution.status === 'active';
  return (
    <Page
      title={details.solution.name}
      back={{ to: `/solutions/${id}`, label: t('builder.chat.back') }}
      wide
      actions={
        active ? (
          <Button variant="outline" size="sm" onClick={() => void newThread()}>
            {t('builder.chat.newThread')}
          </Button>
        ) : null
      }
    >
      <p className="mt-2 text-[14px] leading-6 text-muted">{t('builder.autoModelNote')}</p>
      {!active ? (
        <div className="mt-6 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[14px] leading-6 text-text">
          {t('builder.chat.inactive')}{' '}
          <Link to={`/solutions/${id}`} className="underline underline-offset-4">
            {t('builder.chat.toSettings')}
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t('builder.chat.threads')} className="min-w-0">
          <h2 className="mb-2 text-[13px] font-medium text-subtle">
            {t('builder.chat.threadsTitle')}
          </h2>
          {threads.length > 0 ? (
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {threads.map((thread) => (
                <li key={thread.id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    aria-current={thread.id === threadId ? 'page' : undefined}
                    onClick={() => setThreadId(thread.id)}
                    className={cn(
                      'max-w-[14rem] truncate rounded-lg px-3 py-2 text-left text-[14px] max-md:min-h-11 lg:w-full',
                      thread.id === threadId
                        ? 'bg-surface-2 text-text'
                        : 'text-muted hover:bg-surface-2/60 hover:text-text',
                    )}
                  >
                    {thread.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-subtle">{t('builder.chat.noThreads')}</p>
          )}
        </nav>

        <div className="flex min-w-0 flex-col">
          <ol className="flex min-h-[16rem] flex-col gap-5" aria-live="polite">
            {messages.length === 0 && streaming === null ? (
              <li className="text-[15px] leading-6 text-subtle">{t('builder.chat.empty')}</li>
            ) : null}
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
            {streaming !== null ? (
              <li className="flex flex-col gap-1">
                {streaming ? (
                  <div className="prose-chat max-w-none text-[15px] leading-7 break-words text-text">
                    <Suspense fallback={<p className="whitespace-pre-wrap">{streaming}</p>}>
                      <Markdown content={streaming} />
                    </Suspense>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[14px] text-muted">
                    <Spinner /> {t('builder.chat.thinking')}
                  </p>
                )}
              </li>
            ) : null}
          </ol>
          <div ref={endRef} />

          {error ? (
            <div className="mt-4">
              <ErrorNotice error={error} redirect={`/solutions/${id}/chat`} />
            </div>
          ) : null}
          {lastCharge !== null && lastCharge > 0 ? (
            <p className="mt-3 text-[13px] text-subtle">
              {t('builder.chat.charged', { amount: creditsText(translator, lastCharge) })}
            </p>
          ) : null}

          <form
            onSubmit={(event) => void send(event)}
            className="mt-6 rounded-2xl border border-stroke bg-surface"
          >
            <label htmlFor="assistant-message" className="sr-only">
              {t('builder.chat.input')}
            </label>
            <textarea
              id="assistant-message"
              value={draft}
              disabled={!active}
              maxLength={LIMITS.message}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('builder.chat.placeholder')}
              className="block w-full resize-none bg-transparent px-4 pt-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:outline-none disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3 pl-4">
              <span className="text-[12px] text-subtle max-sm:hidden">
                {t('builder.chat.hint')}
              </span>
              <Button
                type="submit"
                size="sm"
                loading={sending}
                disabled={!active || sending || !draft.trim()}
              >
                {t('builder.chat.send')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Page>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap text-text">
          {message.content}
        </p>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2">
      {message.image ? (
        <figure className="flex flex-col gap-2">
          <img
            src={resolveImageUrl(message.image.url)}
            alt={t('builder.chat.imageAlt')}
            className="max-h-[28rem] w-auto max-w-full self-start rounded-xl border border-stroke"
            loading="lazy"
          />
          <figcaption className="text-[13px] text-subtle">
            <a
              href={resolveImageUrl(message.image.downloadUrl)}
              className="underline underline-offset-4 hover:text-text"
            >
              {t('builder.chat.download')}
            </a>
          </figcaption>
        </figure>
      ) : null}
      <div
        className={cn(
          'max-w-none text-[15px] leading-7 break-words',
          message.status === 'error' ? 'text-danger' : 'text-text',
        )}
      >
        <Suspense fallback={<p className="whitespace-pre-wrap">{message.content}</p>}>
          <Markdown content={message.content} />
        </Suspense>
      </div>
      {message.model ? (
        <p className="text-[12px] text-subtle">
          {t('builder.chat.answeredBy', { model: message.model.name })}
        </p>
      ) : null}
    </li>
  );
}
