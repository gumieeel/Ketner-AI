import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoutIcon, SparkleIcon } from '@/components/icons';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-store';
import { useBilling } from '@/features/billing/billing-store';
import { useTranslation } from '@/i18n';
import { formatShortDate } from '@/lib/format-date';

export function SettingsPage() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const subscription = useBilling((state) => state.subscription);
  const loadSubscription = useBilling((state) => state.loadSubscription);
  const cancel = useBilling((state) => state.cancel);

  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription, user]);

  const isPaid = user?.plan && user.plan !== 'free';
  const isCanceled = subscription?.status === 'canceled';

  const handleCancel = async () => {
    setCanceling(true);
    try {
      await cancel();
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <CardTitle>{user.name}</CardTitle>
              <CardText className="mt-0.5">
                {user.email} · {t('settings.registeredOn')}:{' '}
                {formatShortDate(user.createdAt, language)}
              </CardText>
            </div>
          </div>
        ) : (
          <div>
            <CardTitle>{t('settings.account')}</CardTitle>
            <CardText className="mt-1">
              {t('settings.guestTitle')}. {t('settings.guestText')}
            </CardText>
          </div>
        )}

        {!user ? (
          <Link to="/login">
            <Button variant="outline">{t('nav.login')}</Button>
          </Link>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <CardTitle>{t('settings.appearance')}</CardTitle>
          <CardText className="mt-1">{t('settings.appearanceText')}</CardText>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{t('settings.theme')}</span>
          <ThemeToggle />
          <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-300">
            {t('settings.language')}
          </span>
          <LanguageToggle />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>{t('settings.subscription')}</CardTitle>
              <Badge tone="brand">
                {user?.plan === 'pro'
                  ? t('pricing.pro')
                  : user?.plan === 'plus'
                    ? t('pricing.plus')
                    : t('pricing.free')}
              </Badge>
              {isPaid && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  ({isCanceled ? t('settings.statusCanceled') : t('settings.statusActive')})
                </span>
              )}
            </div>
            <CardText className="mt-1">
              {isPaid
                ? isCanceled
                  ? t('settings.canceledNotice')
                  : `${t('settings.renewsAt')}: ${formatShortDate(
                      subscription?.renewsAt ?? new Date().toISOString(),
                      language,
                    )}`
                : t('settings.subscriptionText')}
            </CardText>
          </div>

          <div className="flex items-center gap-2">
            {isPaid && !isCanceled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={canceling}
                className="text-zinc-600 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
              >
                {canceling ? t('settings.canceling') : t('settings.cancelSubscription')}
              </Button>
            ) : (
              <Link to="/pricing">
                <Button variant="outline" size="sm">
                  <SparkleIcon className="text-base" />
                  {t('nav.upgrade')}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Card>

      {user ? (
        <Card className="flex items-center justify-between">
          <div>
            <CardTitle>{t('settings.logout')}</CardTitle>
            <CardText className="mt-1">
              {t('settings.loggedInAs')} {user.email}
            </CardText>
          </div>
          <Button
            variant="outline"
            onClick={() => void logout()}
            className="text-red-600 hover:border-red-300 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <LogoutIcon className="text-lg" />
            {t('settings.logout')}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
