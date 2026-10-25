import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@/components/icons';
import { KnotRelief } from '@/components/marketing/knot-relief';
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

        <div className="mx-auto my-auto w-full max-w-[400px] py-8">
          <h1 className="t-title text-balance text-[28px] text-text sm:text-[34px]">{title}</h1>
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

      {/* Правая колонка — витрина (только lg+): панель с рельефом щита */}
      <div aria-hidden="true" className="hidden p-3 lg:block">
        <div className="notch-br relative isolate flex h-full flex-col justify-end overflow-hidden rounded-2xl bg-[var(--hero-panel)] p-12 [--notch:72px]">
          <KnotRelief className="absolute -top-[6%] -right-[22%] -z-10 w-[96%] max-w-none" />
          {aside ?? (
            <div className="flex max-w-[30ch] flex-col gap-3">
              <p className="t-title text-[30px] text-text">{t('auth.asideTitle')}</p>
              <p className="text-[15px] leading-relaxed text-muted">{t('auth.asideLead')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
