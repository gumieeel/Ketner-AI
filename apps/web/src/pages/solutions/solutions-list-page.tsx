import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import {
  createBlankSolution,
  listSolutions,
  LIMITS,
  type SolutionView,
} from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BuilderGate, Page, StatusBadge } from './shared';

/** «Мои помощники»: список, создание с нуля, переход в чат включённого. */
export function SolutionsListPage() {
  return (
    <BuilderGate>
      <SolutionsList />
    </BuilderGate>
  );
}

function SolutionsList() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<SolutionView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listSolutions());
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
                <p className="mt-1 text-[13px] text-subtle">
                  {item.source
                    ? t('builder.list.fromOpportunity', { title: item.source.title })
                    : t('builder.list.blank')}
                  {' · '}
                  {formatDateTime(item.updatedAt, language)}
                </p>
              </div>
              {item.status === 'active' ? (
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
