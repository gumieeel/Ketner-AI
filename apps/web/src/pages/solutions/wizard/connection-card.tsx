import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/**
 * Карточка подключения на шаге 3 мастера (docs/BUILDER_V1.md, раздел 6): название, что Ketner
 * делает через это подключение, состояние словами и действие. Рамка — как у карточки Google
 * Таблицы, чтобы все подключения выглядели одинаково.
 */
export function ConnectionCard({
  id,
  title,
  description,
  state,
  children,
}: {
  id: string;
  title: string;
  description: string;
  state: { tone: BadgeTone; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stroke px-5 py-4" data-connection={id}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-medium text-text">{title}</p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="mt-1 text-[14px] leading-6 text-muted">{description}</p>
      {children ? <div className="mt-2 text-[14px] leading-6">{children}</div> : null}
    </div>
  );
}

/** Группа карточек: внешние сервисы (в тарифе), уведомления вам, каналы (на любом тарифе). */
export function ConnectionGroup({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const headingId = `connections-${id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-group={id}>
      <div>
        <h2 id={headingId} className="text-[18px] font-medium tracking-[-0.01em] text-text">
          {title}
        </h2>
        <p className="mt-1 text-[14px] leading-6 text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}
