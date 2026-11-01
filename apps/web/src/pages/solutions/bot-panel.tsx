import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/button-classes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { QrCode } from '@/components/ui/qr-code';
import { Spinner } from '@/components/ui/spinner';
import {
  BOT_LIMITS,
  fetchBot,
  fetchBotConversation,
  listBotConversations,
  listBotLeads,
  previewBot,
  saveBot,
  setBotLeadStatus,
  type BotConversationView,
  type BotLeadView,
  type BotMessageView,
  type BotOverview,
  type BotRunway,
  type BotSettings,
  type SolutionDetails,
} from '@/features/builder/api';
import { creditsText } from '@/features/discovery/format';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';

/**
 * Кабинет бота для клиентов (этап B): где живёт бот (ссылка, QR, код для сайта), расход за
 * сегодня, проба «как клиент», заявки, диалоги с исправлением ответов, настройки страницы.
 * Поведение бота (знания, тон, запреты) — в общих настройках версиями, как у помощника.
 */
export function BotPanel({ details }: { details: SolutionDetails }) {
  const id = details.solution.id;
  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setOverview(await fetchBot(id));
    } catch (caught) {
      setError(caught);
    }
  }, [id]);
  useEffect(() => {
    void refresh();
  }, [refresh, details.solution.status]);

  const [settingsSaved, setSettingsSaved] = useState(false);
  const save = async (patch: Partial<BotSettings>) => {
    setOverview(await saveBot(id, patch));
  };

  if (!overview) {
    return error ? (
      <div className="mt-6">
        <ErrorNotice error={error} redirect={`/solutions/${id}`} />
      </div>
    ) : (
      <p className="mt-6 flex items-center gap-2 text-[14px] text-muted">
        <Spinner />
      </p>
    );
  }
  return (
    <>
      <ShareSection details={details} overview={overview} />
      <PreviewSection id={id} />
      <LeadsSection id={id} />
      <ConversationsSection id={id} overview={overview} onSave={save} />
      {/* Настройки пересобираются после любого сохранения (и исправления из диалога). */}
      <SettingsSection
        key={JSON.stringify(overview.settings)}
        solutionId={id}
        overview={overview}
        saved={settingsSaved}
        onEdit={() => setSettingsSaved(false)}
        onSave={async (patch) => {
          await save(patch);
          setSettingsSaved(true);
        }}
      />
    </>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="mt-10 border-t border-stroke pt-8">
      <h2 className="text-[20px] font-medium tracking-[-0.01em] text-text">{title}</h2>
      {lead ? <p className="mt-2 text-[14px] leading-6 text-muted">{lead}</p> : null}
      {children}
    </section>
  );
}

const inputClass =
  'h-11 w-full rounded-xl border border-stroke bg-surface px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
const textareaClass =
  'block w-full resize-y rounded-xl border border-stroke bg-surface px-4 py-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

// ─── Где живёт бот и расход ──────────────────────────────────────────────────

