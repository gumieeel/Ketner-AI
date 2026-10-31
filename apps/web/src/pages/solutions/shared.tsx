import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/features/auth/auth-store';
import type { SolutionStatus } from '@/features/builder/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { siteFeatures } from '@/lib/features';
import { NotFoundPage } from '@/pages/not-found-page';

/** Builder — только после входа (решение владельца) и при включённой платформе решений. */
export function BuilderGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const location = useLocation();
  if (!siteFeatures().discovery) return <NotFoundPage />;
  if (status === 'loading') {
    return (
      <Page title={t('builder.title')}>
        <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.page.loading')}
        </p>
      </Page>
    );
  }
  if (status !== 'authenticated') {
    return (
      <Page title={t('builder.title')}>
        <p className="t-lead mt-4">{t('builder.loginLead')}</p>
        <div className="mt-8">
          <Link
            to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
          >
            {t('analysis.error.login')}
          </Link>
        </div>
      </Page>
    );
  }
  return <>{children}</>;
}

export function Page({
  title,
  back,
  actions,
  children,
  wide = false,
}: {
  title: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      aria-labelledby="page-title"
      className={`mx-auto flex w-full ${wide ? 'max-w-[60rem]' : 'max-w-[44rem]'} flex-col px-4 pt-[clamp(2.5rem,8vh,5rem)] pb-20 sm:px-6`}
    >
      {back ? (
        <Link
          to={back.to}
          className="mb-3 self-start text-[14px] text-muted underline underline-offset-4 hover:text-text"
        >
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1
          id="page-title"
          className="min-w-0 text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-balance break-words text-text"
        >
          {title}
        </h1>
        {actions}
      </div>
      {children}
    </section>
  );
}

const STATUS_TONE: Record<SolutionStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
};

export function StatusBadge({ status }: { status: SolutionStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={STATUS_TONE[status]}>{t(`builder.status.${status}` as TranslationKey)}</Badge>
  );
}
