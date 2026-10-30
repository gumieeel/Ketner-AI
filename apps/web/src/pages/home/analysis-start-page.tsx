import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/button-classes';
import { readDraft } from '@/features/discovery/draft';
import { useTranslation } from '@/i18n';
import { siteFeatures } from '@/lib/features';
import { NotFoundPage } from '@/pages/not-found-page';

/**
 * Начало анализа. Сам анализ (разбор задачи, вопросы, отчёт) подключается на этапе 2
 * (docs/MIGRATION_PLAN.md); до этого страница честно говорит, что анализ ещё не запущен, и
 * показывает сохранённое описание. Без включённой платформы решений адреса нет.
 */
export function AnalysisStartPage() {
  const { t } = useTranslation();
  if (!siteFeatures().discovery) return <NotFoundPage />;
  const draft = readDraft();

  return (
    <section
      aria-labelledby="analysis-start-title"
      className="mx-auto flex w-full max-w-[40rem] flex-col px-4 pt-[clamp(3rem,10vh,6rem)] pb-20 sm:px-6"
    >
      <h1
        id="analysis-start-title"
        className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-text"
      >
        {draft ? t('analysisStart.title') : t('analysisStart.emptyTitle')}
      </h1>
      <p className="t-lead mt-4">
        {draft ? t('analysisStart.lead') : t('analysisStart.emptyLead')}
      </p>

      {draft ? (
        <figure className="mt-8 rounded-xl border border-stroke bg-surface px-5 py-4">
          <figcaption className="text-[13px] text-subtle">
            {t('analysisStart.savedLabel')}
          </figcaption>
          <blockquote className="mt-2 text-[16px] leading-[1.6] whitespace-pre-wrap text-text">
            {draft.text}
          </blockquote>
        </figure>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {draft ? t('analysisStart.edit') : t('analysisStart.describe')}
        </Link>
        <Link to="/chat" className={buttonClasses({ variant: 'outline', size: 'md' })}>
          {t('analysisStart.openChat')}
        </Link>
      </div>
    </section>
  );
}
