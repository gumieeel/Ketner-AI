import { useMemo, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
import { Spinner } from '@/components/ui/spinner';
import { useCode } from '@/features/code/code-store';
import type { PlanItem } from '@/features/code/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface AgentPlan {
  items: PlanItem[];
  /** План текущего запуска (а не сохранённый план прошлого). */
  live: boolean;
  done: number;
}

/**
 * План, который показывает список задач: во время запуска — живой, после — план последнего запуска
 * из ленты (сервер сохраняет его в записи о завершении, поэтому он переживает перезагрузку).
 */
export function useAgentPlan(): AgentPlan | null {
  const live = useCode((state) => state.live);
  const running = useCode((state) => state.running);
  const thread = useCode((state) => state.thread);
  return useMemo(() => {
    let items: PlanItem[] | undefined;
    let isLive = false;
    if (running) {
      items = live?.plan;
      isLive = true;
    } else {
      for (let i = thread.length - 1; i >= 0; i -= 1) {
        const item = thread[i];
        if (item.kind === 'run') {
          items = item.plan;
          break;
        }
      }
    }
    if (!items || items.length === 0) return null;
    return { items, live: isLive, done: items.filter((item) => item.status === 'done').length };
  }, [live, running, thread]);
}

/** Кольцо прогресса для компактного индикатора в шапке проекта. */
export function PlanProgressRing({ done, total, className }: { done: number; total: number; className?: string }) {
  const radius = 7;
  const length = 2 * Math.PI * radius;
  const share = total > 0 ? done / total : 0;
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={cn('size-4 -rotate-90', className)}>
      <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" className="stroke-stroke-strong" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - share)}
        className="stroke-accent transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

function StatusMark({ status, live }: { status: PlanItem['status']; live: boolean }) {
  if (status === 'done') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === 'in_progress') {
    return live ? (
      <Spinner className="size-4 shrink-0 text-accent" />
    ) : (
      <span className="block size-4 shrink-0 rounded-full border-2 border-accent" />
    );
  }
  return <span className="block size-4 shrink-0 rounded-full border border-stroke-strong" />;
}

/**
 * Список задач агента (как в Claude Code): задача разбита на подзадачи, агент проходит их по очереди.
 * Закреплён в верхней части панели агента, не уезжает вместе с лентой; сворачивается.
 */
export function TaskList() {
  const { t } = useTranslation();
  const plan = useAgentPlan();
  const [collapsed, setCollapsed] = useState(false);
  if (!plan) return null;

  const total = plan.items.length;
  const current = plan.items.find((item) => item.status === 'in_progress');

  return (
    <section aria-label={t('code.tasks.title')} className="shrink-0 border-b border-stroke bg-surface/60 px-3 py-2">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full min-h-8 items-center gap-2 rounded-md text-left"
      >
        <PlanProgressRing done={plan.done} total={total} />
        <span className="text-[13px] font-semibold text-text">{t('code.tasks.title')}</span>
        <span className="tabular text-xs text-muted">{t('code.tasks.progress', { done: plan.done, total })}</span>
        {collapsed && current ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted">· {current.text}</span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-subtle transition-transform duration-200', collapsed && '-rotate-90')}
        />
      </button>
      {!collapsed ? (
        <ol className="mt-1.5 flex max-h-44 flex-col gap-1 overflow-y-auto pb-0.5">
          {plan.items.map((item, index) => (
            <li
              key={`${index}-${item.text}`}
              aria-current={item.status === 'in_progress' ? 'step' : undefined}
              className={cn(
                'flex items-start gap-2 rounded-md px-1.5 py-1 text-[13px] leading-5',
                item.status === 'in_progress' && 'bg-accent-soft',
              )}
            >
              <span className="mt-0.5 flex shrink-0">
                <StatusMark status={item.status} live={plan.live} />
              </span>
              <span
                className={cn(
                  'min-w-0 break-words',
                  item.status === 'done' && 'text-muted line-through decoration-stroke-strong',
                  item.status === 'in_progress' && 'font-medium text-text',
                  item.status === 'pending' && 'text-text',
                )}
              >
                {item.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
