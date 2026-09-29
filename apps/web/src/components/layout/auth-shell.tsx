import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/i18n';

interface AuthShellProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Центрированный каркас для страниц входа и регистрации. */
export function AuthShell({ title, children, footer }: AuthShellProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-stroke bg-surface p-6">
        <h1 className="text-center text-xl font-semibold tracking-tight text-text">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
      <div className="flex flex-col items-center gap-2 text-sm">
        {footer}
        <Link to="/chat" className="text-muted hover:underline">
          {t('auth.backToChat')}
        </Link>
      </div>
    </div>
  );
}
