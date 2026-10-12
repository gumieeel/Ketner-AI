import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface DocsNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface DocsTocItem {
  id: string;
  label: string;
  level?: number;
}

export interface DocsLayoutProps {
  nav: DocsNavItem[];
  /** Содержание страницы справа (xl+). Если не нужно — опускается, и колонка контента шире. */
  toc?: DocsTocItem[];
  activeId?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Каркас страниц документации: слева разделы, по центру контент, справа (необязательно)
 * содержание. На экранах уже xl разделы превращаются в закреплённую полосу вкладок.
 * Сам контент — обычный блок, не `main`: ландшафт страницы задаёт внешний каркас.
 */
export function DocsLayout({ nav, toc, activeId, children, className }: DocsLayoutProps) {
  const { t } = useTranslation();
  const hasToc = Boolean(toc && toc.length > 0);

  return (
    <div className={cn('w-full', className)}>
      {/* Узкие экраны: закреплённая полоса разделов под шапкой сайта */}
      <nav
        aria-label={t('docs.navLabel')}
        className="sticky top-16 z-20 -mx-4 mb-6 border-b border-stroke bg-canvas px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden"
      >
        <ul className="flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {nav.map((item) => {
            const isActive = activeId === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-surface-2 text-text ring-1 ring-stroke-strong ring-inset'
                      : 'text-muted hover:bg-surface hover:text-text',
                  )}
                >
                  {item.icon ? <span className="size-4 shrink-0">{item.icon}</span> : null}
                  <span>{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={cn(
          'grid grid-cols-1 gap-8 xl:gap-12',
          hasToc ? 'xl:grid-cols-[210px_minmax(0,1fr)_176px]' : 'xl:grid-cols-[210px_minmax(0,1fr)]',
        )}
      >
        {/* Разделы (xl+) */}
        <aside className="hidden xl:block">
          <nav aria-label={t('docs.navLabel')} className="sticky top-24">
            <p className="px-2.5 pb-2 text-xs font-semibold text-subtle">{t('docs.sections')}</p>
            <ul className="flex flex-col gap-0.5">
              {nav.map((item) => {
                const isActive = activeId === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'bg-surface-2 text-text ring-1 ring-stroke ring-inset'
                          : 'text-muted hover:bg-surface hover:text-text',
                      )}
                    >
                      {item.icon ? (
                        <span className={cn('size-4 shrink-0', isActive ? 'text-accent' : 'text-subtle')}>
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="truncate">{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* Контент */}
        <div className="min-w-0">{children}</div>

        {/* Содержание страницы (xl+) */}
        {hasToc ? (
          <aside className="hidden xl:block">
            <nav aria-label={t('docs.tocLabel')} className="sticky top-24">
              <p className="pb-2 pl-3 text-xs font-semibold text-subtle">{t('docs.onThisPage')}</p>
              <ul className="flex flex-col border-l border-stroke">
                {toc?.map((item) => {
                  const isActive = activeId === item.id;
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          '-ml-px block border-l-2 py-1.5 text-[13px] leading-5 transition-colors',
                          item.level === 3 ? 'pl-6' : 'pl-3',
                          isActive
                            ? 'border-accent font-medium text-accent'
                            : 'border-transparent text-muted hover:border-stroke-strong hover:text-text',
                        )}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
