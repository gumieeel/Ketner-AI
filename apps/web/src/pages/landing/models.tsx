import { Badge } from '@/components/ui/badge';
import { ModelMark } from '@/components/ui/model-mark';
import { DEFAULT_MODELS } from '@/features/chat/model-catalog';
import planFacts from '@/features/billing/plan-facts.json';
import { useTranslation } from '@/i18n';
import { formatCredits } from '@/lib/format-date';
import { GOOD_FOR } from './model-facts';
import { SectionHead } from './section-head';

/** Каталог берётся из того же зеркала, что и выбор модели в чате. */
const ROWS = DEFAULT_MODELS.filter((model) => GOOD_FOR[model.id]).map((model) => ({
  id: model.id,
  name: model.name,
  /** Цена обычного запроса, кредиты: из plan-facts.json, который сервер сверяет с реальными ценами. */
  price: (planFacts.modelPrices as Record<string, number>)[model.id],
}));

export function LandingModels() {
  const { t, language } = useTranslation();

  return (
    <section
      aria-labelledby="models-title"
      id="models"
      className="w-full scroll-mt-20 pt-28 md:pt-36"
    >
      <SectionHead id="models-title" title={t('home.modelsTitle')} lead={t('home.modelsLead')} />

      <div className="mt-12 overflow-hidden rounded-xl border border-stroke bg-surface">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t('home.modelsTitle')}</caption>
          <thead className="max-md:hidden">
            <tr
              className="border-b border-stroke text-[13px] text-subtle" // taste-skill-ignore: real table
            >
              <th scope="col" className="px-6 py-4 font-normal">
                {t('home.modelsColModel')}
              </th>
              <th scope="col" className="px-4 py-4 font-normal">
                {t('home.modelsColGood')}
              </th>
              <th scope="col" className="px-6 py-4 text-right font-normal">
                {t('home.modelsColFrom')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.id}
                className="border-b border-stroke last:border-b-0 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:px-5 max-md:py-4" // taste-skill-ignore: real table
              >
                <th scope="row" className="px-6 py-3.5 font-normal max-md:p-0">
                  <span className="flex items-center gap-3">
                    <ModelMark modelId={row.id} size="sm" />
                    <span className="text-[15px] font-medium text-text">{row.name}</span>
                  </span>
                </th>
                <td className="px-4 py-3.5 text-[14px] text-muted max-md:col-span-2 max-md:row-start-2 max-md:p-0 max-md:pl-9">
                  {t(GOOD_FOR[row.id])}
                </td>
                <td className="px-6 py-3.5 text-right max-md:col-start-2 max-md:row-start-1 max-md:p-0">
                  {row.price !== undefined ? (
                    <Badge tone="neutral" className="tabular-nums">
                      {t('home.modelsPrice', { price: formatCredits(row.price, language, 1) })}
                    </Badge>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
