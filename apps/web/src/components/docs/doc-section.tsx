import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { DocHeading } from './doc-heading';

export interface DocSectionProps {
  /** Якорь раздела: на него ссылается навигация и подсветка текущего раздела. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Иконка в плитке слева от заголовка (или метод HTTP — любой узел). */
  icon?: ReactNode;
  /** Справа от заголовка; на узких экранах переносится вниз. */
  aside?: ReactNode;
  /** Показать иконку без плитки (например, бейдж метода HTTP). */
  bareIcon?: boolean;
  /** Заголовок в моноширинном начертании (пути эндпоинтов). */
  monoTitle?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Карточка раздела документации. Якорь раздела — на самой карточке,
 * заголовок получает собственный id, чтобы в документе не было повторов.
 */
export function DocSection({
  id,
  title,
  description,
  icon,
  aside,
  bareIcon = false,
  monoTitle = false,
  className,
  children,
}: DocSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        '@container flex scroll-mt-32 flex-col gap-5 rounded-2xl border border-stroke bg-surface p-4 shadow-sm sm:p-6 md:p-7 xl:scroll-mt-24',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-stroke pb-4">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3.5">
          {icon ? (
            bareIcon ? (
              <span className="mt-1 shrink-0">{icon}</span>
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent ring-1 ring-stroke ring-inset">
                {icon}
              </span>
            )
          ) : null}
          <div className="min-w-0">
            <DocHeading
              level={2}
              id={`${id}-heading`}
              className={cn('mt-0 mb-0 text-base md:text-lg', monoTitle && 'font-mono')}
            >
              {title}
            </DocHeading>
            {description ? (
              <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p>
            ) : null}
          </div>
        </div>
        {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
