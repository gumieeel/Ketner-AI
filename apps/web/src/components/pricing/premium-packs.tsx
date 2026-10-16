import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import { fetchPacks } from '@/features/billing/api';
import type { PacksResponse } from '@/features/billing/types';
import { planRank } from '@/features/chat/can-access-model';
import { useQuota } from '@/features/usage/quota-store';
import { useTranslation } from '@/i18n';
import { formatShortDate } from '@/lib/format-date';

/** Модель, по которой показываем «≈ N запросов» в карточке пакета: самая желанная из доступных. */
const SHOWCASE_MODELS = ['claude-opus-5.5', 'gpt-6.1-sol'];

/**
 * Пакеты премиум-квоты поверх подписки (страница тарифов, якорь #premium-packs). Видны вошедшим
 * пользователям платных тарифов; цены и остаток кредитов приходят с сервера.
 */
export function PremiumPacks() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const quota = useQuota((state) => state.report);
  const [data, setData] = useState<PacksResponse | null>(null);
  const paid = Boolean(user && (user.isVip || planRank(user.plan) >= planRank('plus')));

  useEffect(() => {
    if (!paid) return;
    let stale = false;
    fetchPacks()
      .then((response) => !stale && setData(response))
      .catch(() => !stale && setData(null));
    return () => {
      stale = true;
    };
  }, [paid]);

  if (!paid || !data || data.packs.length === 0) return null;
  const showcase = SHOWCASE_MODELS.map((id) => quota?.models.find((m) => m.id === id)).find(
    Boolean,
  );

  return (
    <section id="premium-packs" className="flex w-full flex-col gap-5 text-left">
      <div className="flex flex-col gap-1.5">
        <h2 className="t-title text-text">{t('packs.title')}</h2>
        <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">{t('packs.lead')}</p>
        {data.credits.remainingUsd > 0 && data.credits.nextExpiresAt ? (
          <p className="text-sm font-medium text-accent">
            {t('packs.balance', {
              amount: data.credits.remainingUsd.toFixed(2),
              date: formatShortDate(data.credits.nextExpiresAt, language),
            })}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.packs.map((pack) => (
          <Card key={pack.id} className="flex flex-col gap-3 rounded-2xl p-5">
            <div>
              <p className="text-lg font-semibold text-text">
                {t('packs.name', { quota: pack.quotaUsd })}
              </p>
              <p className="text-xs text-muted">
                {t('packs.days', { days: pack.days })}
                {showcase && showcase.requestCostUsd > 0
                  ? ` · ${t('packs.approx', {
                      count: Math.floor(pack.quotaUsd / showcase.requestCostUsd),
                      model: showcase.name,
                    })}`
                  : ''}
              </p>
            </div>
            <Link
              to={`/checkout/pack/${pack.id}`}
              className={buttonClasses({ variant: 'outline', className: 'mt-auto' })}
            >
              {t('packs.buy', { price: pack.priceUsd })}
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}
