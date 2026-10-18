import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';
import { formatReleaseDate } from '@/features/content/changelog';
import { INCIDENTS } from '@/features/content/incidents';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/cn';

type ComponentState = 'operational' | 'degraded' | 'outage' | 'unavailable';

interface StatusReport {
  state: Exclude<ComponentState, 'unavailable'>;
  checkedAt: string;
  components: { id: string; state: ComponentState; note?: string }[];
}

const COMPONENT_NAMES: Record<string, string> = {
  site: 'Сайт и API',
  database: 'Аккаунты, чаты и история',
  models: 'Модели: чат, Ketner Code, API',
  images: 'Генерация изображений',
  payments: 'Оплата',
  telegram: 'Telegram-бот и кабинет',
};

const STATE_LABEL: Record<ComponentState, string> = {
  operational: 'Работает',
  degraded: 'Частичные проблемы',
  outage: 'Не работает',
  unavailable: 'Отключено',
};

const STATE_TONE: Record<ComponentState, StatusDotTone> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
  unavailable: 'neutral',
};

const OVERALL_TEXT: Record<StatusReport['state'], string> = {
  operational: 'Все системы работают',
  degraded: 'Часть функций работает с перебоями',
  outage: 'Сбой: часть сервиса не работает',
};

async function loadStatus(): Promise<StatusReport> {
  const response = await fetch(`${API_BASE}/status`, { cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as StatusReport;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Статус сервиса: проверка компонентов при открытии, известные проблемы и история сбоев. */
export function StatusPage() {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    loadStatus()
      .then((data) => {
        setReport(data);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const overallTone: StatusDotTone = failed
    ? 'danger'
    : report
      ? STATE_TONE[report.state]
      : 'neutral';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Статус сервиса
        </h1>
        <p className="text-[15px] leading-7 text-muted">
          Страница проверяет основные части Ketner AI при каждом открытии. Внешнего мониторинга пока
          нет, поэтому историю сбоев ниже ведём вручную.
        </p>
      </header>

      <section
        aria-live="polite"
        aria-busy={loading}
        className={cn(
          'flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5',
          failed || report?.state === 'outage'
            ? 'border-danger/30 bg-danger-soft'
            : report?.state === 'degraded'
              ? 'border-warning/30 bg-warning-soft'
              : 'border-stroke bg-surface',
        )}
      >
        <div className="flex items-center gap-3">
          <StatusDot
            tone={overallTone}
            pulse={!failed && report?.state === 'operational'}
            className="size-3"
          />
          <div className="flex flex-col">
            <p className="text-[17px] font-semibold text-text">
              {failed ? 'Сервер не ответил' : report ? OVERALL_TEXT[report.state] : 'Проверяем…'}
            </p>
            <p className="text-[13px] text-muted">
              {failed
                ? 'Возможен сбой, или сервер просыпается после простоя — попробуйте через минуту.'
                : report
                  ? `Проверено ${formatTime(report.checkedAt)}`
                  : ' '}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} loading={loading}>
          Проверить снова
        </Button>
      </section>

      {report ? (
        <section aria-labelledby="components-title" className="flex flex-col gap-3">
          <h2 id="components-title" className="text-xl font-semibold tracking-tight">
            Компоненты
          </h2>
          <ul className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke bg-surface">
            {report.components.map((component) => (
              <li
                key={component.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-medium text-text">
                    {COMPONENT_NAMES[component.id] ?? component.id}
                  </span>
                  {component.note ? (
                    <span className="text-[13px] text-muted">{component.note}</span>
                  ) : null}
                </div>
                <span className="inline-flex items-center gap-2 text-[14px] text-muted">
                  <StatusDot tone={STATE_TONE[component.state]} />
                  {STATE_LABEL[component.state]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="known-title" className="flex flex-col gap-3">
        <h2 id="known-title" className="text-xl font-semibold tracking-tight">
          Известные проблемы
        </h2>
        <p className="text-[15px] leading-7 text-muted">
          Это мы уже знаем и не считаем сбоем — так сейчас устроен сервис.
        </p>
        <ul className="flex flex-col gap-3">
          {KNOWN_ISSUES.map((issue) => (
            <li key={issue.id} className="rounded-xl border border-stroke bg-surface p-4">
              <p className="text-[15px] font-medium text-text">{issue.title}</p>
              <p className="mt-1 text-[14px] leading-6 text-muted">{issue.details}</p>
              {issue.workaround ? (
                <p className="mt-1 text-[14px] leading-6 text-text">
                  Что делать: {issue.workaround}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="incidents-title" className="flex flex-col gap-3">
        <h2 id="incidents-title" className="text-xl font-semibold tracking-tight">
          История сбоев
        </h2>
        <ol className="flex flex-col gap-3">
          {INCIDENTS.map((incident) => (
            <li
              key={`${incident.date}-${incident.title}`}
              className="flex flex-col gap-1.5 rounded-xl border border-stroke bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-medium text-text">{incident.title}</p>
                <span
                  className={cn(
                    'inline-flex items-center gap-2 text-[13px]',
                    incident.resolved ? 'text-success' : 'text-warning',
                  )}
                >
                  <StatusDot tone={incident.resolved ? 'success' : 'warning'} />
                  {incident.resolved
                    ? `Исправлено ${formatReleaseDate(incident.resolved)}`
                    : 'Не решено'}
                </span>
              </div>
              <p className="text-[13px] text-subtle">{formatReleaseDate(incident.date)}</p>
              <p className="text-[14px] leading-6 text-muted">{incident.impact}</p>
              <p className="text-[14px] leading-6 text-muted">Причина: {incident.cause}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="border-t border-stroke pt-6 text-[15px] leading-7 text-muted">
        Что-то не работает, а здесь этого нет?{' '}
        <Link to="/contacts?topic=bug" className="text-text underline underline-offset-4">
          Сообщите об ошибке
        </Link>
        .
      </p>
    </div>
  );
}
