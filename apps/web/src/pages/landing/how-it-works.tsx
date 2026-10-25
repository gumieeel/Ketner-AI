import { Section } from '@/components/marketing/section';
import { Reveal } from '@/components/ui/reveal';
import { useTranslation, type TranslationKey } from '@/i18n';

const STEPS: readonly { num: string; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { num: '01', titleKey: 'landing.step1Title', descKey: 'landing.step1Desc' },
  { num: '02', titleKey: 'landing.step2Title', descKey: 'landing.step2Desc' },
  { num: '03', titleKey: 'landing.step3Title', descKey: 'landing.step3Desc' },
];

export function LandingHowItWorks() {
  const { t } = useTranslation();

  return (
    <Section
      id="how-it-works"
      label={t('landing.howLabel')}
      title={t('landing.howTitle')}
      description={t('landing.howSubtitle')}
    >
      <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {/* Соединительная линия между кругами шагов (desktop) */}
        <div
          aria-hidden="true"
          className="absolute top-[46px] right-[16.6%] left-[16.6%] hidden h-px bg-gradient-to-r from-accent/50 via-accent-2/50 to-accent-3/50 md:block"
        />
        {STEPS.map((step, index) => (
          <li key={step.num} className="list-none">
            <Reveal delayMs={index * 90} className="h-full">
              <div className="lift relative flex h-full flex-col gap-4 rounded-lg border border-stroke bg-surface p-6 text-left shadow-sm hover:border-stroke-strong hover:shadow-lg">
                <div className="flex items-center gap-3">
                  <span className="tabular relative z-10 grid size-11 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-accent-text shadow-glow">
                    {step.num}
                  </span>
                  <span className="text-[13px] font-medium text-subtle">
                    {t('landing.stepLabel', { n: index + 1 })}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-text">{t(step.titleKey)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{t(step.descKey)}</p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
