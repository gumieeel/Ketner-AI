import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@/components/icons';
import { ModelHub } from '@/components/marketing/model-hub';
import { CornerMark } from '@/components/ui/corner-mark';
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
 * На десктопе (lg+): слева форма, справа фирменная декоративная панель с ModelHub.
 * На мобильных ( <lg ): только чистая форма с Brand в шапке.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  aside,
}: AuthShellProps) {
  const { t, language } = useTranslation();

  return (
    <div className="min-h-full grid grid-cols-1 lg:grid-cols-2 bg-canvas">
      {/* Левая колонка — форма */}
      <div className="flex flex-col justify-between min-h-screen lg:min-h-full px-6 py-8 sm:px-10">
        {/* Верхняя полоса формы */}
        <div className="flex items-center justify-between w-full">
          <Brand />
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>

        {/* Центрированный блок формы */}
        <div className="mx-auto w-full max-w-[380px] my-auto py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted mt-1.5">{subtitle}</p>
          )}
          <div className="mt-8">{children}</div>
        </div>

        {/* Подвал формы */}
        <div className="flex flex-col items-center gap-3 text-sm mt-8 pb-4">
          {footer}
          <Link
            to="/chat"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted hover:text-text transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            <span>{t('auth.backToChat')}</span>
          </Link>
        </div>
      </div>

      {/* Правая колонка — декор (только lg+) */}
      <div
        aria-hidden="true"
        className="hidden lg:flex relative overflow-hidden border-l border-stroke bg-surface flex-col items-center justify-center p-12 bg-grid hero-glow select-none"
      >
        <CornerMark size={14} className="absolute top-3 left-3 text-stroke-strong" />
        <CornerMark size={14} className="absolute top-3 right-3 text-stroke-strong rotate-90" />
        <CornerMark size={14} className="absolute bottom-3 right-3 text-stroke-strong rotate-180" />
        <CornerMark size={14} className="absolute bottom-3 left-3 text-stroke-strong -rotate-90" />

        {aside ?? (
          <div className="relative z-10 flex flex-col items-center text-center max-w-[420px] gap-8">
            <div className="scale-85 origin-center">
              <ModelHub />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-base font-semibold tracking-tight text-text">
                {language === 'ru'
                  ? 'Все AI-модели. Один интерфейс.'
                  : 'All AI Models. One Interface.'}
              </span>
              <span className="font-mono text-xs text-muted tracking-wider uppercase">
                GPT · Claude · Gemini · Grok · Qwen · DeepSeek
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
