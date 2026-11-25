import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WIZARD_STEPS, type WizardStep } from '@/features/builder/wizard';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Рамка мастера (docs/BUILDER_V1.md, раздел 3; подписи шагов — раздел 12, п. 1): заголовок по
 * типу решения и четыре шага. Пройденный шаг — ссылка, если для него есть адрес; будущие — текстом.
 */
export function WizardFrame({
  title,
  subtitle,
  current,
  hrefs = {},
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  current: WizardStep;
  /** Адреса шагов, на которые можно вернуться. */
  hrefs?: Partial<Record<WizardStep, string>>;
  back?: { to: string; label: string };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const currentIndex = WIZARD_STEPS.indexOf(current);
  return (
    <section
      aria-labelledby="page-title"
      className="mx-auto flex w-full max-w-[76rem] flex-col px-4 pt-[clamp(2rem,6vh,4rem)] pb-20 sm:px-6"
    >
      {back ? (
        <Link
          to={back.to}
          className="mb-3 self-start text-[14px] text-muted underline underline-offset-4 hover:text-text"
        >
          {back.label}
        </Link>
      ) : null}
      <h1
        id="page-title"
        className="text-[clamp(1.5rem,1.2vw+1.15rem,2rem)] leading-tight font-[480] tracking-[-0.03em] text-balance text-text"
      >
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-[14px] leading-6 text-muted">{subtitle}</p> : null}

      <nav aria-label={t('wizard.steps.label')} className="mt-6">
        <ol className="grid grid-cols-2 gap-2 rounded-2xl border border-stroke bg-surface p-3 sm:grid-cols-4">
          {WIZARD_STEPS.map((step, index) => {
            const done = index < currentIndex;
            const active = index === currentIndex;
            const href = hrefs[step];
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium',
                    done || active
                      ? 'bg-brand-gradient text-accent-text'
                      : 'bg-surface-2 text-muted',
                  )}
                >
                  {done ? '✓' : index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'text-[14px] font-medium',
                      active || done ? 'text-text' : 'text-muted',
                    )}
                  >
                    {t(`wizard.step.${step}` as TranslationKey)}
                    {done ? <span className="sr-only"> — {t('wizard.step.done')}</span> : null}
                  </span>
                  <span className="text-[12px] leading-4 text-subtle">
                    {t(`wizard.step.${step}.sub` as TranslationKey)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={step} aria-current={active ? 'step' : undefined} data-step={step}>
                {href && !active ? (
                  <Link
                    to={href}
                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-2 py-1.5">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
    </section>
  );
}
