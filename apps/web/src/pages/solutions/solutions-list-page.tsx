import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import {
  createBlankSolution,
  listAutomations,
  type BotRunway,
  LIMITS,
  type SolutionView,
} from '@/features/builder/api';
import { creditsText } from '@/features/discovery/format';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { RunwayNote } from './bot-panel';
import { TemplateGallery } from './template-gallery';
import { BuilderGate, Page, StatusBadge } from './shared';

/** «Мои автоматизации»: список, создание с нуля и из галереи, переход в чат включённого помощника. */
export function SolutionsListPage() {
  return (
    <BuilderGate>
      <SolutionsList />
    </BuilderGate>
  );
}

function SolutionsList() {
  const translator = useTranslation();
  const { t, language } = translator;
  const navigate = useNavigate();
  const [items, setItems] = useState<SolutionView[] | null>(null);
  const [runway, setRunway] = useState<BotRunway | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listAutomations();
      setItems(result.solutions);
      setRunway(result.runway ?? null);
    } catch (caught) {
      setError(caught);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    createBlankSolution(name.trim(), language)
      .then((solution) => navigate(`/solutions/${solution.id}`))
      .catch((caught: unknown) => {
        setError(caught);
        setCreating(false);
      });
  };

  return (
    <Page title={t('builder.list.title')}>
      <p className="t-lead mt-4">{t('builder.list.lead')}</p>
      {runway ? <RunwayNote runway={runway} /> : null}

      <form onSubmit={create} className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] text-muted">{t('builder.list.newName')}</span>
          <input
            value={name}
            maxLength={LIMITS.name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('builder.list.namePlaceholder')}
            className="h-11 rounded-xl border border-stroke bg-surface px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </label>
        <Button type="submit" loading={creating} disabled={creating || !name.trim()}>
          {t('builder.list.createBlank')}
        </Button>
      </form>
      <p className="mt-2 text-[13px] text-subtle">{t('builder.list.fromAnalysis')}</p>

      <TemplateGallery />

      {error ? (
        <div className="mt-6">
          <ErrorNotice error={error} redirect="/solutions" />
        </div>
      ) : null}
      {items === null && !error ? (
        <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.page.loading')}
        </p>
      ) : null}
      {items && items.length === 0 ? (
        <p className="mt-8 text-[15px] leading-6 text-muted">{t('builder.list.empty')}</p>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="mt-8 flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/solutions/${item.id}`}
                    className="text-[16px] leading-6 font-medium break-words text-text underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </Link>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {item.template === 'study_assistant'
                    ? t('study.badge')
                    : t(`builder.type.${item.type}` as TranslationKey)}
                  {item.today
                    ? ` · ${t('builder.list.today', {
                        replies: item.today.replies,
                        credits: creditsText(translator, item.today.credits),
                        leads: item.today.newLeads,
                      })}`
                    : ''}
                </p>
                <p className="mt-1 text-[13px] text-subtle">
                  {item.source
                    ? t('builder.list.fromOpportunity', { title: item.source.title })
                    : t('builder.list.blank')}
                  {' · '}
                  {formatDateTime(item.updatedAt, language)}
                </p>
              </div>
              {item.type === 'customer_bot' && item.bot && item.status !== 'draft' ? (
                <a
                  href={`/b/${item.bot.slug}`}
                  target="_blank"
                  rel="noopener"
                  className={buttonClasses({
                    variant: 'secondary',
                    size: 'sm',
                    className: 'shrink-0',
                  })}
                >
                  {t('builder.list.openPage')}
                </a>
              ) : item.kind === 'assistant' && item.status === 'active' ? (
                <Link
                  to={`/solutions/${item.id}/chat`}
                  className={buttonClasses({
                    variant: 'secondary',
                    size: 'sm',
                    className: 'shrink-0',
                  })}
                >
                  {t('builder.openChat')}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Page>
  );
}
