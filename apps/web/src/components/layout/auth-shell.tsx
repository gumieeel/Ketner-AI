import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@/components/icons';
import { ModelHub } from '@/components/marketing/model-hub';
import { useTranslation } from '@/i18n';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
}

/**
 * Сплит-каркас для страниц входа и регистрации.
 * На десктопе (lg+): слева форма, справа фирменная панель с «оркестром моделей».
 * На мобильных (<lg): только форма, бренд и переключатели в шапке.
 */
export function AuthShell({ title, subtitle, children, footer, aside }: AuthShellProps) {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas lg:grid-cols-2">
      {/* Левая колонка — форма */}
      <div className="flex min-h-dvh min-w-0 flex-col justify-between px-5 py-6 sm:px-10 sm:py-8">
        <div className="flex w-full items-center justify-between gap-3">
          <Brand />
          <div className="flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="mx-auto my-auto w-full max-w-[400px] animate-slide-up py-8">
          <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight text-text sm:text-[30px]">
            {title}
          </h1>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-1 text-sm">
          {footer ? <div className="flex min-h-11 items-center">{footer}</div> : null}
          <Link
            to="/chat"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted transition-colors hover:text-text"
          >
            <ArrowLeftIcon className="size-4" />
            <span>{t('auth.backToChat')}</span>
          </Link>
        </div>
      </div>

      {/* Правая колонка — витрина (только lg+) */}
      <div
        aria-hidden="true"
        className="relative hidden select-none flex-col items-center justify-center overflow-hidden border-l border-stroke bg-surface px-6 py-12 lg:flex xl:px-12"
      >
        <div className="bg-aurora pointer-events-none absolute inset-0 opacity-70" />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_45%,black,transparent)]" />

        {aside ?? (
          <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center gap-10 text-center">
            <ModelHub />
            <div className="flex max-w-[420px] flex-col gap-2">
              <p className="text-balance text-xl font-semibold tracking-tight text-text">
                {t('auth.asideTitle')}
              </p>
              <p className="text-balance text-sm leading-6 text-muted">{t('auth.asideLead')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
