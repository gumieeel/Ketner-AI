import { Link } from 'react-router-dom';
import { CreditsIcon, CryptoIcon, StarIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { PACKS, type PackFacts } from '@/features/billing/plans';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatCredits, pluralForm } from '@/lib/format-date';

export interface PackCardsProps {
  /** `full` — страница «Кредиты» с примерами и способами оплаты; `compact` — на главной. */
  variant?: 'compact' | 'full';
  className?: string;
}

/** Пакет, который выделяем как удобный по умолчанию. */
const POPULAR_PACK_ID = 'credits-10';

/** Примеры «на сколько запросов хватит» показываем на трёх моделях разного класса. */
const EXAMPLE_MODELS = ['ketner-pro', 'gpt-6.1-sol', 'claude-opus-5.5'] as const;

/**
 * Пакеты кредитов лесенкой: чем больше пакет, тем дешевле кредит. В строке — цена, кредиты,
 * цена за 1 000, на сколько запросов хватит, цена в звёздах и бонус за криптовалюту. Все числа — из
 * plan-facts.json, который тест сверяет с сервером.
 */
export function PackCards({ variant = 'compact', className }: PackCardsProps) {
  const { t, language } = useTranslation();
  const full = variant === 'full';
  const bestDiscount = Math.max(...PACKS.map((pack) => pack.discountPct));

  const plural = (base: 'pricing.credits' | 'pricing.requests', count: number): string =>
    t(`${base}.${pluralForm(count, language)}` as TranslationKey, {
      count: formatCredits(count, language),
    });

  // На главной пакеты вложены в секцию с h2, на странице «Кредиты» — сразу под h1.
  const Heading = full ? 'h2' : 'h3';

  return (
    <ul
      data-testid="pack-list"
      className={cn('flex w-full flex-col gap-3 text-left', className)}
      aria-label={t('pricing.packsLabel')}
    >
      {PACKS.map((pack: PackFacts) => {
        const popular = pack.id === POPULAR_PACK_ID;
        const best = pack.discountPct > 0 && pack.discountPct === bestDiscount;
        const tabLabel = popular ? t('pricing.popular') : best ? t('pricing.bestValue') : null;
        const examples = EXAMPLE_MODELS.map((model) =>
          pack.examples.find((item) => item.model === model),
        ).filter((item) => item !== undefined);
        const middle = examples[1] ?? examples[0];

        return (
          <li
            key={pack.id}
            data-testid={`pack-${pack.id}`}
            className={cn(
              'relative grid grid-cols-1 gap-x-8 gap-y-4 rounded-xl px-5 py-5 md:px-7',
              full
                ? 'md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)_auto] md:items-center'
                : 'md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] md:items-center',
              popular ? 'bg-surface-2' : 'bg-surface',
            )}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Heading className="sharp tabular text-[36px] leading-none font-medium tracking-[-0.03em] text-text">
                  ${pack.priceUsd}
                </Heading>
                {tabLabel ? (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[12px] font-medium',
                      popular ? 'bg-brand-gradient text-accent-text' : 'bg-surface-3 text-text',
                    )}
                  >
                    {tabLabel}
                  </span>
                ) : null}
              </div>
              <p className="tabular text-[13px] text-muted">
                {t('pricing.perThousand', { price: `$${pack.pricePerThousandUsd.toFixed(2)}` })}
                {pack.discountPct > 0 ? (
                  <Badge tone="success" className="ml-2 align-middle">
                    −{pack.discountPct}%
                  </Badge>
                ) : null}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2.5">
                <CreditsIcon className="size-5 shrink-0 text-accent" aria-hidden="true" />
                <span className="sharp tabular text-[20px] leading-tight font-medium text-text">
                  {plural('pricing.credits', pack.credits)}
                </span>
              </p>
              {full ? (
                <ul className="flex flex-col gap-0.5 text-[13px] leading-snug text-muted">
                  {examples.map((item) => (
                    <li key={item.model}>
                      {t('pricing.creditsExample', {
                        requests: plural('pricing.requests', item.requests),
                        model: item.name,
                      })}
                    </li>
                  ))}
                </ul>
              ) : middle ? (
                <p className="text-[13px] leading-snug text-muted">
                  {t('pricing.creditsExample', {
                    requests: plural('pricing.requests', middle.requests),
                    model: middle.name,
                  })}
                </p>
              ) : null}
            </div>

            {full ? (
              <ul className="flex flex-col gap-1.5 text-[13px] leading-snug text-muted">
                <li className="flex items-center gap-2">
                  <StarIcon
                    className="size-4 shrink-0 fill-warning text-warning"
                    aria-hidden="true"
                  />
                  <span className="tabular">
                    {t('pricing.starsPrice', { stars: formatCredits(pack.stars, language) })}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <CryptoIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span className="tabular">
                    {t('pricing.cryptoBonus', {
                      bonus: formatCredits(pack.cryptoBonusCredits, language),
                    })}
                  </span>
                </li>
              </ul>
            ) : null}

            <Link
              to={`/checkout/${pack.id}`}
              className={buttonClasses({
                variant: popular ? 'primary' : 'outline',
                className: 'w-full md:w-auto md:min-w-32',
              })}
            >
              {t('pricing.buyPack')}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
