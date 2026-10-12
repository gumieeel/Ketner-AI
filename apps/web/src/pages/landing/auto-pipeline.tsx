import { SparkleIcon } from '@/components/icons';
import { ModelMark } from '@/components/ui/model-mark';
import { useTranslation, type TranslationKey } from '@/i18n';
import { SectionHead } from './section-head';

const STEPS: readonly { titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { titleKey: 'home.autoStep1Title', descKey: 'home.autoStep1Desc' },
  { titleKey: 'home.autoStep2Title', descKey: 'home.autoStep2Desc' },
  { titleKey: 'home.autoStep3Title', descKey: 'home.autoStep3Desc' },
  { titleKey: 'home.autoStep4Title', descKey: 'home.autoStep4Desc' },
];

const LANES: readonly { labelKey: TranslationKey; modelId: string; name?: string; nameKey?: TranslationKey }[] = [
  { labelKey: 'home.autoLaneSimple', modelId: 'ketner-mini', name: 'Ketner Mini' },
  { labelKey: 'home.autoLaneEveryday', modelId: 'ketner-pro', name: 'Ketner Pro' },
  { labelKey: 'home.autoLaneHard', modelId: 'claude-opus-5.5', nameKey: 'home.autoFlagship' },
];

/** Схема маршрута: запрос → Auto → три полосы моделей. Декоративная, смысл — в шагах справа. */
function RouteDiagram() {
  const { t } = useTranslation();

  return (
    <div
      aria-hidden="true"
      className="bg-dots flex h-full flex-col items-center justify-center rounded-2xl border border-stroke bg-surface px-4 py-10 sm:px-8"
    >
      <div className="w-full max-w-[360px] rounded-md border border-stroke-strong bg-surface-2 px-4 py-3">
        <span className="block text-[12px] text-subtle">{t('home.routerRequest')}</span>
        <span className="mt-1 block text-[14px] leading-snug text-text">{t('home.routerQ3')}</span>
      </div>
      <span className="h-10 w-px bg-stroke-strong" />
      <div className="flex items-center gap-2.5 rounded-md bg-brand-gradient px-5 py-3 text-accent-text">
        <SparkleIcon className="size-4" />
        <span className="sharp text-[17px] font-medium">Auto</span>
      </div>
      <span className="h-8 w-px bg-stroke-strong" />
      <div className="relative grid w-full max-w-[520px] grid-cols-3 gap-2 sm:gap-3">
        <span className="absolute top-0 right-[16.66%] left-[16.66%] h-px bg-stroke-strong" />
        {LANES.map((lane) => (
          <div key={lane.labelKey} className="flex flex-col items-center">
            <span className="h-8 w-px bg-stroke-strong" />
            <div className="flex w-full flex-col items-center gap-2 rounded-md border border-stroke bg-surface-2 px-2 py-4 text-center">
              <ModelMark modelId={lane.modelId} size="md" />
              <span className="text-[13px] font-medium leading-tight text-text">
                {lane.name ?? (lane.nameKey ? t(lane.nameKey) : '')}
              </span>
              <span className="text-[12px] text-subtle">{t(lane.labelKey)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingAutoPipeline() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="auto-title" id="auto" className="w-full scroll-mt-20 pt-28 md:pt-36">
      <SectionHead id="auto-title" title={t('home.autoTitle')} lead={t('home.autoLead')} />

      <div className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <RouteDiagram />
        </div>
        <ol className="flex flex-col gap-3 lg:col-span-5">
          {STEPS.map((step, index) => (
            <li
              key={step.titleKey}
              className="relative flex-1 rounded-lg border border-stroke bg-surface px-5 pt-5 pb-5 pr-14"
            >
              <span className="tab-label tabular absolute top-0 right-0 grid h-8 min-w-10 place-items-center border-b border-l border-stroke bg-surface-2 px-2 text-[13px] font-medium text-muted">
                {index + 1}
              </span>
              <h3 className="text-[17px] font-medium text-text">{t(step.titleKey)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t(step.descKey)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
