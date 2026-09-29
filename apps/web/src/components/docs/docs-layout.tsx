import type { ReactNode } from 'react';
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
  toc?: DocsTocItem[];
  activeId?: string;
  children: ReactNode;
  className?: string;
}

export function DocsLayout({ nav, toc, activeId, children, className }: DocsLayoutProps) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8', className)}>
      {/* Mobile / Tablet Horizontal Navigation Chips */}
      <div className="mb-6 flex items-center gap-1.5 overflow-x-auto pb-2 xl:hidden border-b border-stroke">
        {nav.map((item) => {
          const isActive = activeId === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-surface-2 text-text border border-stroke'
                  : 'text-muted hover:text-text hover:bg-surface-2/60',
              )}
            >
              {item.icon ? <span className="size-3.5 shrink-0">{item.icon}</span> : null}
              <span>{item.label}</span>
            </a>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[220px_minmax(0,1fr)_200px] xl:gap-10">
        {/* Left Sticky Navigation (Desktop) */}
        <aside className="hidden xl:block">
          <nav className="sticky top-20 flex flex-col gap-1 text-sm">
            <p className="px-2 pb-2 text-[11px] font-mono font-medium uppercase tracking-[0.06em] text-subtle">
              Разделы
            </p>
            {nav.map((item) => {
              const isActive = activeId === item.id;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-surface-2 text-text font-semibold'
                      : 'text-muted hover:text-text hover:bg-surface-2/60',
                  )}
                >
                  {item.icon ? (
                    <span className={cn('size-4 shrink-0', isActive ? 'text-accent' : 'text-subtle')}>
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="truncate">{item.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Center Content */}
        <main className="min-w-0">
          <div className="max-w-[68ch] [&>*:not(table):not(.code-block):not(pre):not(.overflow-x-auto)]:max-w-[68ch]">
            {children}
          </div>
        </main>

        {/* Right Sticky TOC (Desktop) */}
        {toc && toc.length > 0 ? (
          <aside className="hidden xl:block">
            <nav className="sticky top-20 flex flex-col gap-1 text-xs">
              <p className="px-2 pb-2 text-[11px] font-mono font-medium uppercase tracking-[0.06em] text-subtle">
                На этой странице
              </p>
              <ul className="space-y-1 font-mono text-[11px]">
                {toc.map((item) => {
                  const isActive = activeId === item.id;
                  return (
                    <li key={item.id} className={item.level === 3 ? 'pl-2' : ''}>
                      <a
                        href={`#${item.id}`}
                        className={cn(
                          'block truncate py-1 transition-colors',
                          isActive
                            ? 'text-accent font-medium'
                            : 'text-muted hover:text-text',
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
        ) : (
          <div className="hidden xl:block" />
        )}
      </div>
    </div>
  );
}
