import { Section } from '@/components/marketing/section';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/i18n';

export function LandingHowItWorks() {
  const { t, language } = useTranslation();

  const steps = [
    {
      num: '01',
      title: t('landing.step1Title'),
      desc: t('landing.step1Desc'),
    },
    {
      num: '02',
      title: t('landing.step2Title'),
      desc: t('landing.step2Desc'),
    },
    {
      num: '03',
      title: t('landing.step3Title'),
      desc: t('landing.step3Desc'),
    },
  ];

  return (
    <Section
      id="how-it-works"
      index="03"
      label={language === 'ru' ? 'Как это работает' : 'How it works'}
      title={t('landing.howTitle')}
      description={t('landing.howSubtitle')}
    >
      <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((step, idx) => (
          <div key={step.num} className="relative flex flex-col">
            {/* Вертикальный соединитель между шагами на mobile */}
            {idx < steps.length - 1 && (
              <div
                aria-hidden="true"
                className="absolute left-[32px] top-full h-6 w-px bg-stroke z-10 md:hidden"
              />
            )}
            <Card
              corners
              className="relative flex flex-row md:flex-col gap-4 p-4 md:p-6 h-full bg-surface border border-stroke items-start text-left"
            >
              <div className="flex md:items-center justify-between shrink-0 flex-col md:flex-row gap-2">
                <span className="font-mono text-3xl md:text-2xl font-semibold text-accent tracking-tight">
                  {step.num}
                </span>
                <span className="font-mono text-[10px] md:text-xs text-muted uppercase tracking-wider hidden md:block">
                  {language === 'ru' ? `Шаг ${idx + 1}` : `Step ${idx + 1}`}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-text tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  {step.desc}
                </p>
              </div>
            </Card>
          </div>
        ))}
      </div>
    </Section>
  );
}
