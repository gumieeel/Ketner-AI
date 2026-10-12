import { useId, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { SectionHead } from './section-head';

/** Отдельные подписки (цены с сайтов сервисов, август 2026). */
const SERVICES = [
  { id: 'chatgpt', name: 'ChatGPT Plus', price: 20 },
  { id: 'claude', name: 'Claude Pro', price: 20 },
  { id: 'gemini', name: 'Google AI Pro', price: 20 },
  { id: 'grok', name: 'SuperGrok', price: 30 },
] as const;

/** Ketner Pro: Claude Opus и Sonnet, GPT-6 Astra, Grok 4.7, Gemini 3.7 Flash в одной подписке. */
const KETNER_PRO = 25;

function money(value: number): string {
  return `$${value}`;
}

export function LandingSavings() {
  const { t } = useTranslation();
  const baseId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(SERVICES.map((service) => service.id)),
  );

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const separate = SERVICES.filter((service) => picked.has(service.id)).reduce(
    (sum, service) => sum + service.price,
    0,
  );
  const saved = separate - KETNER_PRO;
  const pct = separate > 0 ? Math.round((saved / separate) * 100) : 0;
  const max = Math.max(separate, KETNER_PRO, 1);

  return (
    <section aria-labelledby="save-title" id="savings" className="w-full scroll-mt-20 pt-28 md:pt-36">
      <SectionHead id="save-title" title={t('home.saveTitle')} lead={t('home.saveLead')} />

      <div className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Выбор подписок */}
        <fieldset className="m-0 flex flex-col gap-2 rounded-xl border border-stroke bg-surface p-3 lg:col-span-5">
          <legend className="sr-only">{t('home.saveLead')}</legend>
          {SERVICES.map((service) => {
            const checked = picked.has(service.id);
            const inputId = `${baseId}-${service.id}`;
            return (
              <label
                key={service.id}
                htmlFor={inputId}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-4 rounded-md px-4 transition-colors duration-150',
                  checked ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(service.id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-xs border transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    checked ? 'border-transparent bg-brand-gradient text-accent-text' : 'border-stroke-strong',
                  )}
                >
                  {checked ? <CheckIcon className="size-3.5" /> : null}
                </span>
                <span className="flex-1 text-[16px] text-text">{service.name}</span>
                <span className="tabular text-[15px] text-muted">
                  {money(service.price)}
                  {t('home.saveMonth')}
                </span>
              </label>
            );
          })}
          <p className="mt-auto px-4 pt-6 pb-2 text-[13px] leading-relaxed text-subtle">{t('home.saveFine')}</p>
        </fieldset>

        {/* Сравнение */}
        <div className="flex flex-col gap-3 lg:col-span-7">
          <div className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-6 sm:p-8">
            {[
              { label: t('home.saveSeparately'), value: separate, strong: false },
              { label: t('home.saveKetner'), value: KETNER_PRO, strong: true },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[15px] text-muted">{row.label}</span>
                  <span
                    className={cn(
                      'sharp tabular text-[40px] leading-none font-medium tracking-[-0.03em] sm:text-[48px]',
                      row.strong ? 'text-text' : 'text-muted',
                    )}
                  >
                    {money(row.value)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-xs bg-surface-3">
                  <div
                    className={cn('h-full transition-[width] duration-300', row.strong ? 'bg-accent' : 'bg-muted/60')}
                    style={{ width: `${(row.value / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div
            aria-live="polite"
            className="relative flex min-h-[148px] flex-col justify-end rounded-xl bg-brand-gradient p-6 text-accent-text sm:p-8"
          >
            <span className="tab-label absolute top-0 left-0 bg-canvas px-4 py-1.5 text-[13px] text-muted [border-radius:0_0_10px_0] [corner-shape:round_round_bevel_round]">
              {t('home.saveYouSave')}
            </span>
            {separate === 0 ? (
              <p className="text-[18px] font-medium">{t('home.saveNone')}</p>
            ) : saved <= 0 ? (
              <p className="max-w-[40ch] text-[18px] font-medium">{t('home.saveNoGain')}</p>
            ) : (
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
                <span className="sharp tabular text-[64px] leading-[0.95] font-medium tracking-[-0.04em] sm:text-[88px]">
                  {money(saved)}
                </span>
                <span className="pb-2 text-[15px]">
                  {t('home.saveLess', { pct })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
