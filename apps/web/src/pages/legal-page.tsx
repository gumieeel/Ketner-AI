import { Link } from 'react-router-dom';
import {
  formatLegalDate,
  getLegalDocument,
  LEGAL_PATHS,
  LEGAL_UPDATED,
  SUPPORT_EMAIL,
  type LegalPageId,
} from '@/features/content/legal';
import { useTranslation, type TranslationKey } from '@/i18n';

const LINKS: { id: LegalPageId; label: TranslationKey }[] = [
  { id: 'terms', label: 'legal.terms' },
  { id: 'privacy', label: 'legal.privacy' },
  { id: 'payment-terms', label: 'legal.paymentTerms' },
];

/** Правовые страницы: один шаблон, тексты на двух языках — в features/content/legal.ts. */
export function LegalPage({ id }: { id: LegalPageId }) {
  const { t, language } = useTranslation();
  const doc = getLegalDocument(id, language);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          {doc.title}
        </h1>
        <p className="text-[15px] leading-7 text-muted">{doc.lead}</p>
        <p className="text-[13px] text-subtle">
          {t('legal.updated', { date: formatLegalDate(LEGAL_UPDATED, language) })}
        </p>
        <nav aria-label={t('legal.nav')} className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
          {LINKS.map((link) => (
            <Link
              key={link.id}
              to={LEGAL_PATHS[link.id]}
              aria-current={link.id === id ? 'page' : undefined}
              className={link.id === id ? 'font-medium text-text' : 'text-muted hover:text-text'}
            >
              {t(link.label)}
            </Link>
          ))}
          <Link to="/contacts" className="text-muted hover:text-text">
            {t('legal.contacts')}
          </Link>
        </nav>
      </header>
      {doc.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text} className="text-[15px] leading-7 text-muted">
              {text}
            </p>
          ))}
          {section.items ? (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <p className="border-t border-stroke pt-6 text-[14px] text-muted">
        {t('legal.questions')}{' '}
        <a className="text-text underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
      </p>
    </article>
  );
}
