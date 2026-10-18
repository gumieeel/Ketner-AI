import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  CHANGE_KIND_LABELS,
  RELEASES,
  ROADMAP,
  formatReleaseDate,
  type ChangeKind,
} from '@/features/content/changelog';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { useDocumentTitle } from '@/lib/use-document-title';

const KIND_TONE: Record<ChangeKind, BadgeTone> = {
  new: 'brand',
  improved: 'info',
  fixed: 'success',
  removed: 'neutral',
};

const navLinkClass = 'text-muted underline-offset-4 hover:text-text hover:underline';

/** «Что нового»: вышедшие обновления отдельно от планов и известных ограничений. */
export function ChangelogPage() {
  useDocumentTitle('Что нового — Ketner AI');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Что нового
        </h1>
        <p className="text-[15px] leading-7 text-muted">
          Здесь только то, что уже работает на сайте. Планы — отдельно, ниже: пока функция в планах,
          считайте, что её нет.
        </p>
        <nav aria-label="Разделы" className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          <a href="#releases" className={navLinkClass}>
            Обновления
          </a>
          <a href="#roadmap" className={navLinkClass}>
            В планах
          </a>
          <a href="#limitations" className={navLinkClass}>
            Известные ограничения
          </a>
        </nav>
      </header>

      <section id="releases" aria-label="Обновления" className="flex scroll-mt-20 flex-col gap-8">
        {RELEASES.map((release) => (
          <article key={release.date} className="flex flex-col gap-3 border-l border-stroke pl-5">
            <header className="flex flex-col gap-0.5">
              <time dateTime={release.date} className="text-[13px] text-subtle">
                {formatReleaseDate(release.date)}
              </time>
              <h2 className="text-lg font-semibold tracking-tight text-text">{release.title}</h2>
            </header>
            <ul className="flex flex-col gap-2">
              {release.items.map((item) => (
                <li key={item.text} className="flex items-start gap-2.5 text-[15px] leading-6">
                  <Badge tone={KIND_TONE[item.kind]} className="mt-0.5 w-[86px] justify-center">
                    {CHANGE_KIND_LABELS[item.kind]}
                  </Badge>
                  <span className="text-muted">{item.text}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section
        id="roadmap"
        className="flex scroll-mt-20 flex-col gap-3 rounded-xl border border-dashed border-stroke-strong p-5"
      >
        <h2 className="text-xl font-semibold tracking-tight">В планах</h2>
        <p className="text-[14px] leading-6 text-muted">
          Ещё не готово. Сроков не обещаем, порядок может меняться.
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          {ROADMAP.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-[14px] leading-6 text-muted">
          Не хватает чего-то важного?{' '}
          <Link to="/contacts?topic=idea" className="text-text underline underline-offset-4">
            Предложите функцию
          </Link>
          .
        </p>
      </section>

      <section id="limitations" className="flex scroll-mt-20 flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Известные ограничения</h2>
        <ul className="flex flex-col gap-3">
          {KNOWN_ISSUES.map((issue) => (
            <li key={issue.id} className="text-[15px] leading-6">
              <span className="font-medium text-text">{issue.title}.</span>{' '}
              <span className="text-muted">{issue.details}</span>
            </li>
          ))}
        </ul>
        <p className="text-[14px] leading-6 text-muted">
          Текущее состояние сервиса и история сбоев — на{' '}
          <Link to="/status" className="text-text underline underline-offset-4">
            странице статуса
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