function ShareSection({ details, overview }: { details: SolutionDetails; overview: BotOverview }) {
  const translator = useTranslation();
  const { t } = translator;
  const status = details.solution.status;
  const origin = (() => {
    try {
      return new URL(overview.publicUrl).origin;
    } catch {
      return 'https://ketner.org';
    }
  })();
  const embed = `<script src="${origin}/widget.js" data-bot="${overview.settings.slug}" async></script>`;
  return (
    <Section
      title={t('builder.bot.share.title')}
      lead={t('builder.bot.lead', { max: BOT_LIMITS.replyMaxCredits })}
    >
      {status !== 'active' ? (
        <p className="mt-4 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[14px] leading-6 text-text">
          {status === 'draft' ? t('builder.bot.share.draft') : t('builder.bot.share.paused')}
        </p>
      ) : null}
      <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <p className="text-[14px] font-medium text-text">{t('builder.bot.share.link')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-stroke bg-surface px-3 py-2 text-[14px] text-text">
                {overview.publicUrl}
              </code>
              <CopyButton value={overview.publicUrl} label={t('builder.bot.share.copyLink')} />
            </div>
          </div>
          <div>
            <p className="text-[14px] font-medium text-text">{t('builder.bot.share.embed')}</p>
            <p className="mt-1 text-[13px] leading-5 text-subtle">
              {t('builder.bot.share.embedHint')}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-lg border border-stroke bg-surface px-3 py-2 font-mono text-[13px] leading-5 break-all text-text">
                {embed}
              </code>
              <CopyButton value={embed} label={t('builder.bot.share.copyEmbed')} />
            </div>
          </div>
        </div>
        <figure className="flex flex-col items-start gap-2 sm:items-center">
          <QrCode value={overview.publicUrl} size={144} />
          <figcaption className="max-w-[12rem] text-[13px] leading-5 text-subtle sm:text-center">
            {t('builder.bot.share.qr')}
          </figcaption>
        </figure>
      </div>

      <h3 className="mt-8 text-[16px] font-medium text-text">{t('builder.bot.today.title')}</h3>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {(
          [
            ['builder.bot.today.replies', String(overview.today.replies)],
            ['builder.bot.today.credits', creditsText(translator, overview.today.credits)],
            ['builder.bot.today.leads', String(overview.today.newLeads)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-stroke bg-surface px-4 py-3">
            <dt className="text-[13px] text-subtle">{t(label)}</dt>
            <dd className="mt-1 text-[18px] font-medium text-text tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] leading-5 text-subtle">
        {t('builder.bot.today.cap', {
          amount: creditsText(translator, overview.settings.dailyCapCredits),
        })}
      </p>
      <RunwayNote runway={overview.balance} />
    </Section>
  );
}

/** Остаток владельца и на сколько дней его хватит ботам (этап C). */
export function RunwayNote({ runway }: { runway: BotRunway }) {
  const translator = useTranslation();
  const { t } = translator;
  const short = runway.daysLeft !== null && runway.daysLeft <= RUNWAY_WARN_DAYS;
  return (
    <div
      className={cn(
        'mt-4 flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        short || runway.credits <= 0 ? 'border-warning/40 bg-warning-soft' : 'border-stroke',
      )}
    >
      <p className="text-[14px] leading-6 text-text">
        {runway.daysLeft !== null
          ? t('builder.bot.runway.days', {
              amount: creditsText(translator, runway.credits),
              daily: creditsText(translator, runway.dailyCredits),
              days: runway.daysLeft,
            })
          : t('builder.bot.runway.noSpend', { amount: creditsText(translator, runway.credits) })}
      </p>
      <Link
        to="/pricing"
        className={buttonClasses({
          variant: short ? 'primary' : 'outline',
          size: 'sm',
          className: 'shrink-0 self-start sm:self-auto',
        })}
      >
        {t('builder.bot.runway.topUp')}
      </Link>
    </div>
  );
}

/** «Хватит на N дней» с этого порога подсвечивается и зовёт пополнить. */
const RUNWAY_WARN_DAYS = 3;

// ─── Проба «как клиент» ──────────────────────────────────────────────────────

interface PreviewItem {
  role: 'user' | 'assistant';
  content: string;
  offerContact?: boolean;
  chargedCredits?: number;
}

function PreviewSection({ id }: { id: string }) {
  const translator = useTranslation();
  const { t } = translator;
  const inputId = useId();
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    const history = [...items, { role: 'user' as const, content }];
    setItems(history);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const reply = await previewBot(
        id,
        history.slice(-12).map(({ role, content: text }) => ({ role, content: text })),
      );
      setItems([...history, { role: 'assistant', ...reply }]);
    } catch (caught) {
      setItems(items);
      setDraft(content);
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('builder.bot.preview.title')}
      lead={t('builder.bot.preview.lead', { max: BOT_LIMITS.replyMaxCredits })}
    >
      <div className="mt-4 rounded-2xl border border-stroke bg-surface-2/40 p-4">
        <ol className="flex min-h-[6rem] flex-col gap-3" aria-live="polite">
          {items.length === 0 ? (
            <li className="text-[14px] text-subtle">{t('builder.bot.preview.empty')}</li>
          ) : null}
          {items.map((item, index) => (
            <li
              key={index}
              className={cn('flex flex-col', item.role === 'user' ? 'items-end' : 'items-start')}
            >
              <p
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap text-text',
                  item.role === 'user' ? 'bg-accent-soft' : 'border border-stroke bg-surface',
                )}
              >
                {item.content}
              </p>
              {item.role === 'assistant' ? (
                <p className="mt-1 text-[12px] text-subtle">
                  {item.offerContact ? `${t('builder.bot.offerContact')} · ` : ''}
                  {t('builder.bot.preview.charged', {
                    amount: creditsText(translator, item.chargedCredits ?? 0),
                  })}
                </p>
              ) : null}
            </li>
          ))}
          {busy ? (
            <li className="flex items-center gap-2 text-[14px] text-muted">
              <Spinner /> {t('botPage.thinking')}
            </li>
          ) : null}
        </ol>
        <form onSubmit={(event) => void send(event)} className="mt-4 flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            {t('builder.bot.preview.input')}
          </label>
          <input
            id={inputId}
            value={draft}
            maxLength={BOT_LIMITS.message}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('builder.bot.preview.input')}
            className={cn(inputClass, 'flex-1')}
          />
          <Button type="submit" loading={busy} disabled={busy || !draft.trim()}>
            {t('builder.bot.preview.send')}
          </Button>
        </form>
        {items.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setItems([]);
              setError(null);
            }}
          >
            {t('builder.bot.preview.reset')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorNotice error={error} redirect={`/solutions/${id}`} />
        </div>
      ) : null}
    </Section>
  );
}

