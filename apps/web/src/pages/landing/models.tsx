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
const TIER_ORDER: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };
const TIER_LABEL: Record<Tier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
const TIER_TONE: Record<Tier, BadgeTone> = { free: 'neutral', plus: 'plus', pro: 'pro' };

function tierOf(requiredPlan: string | undefined): Tier {
  if (requiredPlan === 'plus') return 'plus';
  if (requiredPlan === 'pro' || requiredPlan === 'ultra') return 'pro';
  return 'free';
}

/** Каталог берётся из того же зеркала, что и выбор модели в чате, — цифры не расходятся. */
const ROWS = DEFAULT_MODELS.filter((model) => GOOD_FOR[model.id]).map((model) => ({
  id: model.id,
  name: model.name,
  tier: tierOf(model.requiredPlan),
  limits: model.dailyLimits,
}));

export function LandingModels() {
  const { t } = useTranslation();

  const limitCell = (tier: Tier, plan: 'plus' | 'pro' | 'ultra', limits: (typeof ROWS)[number]['limits']) => {
    if (TIER_ORDER[tier] > TIER_ORDER[plan === 'ultra' ? 'pro' : plan]) {
      return <span className="text-subtle">{t('home.modelsNotIncluded')}</span>;
    }
    const value = limits?.[plan];
    if (value === undefined) {
      return <span className="text-muted">{t('home.modelsNoLimit')}</span>;
    }
    return <span className="text-text">{value}</span>;
  };

  return (
    <section aria-labelledby="models-title" id="models" className="w-full scroll-mt-20 pt-28 md:pt-36">
      <SectionHead id="models-title" title={t('home.modelsTitle')} lead={t('home.modelsLead')} />

      <p className="mt-10 text-[13px] text-subtle md:hidden">{t('home.modelsColLimits')}</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-stroke bg-surface md:mt-12">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t('home.modelsTitle')}</caption>
          <thead className="max-md:hidden">
            <tr className="border-b border-stroke text-[13px] text-subtle">
              <th scope="col" className="px-6 py-4 font-normal">{t('home.modelsColModel')}</th>
              <th scope="col" className="px-4 py-4 font-normal">{t('home.modelsColGood')}</th>
              <th scope="col" className="px-4 py-4 font-normal">{t('home.modelsColFrom')}</th>
              <th scope="col" colSpan={3} className="px-6 py-4 text-right font-normal">
                {t('home.modelsColLimits')}
              </th>
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
                <td className="px-4 py-3.5 text-[14px] text-muted max-md:col-start-1 max-md:row-start-2 max-md:p-0 max-md:pl-9">
                  {t(GOOD_FOR[row.id])}
                </td>
                <td className="px-4 py-3.5 max-md:col-start-2 max-md:row-start-1 max-md:p-0 max-md:text-right">
                  <Badge tone={TIER_TONE[row.tier]}>{TIER_LABEL[row.tier]}</Badge>
                </td>
                {(['plus', 'pro', 'ultra'] as const).map((plan) => (
                  <td
                    key={plan}
                    className="tabular w-[7.5rem] px-2 py-3.5 text-right text-[14px] last:pr-6 max-md:hidden"
                  >
                    {limitCell(row.tier, plan, row.limits)}
                  </td>
                ))}
                <td className="tabular hidden text-right text-[13px] text-muted max-md:col-start-2 max-md:row-start-2 max-md:block">
                  {row.limits
                    ? [row.limits.plus, row.limits.pro, row.limits.ultra].map((v) => v ?? '—').join(' / ')
                    : t('home.modelsNoLimit')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-[70ch] text-[13px] text-subtle">{t('home.modelsFootnote')}</p>
    </section>
  );
}
