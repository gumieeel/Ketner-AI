import { useState } from 'react';
import { CreditsIcon, CryptoIcon, StarIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CRYPTO_BONUS_RATE, DEFAULT_PACK_ID, getPack } from '@/features/billing/plans';
import { ApiError, miniAppApi, type MiniAppPack } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { formatCredits } from '@/lib/format-date';
import { formatStars, Notice, SectionTitle, useMiniApp } from './shared';

/** Цена в звёздах округляется до 10 ⭐ (≈ $0.20): разница меньше этой — не «дороже». */
const STARS_ROUNDING_USD = 0.25;

/** Вкладка «Кредиты»: пакеты за звёзды Telegram (криптой — на сайте, с бонусом). */
export function PacksTab() {
  const { t, language } = useTranslation();
  const { app, token, state, refresh, notify, openSite } = useMiniApp();
  const { user, packs, rate, credits, refundPolicy } = state;
  const [paying, setPaying] = useState<string | null>(null);

  const waitForPayment = async (invoiceId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const { status } = await miniAppApi.invoiceStatus(token, invoiceId);
        if (status === 'paid') return true;
      } catch {
        // сеть мигнула — пробуем дальше
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  };

  const pay = async (pack: MiniAppPack) => {
    haptic.tap(app);
    setPaying(pack.id);
    try {
      const invoice = await miniAppApi.invoice(token, pack.id);
      app.openInvoice(invoice.link, (status) => {
        if (status === 'paid') {
          notify('info', t('tg.paymentProcessing'));
          void waitForPayment(invoice.invoiceId)
            .then(async (paid) => {
              await refresh();
              if (paid) haptic.success(app);
              notify(
                'success',
                paid
                  ? t('tg.paymentDone', { credits: formatCredits(pack.credits, language) })
                  : t('tg.paymentLate'),
              );
            })
            .finally(() => setPaying(null));
          return;
        }
        if (status === 'failed') {
          haptic.error(app);
          notify('danger', t('tg.paymentFailed'));
        }
        setPaying(null);
      });
    } catch (error) {
      haptic.error(app);
      notify('danger', error instanceof ApiError ? error.message : t('tg.errorGeneric'));
      setPaying(null);
    }
  };

  if (user.isVip) {
    return <Notice tone="info">{t('tg.vipPlans')}</Notice>;
  }

  const starsDearer = packs.some((pack) => pack.starsUsd - pack.priceUsd > STARS_ROUNDING_USD);

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-[13px] leading-5 text-muted">
        {t('tg.packsLead', { days: credits.validDays })}
      </p>

      <SectionTitle
        aside={t('tg.packsBalance', { count: formatCredits(credits.balance, language) })}
      >
        {t('tg.packsBuy')}
      </SectionTitle>

      {packs.map((pack) => {
        const facts = getPack(pack.id);
        const stars = formatStars(pack.stars, language);
        return (
          <article
            key={pack.id}
            aria-labelledby={`tg-pack-${pack.id}`}
            className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id={`tg-pack-${pack.id}`}
                  className="flex items-center gap-2 text-[17px] font-semibold"
                >
                  <CreditsIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  {t('tg.packCredits', { count: formatCredits(pack.credits, language) })}
                  {facts && facts.discountPct > 0 ? (
                    <Badge tone="success">−{facts.discountPct}%</Badge>
                  ) : null}
                </h3>
                <p className="mt-0.5 text-[13px] leading-5 text-muted">
                  {t('tg.packPerThousand', { price: `$${pack.pricePerThousandUsd.toFixed(2)}` })}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="flex items-center justify-end gap-1 text-[18px] font-semibold tabular-nums">
                  {stars}
                  <StarIcon className="size-4 fill-warning text-warning" />
                </p>
                <p className="text-[12px] text-subtle">≈ ${pack.starsUsd.toFixed(2)}</p>
              </div>
            </div>
            <Button
              className="w-full"
              loading={paying === pack.id}
              disabled={paying !== null}
              onClick={() => void pay(pack)}
            >
              {t('tg.buyPack', { stars })}
            </Button>
          </article>
        );
      })}

      <div className="flex flex-col gap-1.5 px-1 text-[12px] leading-5 text-subtle">
        <p>{t('tg.refundShort', { hours: refundPolicy.hours })}</p>
        <p>{t('tg.rate', { per1000: (rate.usdPerStar * 1000).toFixed(2) })}</p>
        {starsDearer ? (
          <p>
            {t('tg.starsDearer', {
              prices: packs.map((pack) => `$${pack.priceUsd}`).join(' / '),
            })}
          </p>
        ) : null}
        {rate.market ? (
          <p>{t('tg.rateMarket', { per1000: (rate.market.usdPerStar * 1000).toFixed(2) })}</p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        className="w-full gap-2"
        onClick={() => void openSite(`/checkout/${DEFAULT_PACK_ID}`)}
      >
        <CryptoIcon className="size-4" />
        {t('tg.payCrypto', { bonus: Math.round(CRYPTO_BONUS_RATE * 100) })}
      </Button>
    </div>
  );
}
