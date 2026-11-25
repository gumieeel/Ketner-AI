import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { BOT_LIMITS, previewBot } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from '@/pages/analysis/error-notice';

const inputClass =
  'h-11 w-full rounded-xl border border-stroke bg-surface px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

interface PreviewItem {
  role: 'user' | 'assistant';
  content: string;
  offerContact?: boolean;
  chargedCredits?: number;
}

/**
 * Проба «как клиент»: текущая (не включённая) версия бота, ничего не сохраняется, платит бесплатный
 * лимит создания. На странице бота и справа на шаге 2 мастера.
 */
export function BotPreviewChat({ id }: { id: string }) {
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
    <div>
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
                item.offerContact ? (
                  <p className="mt-1 text-[12px] text-subtle">{t('builder.bot.offerContact')}</p>
                ) : null
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
    </div>
  );
}
