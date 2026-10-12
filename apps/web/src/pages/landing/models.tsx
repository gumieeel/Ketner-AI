import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ModelMark } from '@/components/ui/model-mark';
import { DEFAULT_MODELS } from '@/features/chat/can-access-model';
import { useTranslation, type TranslationKey } from '@/i18n';
import { SectionHead } from './section-head';

/** Короткое «для чего» по id модели. Модели без записи в таблицу не попадают. */
const GOOD_FOR: Record<string, TranslationKey> = {
  'ketner-mini': 'home.good.ketnerMini',
  'ketner-pro': 'home.good.ketnerPro',
  'claude-haiku-5.5': 'home.good.haiku',
  'deepseek-v4.1-flash': 'home.good.deepseek',
  'gpt-5.6-luna-pro': 'home.good.luna',
  'qwen3.8-27b': 'home.good.qwen',
  'gemini-3.7-flash': 'home.good.gemini',
  'gpt-6.1-sol': 'home.good.sol61',
  'claude-opus-5.5': 'home.good.opus',
  'claude-sonnet-5.5': 'home.good.sonnet',
  'gpt-6-astra': 'home.good.astra',
  'grok-4.7': 'home.good.grok',
  'gpt-5.6-sol': 'home.good.sol56',
  'gpt-5.6-terra': 'home.good.terra',
};

type Tier = 'free' | 'plus' | 'pro';
const TIER_LABEL: Record<Tier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
const TIER_TONE: Record<Tier, BadgeTone> = { free: 'neutral', plus: 'plus', pro: 'pro' };

function tierOf(requiredPlan: string | undefined): Tier {
  if (requiredPlan === 'plus') return 'plus';
  if (requiredPlan === 'pro' || requiredPlan === 'ultra') return 'pro';
  return 'free';
}

/** Каталог берётся из того же зеркала, что и выбор модели в чате. */
const ROWS = DEFAULT_MODELS.filter((model) => GOOD_FOR[model.id]).map((model) => ({
  id: model.id,
  name: model.name,
  tier: tierOf(model.requiredPlan),
}));

export function LandingModels() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="models-title" id="models" className="w-full scroll-mt-20 pt-28 md:pt-36">
      <SectionHead id="models-title" title={t('home.modelsTitle')} lead={t('home.modelsLead')} />

      <div className="mt-12 overflow-hidden rounded-xl border border-stroke bg-surface">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t('home.modelsTitle')}</caption>
          <thead className="max-md:hidden">
            <tr className="border-b border-stroke text-[13px] text-subtle">
              <th scope="col" className="px-6 py-4 font-normal">{t('home.modelsColModel')}</th>
              <th scope="col" className="px-4 py-4 font-normal">{t('home.modelsColGood')}</th>
              <th scope="col" className="px-6 py-4 text-right font-normal">{t('home.modelsColFrom')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.id}
                className="border-b border-stroke last:border-b-0 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:px-5 max-md:py-4"
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
                  <Badge tone={TIER_TONE[row.tier]}>{TIER_LABEL[row.tier]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
