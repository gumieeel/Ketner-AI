import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { downloadCsv, toCsv } from '@/features/study/csv';
import type { NotesResult, RunSource, TableResult } from '@/features/study/api';
import { useTranslation } from '@/i18n';

/** Откуда взят элемент результата: документ и часть (страница, слайд), как в материалах. */
export function SourceChips({
  refs,
  sources,
}: {
  refs: readonly string[];
  sources: readonly RunSource[];
}) {
  const { t } = useTranslation();
  const byRef = new Map(sources.map((source) => [source.ref, source]));
  const found = refs.map((ref) => byRef.get(ref)).filter(Boolean) as RunSource[];
  if (found.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-subtle">
      <span>{t('study.result.source')}</span>
      {found.map((source) => (
        <span
          key={source.ref}
          className="rounded-md border border-stroke px-1.5 py-0.5 text-muted"
          title={`${source.materialName} · ${source.label}`}
        >
          {source.materialName} · {source.label}
        </span>
      ))}
    </p>
  );
}

function notesText(notes: NotesResult): string {
  const lines = [notes.title, '', notes.summary, ''];
  for (const section of notes.sections) {
    lines.push(section.heading);
    for (const point of section.points) lines.push(`• ${point}`);
    for (const term of section.keyTerms) lines.push(`  ${term.term} — ${term.definition}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function NotesView({ notes, sources }: { notes: NotesResult; sources: RunSource[] }) {
  const { t } = useTranslation();
  return (
    <article aria-label={t('study.operation.notes')} className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[38rem] text-[16px] leading-7 text-text">{notes.summary}</p>
        <CopyButton value={notesText(notes)} label={t('study.result.copy')} />
      </div>
      {notes.sections.map((section, index) => (
        <section key={`${index}-${section.heading}`} className="mt-8 border-t border-stroke pt-6">
          <h2 className="text-[19px] font-medium tracking-[-0.01em] text-text">
            {section.heading}
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-text">
            {section.points.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
          {section.keyTerms.length > 0 ? (
            <dl className="mt-4 grid gap-x-4 gap-y-2 rounded-xl bg-surface-2 p-4 text-[14px] leading-6 sm:grid-cols-[minmax(8rem,auto)_1fr]">
              {section.keyTerms.map((term, i) => (
                <div key={i} className="contents">
                  <dt className="font-medium text-text">{term.term}</dt>
                  <dd className="text-muted">{term.definition}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <SourceChips refs={section.sources} sources={sources} />
        </section>
      ))}
    </article>
  );
}

export function TableView({ table, sources }: { table: TableResult; sources: RunSource[] }) {
  const { t } = useTranslation();
  const byRef = new Map(sources.map((source) => [source.ref, source]));
  const sourceText = (refs: readonly string[]) =>
    refs
      .map((ref) => byRef.get(ref))
      .filter(Boolean)
      .map((source) => `${source!.materialName} · ${source!.label}`)
      .join('; ');
  const exportCsv = () =>
    downloadCsv(
      `${table.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'table'}.csv`,
      toCsv(
        [...table.columns, t('study.result.sourceColumn')],
        table.rows.map((row) => [...row.cells, sourceText(row.sources)]),
      ),
    );
  return (
    <article aria-label={t('study.operation.table')} className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {table.description ? (
          <p className="max-w-[38rem] text-[15px] leading-7 text-muted">{table.description}</p>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" onClick={exportCsv}>
          {t('study.result.csv')}
        </Button>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-stroke">
        <table className="w-full border-collapse text-left text-[14px] leading-6">
          <caption className="sr-only">{table.title}</caption>
          <thead className="bg-surface-2">
            <tr>
              {table.columns.map((column, i) => (
                <th key={i} scope="col" className="px-3 py-2 font-medium text-text">
                  {column}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium text-subtle">
                {t('study.result.sourceColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t border-stroke align-top">
                {row.cells.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-text">
                    {cell}
                  </td>
                ))}
                <td className="px-3 py-2 text-[12px] text-subtle">{sourceText(row.sources)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