// ─── Заявки ──────────────────────────────────────────────────────────────────

function LeadsSection({ id }: { id: string }) {
  const { t, language } = useTranslation();
  const [leads, setLeads] = useState<BotLeadView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    listBotLeads(id).then(setLeads, setError);
  }, [id]);

  const toggle = async (lead: BotLeadView) => {
    setError(null);
    try {
      const next = await setBotLeadStatus(id, lead.id, lead.status === 'new' ? 'done' : 'new');
      setLeads((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null);
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <Section title={t('builder.bot.leads.title')}>
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${id}`} />
        </div>
      ) : null}
      {leads === null && !error ? (
        <p className="mt-4">
          <Spinner />
        </p>
      ) : null}
      {leads && leads.length === 0 ? (
        <p className="mt-3 text-[14px] leading-6 text-muted">{t('builder.bot.leads.empty')}</p>
      ) : null}
      {leads && leads.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {leads.map((lead) => (
            <li
              key={lead.id}
              className={cn(
                'rounded-xl border px-5 py-4',
                lead.status === 'new' ? 'border-stroke-strong bg-surface' : 'border-stroke',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[15px] font-medium break-words text-text">
                  {lead.name} · <span className="font-normal select-all">{lead.contact}</span>
                </p>
                <Badge tone={lead.status === 'new' ? 'brand' : 'neutral'}>
                  {lead.status === 'new' ? t('builder.bot.leads.new') : t('builder.bot.leads.done')}
                </Badge>
              </div>
              {lead.question ? (
                <p className="mt-1 text-[14px] leading-6 break-words whitespace-pre-wrap text-muted">
                  {lead.question}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-subtle">
                  {formatDateTime(lead.createdAt, language)}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void toggle(lead)}>
                  {lead.status === 'new'
                    ? t('builder.bot.leads.markDone')
                    : t('builder.bot.leads.markNew')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

// ─── Диалоги и исправления ───────────────────────────────────────────────────

function ConversationsSection({
  id,
  overview,
  onSave,
}: {
  id: string;
  overview: BotOverview;
  onSave: (patch: Partial<BotSettings>) => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<BotConversationView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<BotMessageView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    listBotConversations(id).then(setItems, setError);
  }, [id]);

  const show = async (conversationId: string) => {
    if (open === conversationId) {
      setOpen(null);
      return;
    }
    setOpen(conversationId);
    setMessages(null);
    try {
      setMessages(await fetchBotConversation(id, conversationId));
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <Section
      title={t('builder.bot.conversations.title')}
      lead={t('builder.bot.conversations.lead')}
    >
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${id}`} />
        </div>
      ) : null}
      {items && items.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">{t('builder.bot.conversations.empty')}</p>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-stroke">
              <button
                type="button"
                aria-expanded={open === item.id}
                onClick={() => void show(item.id)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-5 py-3 text-left text-[14px] text-text hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <span>
                  {t('builder.bot.conversations.item', {
                    count: item.messageCount,
                    date: formatDateTime(item.updatedAt, language),
                  })}
                </span>
                <span className="text-muted">
                  {open === item.id
                    ? t('builder.bot.conversations.close')
                    : t('builder.bot.conversations.open')}
                </span>
              </button>
              {open === item.id ? (
                <div className="border-t border-stroke px-5 py-4">
                  {messages === null ? (
                    <Spinner />
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {messages.map((message, index) => (
                        <ConversationMessage
                          key={message.id}
                          message={message}
                          question={
                            message.role === 'assistant'
                              ? (messages
                                  .slice(0, index)
                                  .reverse()
                                  .find((item) => item.role === 'user')?.content ?? '')
                              : ''
                          }
                          canCorrect={overview.settings.corrections.length < BOT_LIMITS.corrections}
                          onCorrect={(question, answer) =>
                            onSave({
                              corrections: [...overview.settings.corrections, { question, answer }],
                            })
                          }
                        />
                      ))}
                    </ol>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function ConversationMessage({
  message,
  question,
  canCorrect,
  onCorrect,
}: {
  message: BotMessageView;
  question: string;
  canCorrect: boolean;
  onCorrect: (question: string, answer: string) => Promise<void>;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const answerId = useId();
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const user = message.role === 'user';
  return (
    <li className={cn('flex flex-col gap-1', user ? 'items-end' : 'items-start')}>
      <span className="text-[12px] text-subtle">
        {user ? t('builder.bot.conversations.client') : t('builder.bot.conversations.bot')}
      </span>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap',
          user ? 'bg-accent-soft text-text' : 'border border-stroke bg-surface text-text',
          message.status === 'error' && 'text-danger',
        )}
      >
        {message.content}
      </p>
      {!user ? (
        <p className="text-[12px] text-subtle">
          {message.offerContact ? `${t('builder.bot.offerContact')} · ` : ''}
          {creditsText(translator, message.chargedCredits)}
        </p>
      ) : null}
      {!user && question && canCorrect && !editing && !saved ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {t('builder.bot.fix')}
        </Button>
      ) : null}
      {saved ? (
        <p role="status" className="text-[13px] text-success">
          {t('builder.bot.settings.saved')}
        </p>
      ) : null}
      {editing ? (
        <form
          className="mt-1 flex w-full flex-col gap-2 rounded-xl border border-stroke-strong px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            onCorrect(
              question.slice(0, BOT_LIMITS.correctionChars),
              answer.trim().slice(0, BOT_LIMITS.correctionChars),
            )
              .then(() => {
                setEditing(false);
                setSaved(true);
              })
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor={answerId} className="text-[13px] leading-5 text-muted">
            {t('builder.bot.fixHint')}
          </label>
          <textarea
            id={answerId}
            rows={3}
            value={answer}
            maxLength={BOT_LIMITS.correctionChars}
            onChange={(event) => setAnswer(event.target.value)}
            className={textareaClass}
          />
          {error ? <ErrorNotice error={error} redirect="/solutions" /> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={busy || !answer.trim()}>
              {t('builder.bot.fixSave')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t('analysis.new.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

// ─── Настройки страницы ──────────────────────────────────────────────────────

function SettingsSection({
  solutionId,
  overview,
  saved,
  onEdit,
  onSave,
}: {
  solutionId: string;
  overview: BotOverview;
  saved: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<BotSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BotSettings>(overview.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ids = { slug: useId(), greeting: useId(), cap: useId() };
  const changed = JSON.stringify(settings) !== JSON.stringify(overview.settings);
  const update = (patch: Partial<BotSettings>) => {
    onEdit();
    setSettings((current) => ({ ...current, ...patch }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...settings,
        slug: settings.slug.trim().toLowerCase(),
        quickReplies: settings.quickReplies.map((item) => item.trim()).filter(Boolean),
        corrections: settings.corrections.filter(
          (item) => item.question.trim() && item.answer.trim(),
        ),
      });
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  return (
    <Section title={t('builder.bot.settings.title')}>
      <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.slug} className="text-[14px] font-medium text-text">
            {t('builder.bot.settings.slug')}
          </label>
          <p id={`${ids.slug}-hint`} className="text-[13px] leading-5 text-subtle">
            {t('builder.bot.settings.slugHint')}
          </p>
          <div className="flex items-center gap-1 text-[15px] text-muted">
            <span className="shrink-0">/b/</span>
            <input
              id={ids.slug}
              aria-describedby={`${ids.slug}-hint`}
              required
              minLength={BOT_LIMITS.slugMin}
              maxLength={BOT_LIMITS.slugMax}
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              value={settings.slug}
              onChange={(event) => update({ slug: event.target.value.toLowerCase() })}
              className={cn(inputClass, 'sm:max-w-xs')}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.greeting} className="text-[14px] font-medium text-text">
            {t('builder.bot.settings.greeting')}
          </label>
          <p id={`${ids.greeting}-hint`} className="text-[13px] leading-5 text-subtle">
            {t('builder.bot.settings.greetingHint')}
          </p>
          <textarea
            id={ids.greeting}
            aria-describedby={`${ids.greeting}-hint`}
            rows={2}
            maxLength={BOT_LIMITS.greeting}
            value={settings.greeting}
            onChange={(event) => update({ greeting: event.target.value })}
            className={textareaClass}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[14px] font-medium text-text">
            {t('builder.bot.settings.quickReplies')}
          </legend>
          <p className="text-[13px] leading-5 text-subtle">
            {t('builder.bot.settings.quickRepliesHint')}
          </p>
          {settings.quickReplies.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                aria-label={`${t('builder.bot.settings.quickReply')} ${index + 1}`}
                value={value}
                maxLength={BOT_LIMITS.quickReply}
                onChange={(event) =>
                  update({
                    quickReplies: settings.quickReplies.map((item, at) =>
                      at === index ? event.target.value : item,
                    ),
                  })
                }
                className={inputClass}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${t('builder.remove')} ${index + 1}`}
                onClick={() =>
                  update({ quickReplies: settings.quickReplies.filter((_, at) => at !== index) })
                }
              >
                {t('builder.remove')}
              </Button>
            </div>
          ))}
          {settings.quickReplies.length < BOT_LIMITS.quickReplies ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => update({ quickReplies: [...settings.quickReplies, ''] })}
            >
              {t('builder.bot.settings.addQuickReply')}
            </Button>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.cap} className="text-[14px] font-medium text-text">
            {t('builder.bot.settings.cap')}
          </label>
          <p id={`${ids.cap}-hint`} className="text-[13px] leading-5 text-subtle">
            {t('builder.bot.settings.capHint', { max: BOT_LIMITS.replyMaxCredits })}
          </p>
          <input
            id={ids.cap}
            aria-describedby={`${ids.cap}-hint`}
            type="number"
            inputMode="numeric"
            required
            min={BOT_LIMITS.dailyCapMin}
            max={BOT_LIMITS.dailyCapMax}
            step={1}
            value={settings.dailyCapCredits}
            onChange={(event) => update({ dailyCapCredits: Number(event.target.value) })}
            className={cn(inputClass, 'sm:max-w-[12rem]')}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[14px] font-medium text-text">
            {t('builder.bot.settings.corrections')}
          </legend>
          <p className="text-[13px] leading-5 text-subtle">
            {t('builder.bot.settings.correctionsHint')}
          </p>
          {settings.corrections.map((value, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2">
                <input
                  aria-label={`${t('builder.bot.settings.correctionQuestion')} ${index + 1}`}
                  placeholder={t('builder.bot.settings.correctionQuestion')}
                  value={value.question}
                  maxLength={BOT_LIMITS.correctionChars}
                  onChange={(event) =>
                    update({
                      corrections: settings.corrections.map((item, at) =>
                        at === index ? { ...item, question: event.target.value } : item,
                      ),
                    })
                  }
                  className={inputClass}
                />
                <textarea
                  aria-label={`${t('builder.bot.settings.correctionAnswer')} ${index + 1}`}
                  placeholder={t('builder.bot.settings.correctionAnswer')}
                  rows={2}
                  value={value.answer}
                  maxLength={BOT_LIMITS.correctionChars}
                  onChange={(event) =>
                    update({
                      corrections: settings.corrections.map((item, at) =>
                        at === index ? { ...item, answer: event.target.value } : item,
                      ),
                    })
                  }
                  className={textareaClass}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${t('builder.remove')} ${index + 1}`}
                onClick={() =>
                  update({ corrections: settings.corrections.filter((_, at) => at !== index) })
                }
              >
                {t('builder.remove')}
              </Button>
            </div>
          ))}
          {settings.corrections.length < BOT_LIMITS.corrections ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                update({ corrections: [...settings.corrections, { question: '', answer: '' }] })
              }
            >
              {t('builder.bot.settings.addCorrection')}
            </Button>
          ) : null}
        </fieldset>

        {error ? <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} /> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" loading={busy} disabled={busy || !changed} className="self-start">
            {t('builder.bot.settings.save')}
          </Button>
          <p className="text-[13px] text-subtle" aria-live="polite">
            {changed
              ? t('builder.bot.settings.unsaved')
              : saved
                ? t('builder.bot.settings.saved')
                : ''}
          </p>
        </div>
      </form>
    </Section>
  );
}
