import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS, LEGAL_UPDATED, SUPPORT_EMAIL, type LegalPageId } from '@/features/content/legal';
import { useDocumentTitle } from '@/lib/use-document-title';

const LINKS: { id: LegalPageId; label: string }[] = [
  { id: 'terms', label: 'Соглашение и оферта' },
  { id: 'privacy', label: 'Конфиденциальность' },
  { id: 'payment-terms', label: 'Оплата и возврат' },
];

/** Правовые страницы: один шаблон, тексты — в features/content/legal.ts. */
export function LegalPage({ id }: { id: LegalPageId }) {
  const doc = LEGAL_DOCUMENTS[id];
  useDocumentTitle(`${doc.title} — Ketner AI`);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">{doc.title}</h1>
        <p className="text-[15px] leading-7 text-muted">{doc.lead}</p>
        <p className="text-[13px] text-subtle">Редакция от {LEGAL_UPDATED}</p>
        <nav aria-label="Правовая информация" className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
          {LINKS.map((link) => (
            <Link
              key={link.id}
              to={LEGAL_DOCUMENTS[link.id].path}
              aria-current={link.id === id ? 'page' : undefined}
              className={link.id === id ? 'font-medium text-text' : 'text-muted hover:text-text'}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/contacts" className="text-muted hover:text-text">
            Контакты
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
        Вопросы:{' '}
        <a className="text-text underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
      </p>
    </article>
  );
}
