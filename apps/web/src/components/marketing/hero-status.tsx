import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';
import { useTranslation, type TranslationKey } from '@/i18n';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/cn';

type OverallState = 'operational' | 'degraded' | 'outage';

const COPY: Record<OverallState | 'unknown', { title: TranslationKey; sub: TranslationKey }> = {
  operational: { title: 'home.heroStatusOk', sub: 'home.heroStatusOkSub' },
  degraded: { title: 'home.heroStatusDegraded', sub: 'home.heroStatusDegradedSub' },
  outage: { title: 'home.heroStatusOutage', sub: 'home.heroStatusOutageSub' },
  unknown: { title: 'home.heroStatusUnknown', sub: 'home.heroStatusUnknownSub' },
};

const TONE: Record<OverallState | 'unknown', StatusDotTone> = {
  operational: 'brand',
  degraded: 'warning',
  outage: 'danger',
  unknown: 'neutral',
};

/**
 * Статус сервисов в левом нижнем углу первого экрана. Берётся из того же /api/status,
 * что и страница статуса; пока ответа нет (и в готовом HTML) показывается нейтральная строка
 * со ссылкой, а не заранее выбранное «всё работает».
 */
export function HeroStatus({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<OverallState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/status`, { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('status'))))
      .then((report: { state?: string }) => {
        if (
          report.state === 'operational' ||
          report.state === 'degraded' ||
          report.state === 'outage'
        ) {
          setState(report.state);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const key = state ?? 'unknown';
  const copy = COPY[key];

  return (
    <Link
      to="/status"
      className={cn(
        'group inline-flex items-start gap-3 rounded-md py-2 text-[13px] leading-tight text-subtle transition-colors duration-200 hover:text-muted',
        className,
      )}
    >
      <StatusDot tone={TONE[key]} pulse={state === 'operational'} className="mt-[3px]" />
      <span className="flex flex-col gap-1">
        <span className="text-muted group-hover:text-text">{t(copy.title)}</span>
        <span>{t(copy.sub)}</span>
      </span>
    </Link>
  );
}
