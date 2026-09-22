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
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/60">
        <h1 className="text-center text-xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
      <div className="flex flex-col items-center gap-2 text-sm">
        {footer}
        <Link to="/chat" className="text-zinc-500 hover:underline dark:text-zinc-400">
          {t('auth.backToChat')}
        </Link>
      </div>
    </div>
  );
}
