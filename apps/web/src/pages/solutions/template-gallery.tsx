import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { createFromTemplate, listTemplates, type TemplateCard } from '@/features/builder/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { ErrorNotice } from '@/pages/analysis/error-notice';

/** Что умеет шаблон — для карточки. Шаблон без описания здесь показывается только названием. */
const DETAILS: Record<string, { features: TranslationKey[]; formats?: string }> = {
  study_assistant: {
    features: [
      'gallery.study.notes',
      'gallery.study.tables',
      'gallery.study.quizzes',
      'gallery.study.selfCheck',
      'gallery.study.grading',
      'gallery.study.progress',
    ],
    formats: 'PDF, DOCX, PPTX, XLSX, TXT',
  },
};

/**
 * Галерея готовых инструментов. Список приходит с сервера: в нём только реализованные и включённые
 * шаблоны, поэтому выключенный инструмент здесь не появится. Нечего показать — блока нет.
 */
export function TemplateGallery() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TemplateCard[]>([]);

  useEffect(() => {
    let alive = true;
    // Галерея — дополнение к списку: если не загрузилась, страница работает без неё.
    listTemplates().then(
      (items) => alive && setTemplates(items),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (templates.length === 0) return null;
  return (
    <section aria-labelledby="gallery-title" className="mt-10">
      <h2 id="gallery-title" className="text-[20px] font-medium tracking-[-0.01em] text-text">
        {t('gallery.title')}
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-muted">{t('gallery.lead')}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {templates.map((template) => (
          <li key={template.id}>
            <GalleryCard template={template} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GalleryCard({ template }: { template: TemplateCard }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const details = DETAILS[template.id];
  const titleId = `template-${template.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col gap-3 rounded-xl border border-stroke bg-surface p-5"
    >
      <div>
        <h3 id={titleId} className="text-[16px] font-medium text-text">
          {template.label}
        </h3>
        <p className="mt-1 text-[14px] leading-6 text-muted first-letter:uppercase">
          {template.description}
        </p>
      </div>
      {details ? (
        <>
          <ul
            aria-label={t('gallery.features')}
            className="flex flex-col gap-1 text-[14px] leading-6 text-text"
          >
            {details.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden className="text-subtle">
                  ·
                </span>
                {t(feature)}
              </li>
            ))}
          </ul>
          {details.formats ? (
            <p className="text-[13px] leading-5 text-subtle">
              {t('gallery.formats', { formats: details.formats })}
            </p>
          ) : null}
        </>
      ) : null}
      <p className="text-[13px] leading-5 text-subtle">{t('gallery.price')}</p>
      {error ? <ErrorNotice error={error} redirect="/solutions" /> : null}
      <div className="mt-auto pt-1">
        <Button
          variant="outline"
          size="sm"
          loading={busy}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            createFromTemplate(template.id, language)
              .then((solution) => navigate(`/solutions/${solution.id}`))
              .catch((caught: unknown) => {
                setError(caught);
                setBusy(false);
              });
          }}
        >
          {t('gallery.create')}
        </Button>
      </div>
    </article>
  );
}
