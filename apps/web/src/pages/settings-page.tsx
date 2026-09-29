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
  const [adminKey, setAdminKey] = useState<string>(
    () => (typeof window !== 'undefined' ? localStorage.getItem('ketner_admin_key') || '' : ''),
  );
  const [adminKeySaved, setAdminKeySaved] = useState(false);

  const handleSaveAdminKey = (keyToSave: string) => {
    localStorage.setItem('ketner_admin_key', keyToSave.trim());
    setAdminKey(keyToSave.trim());
    setAdminKeySaved(true);
    window.dispatchEvent(new Event('storage'));
    setTimeout(() => setAdminKeySaved(false), 3000);
  };

  const hasAdminAccess = Boolean(
    user && (
      user.isAdmin ||
      user.email?.toLowerCase() === 'artemsinyakov09@gmail.com' ||
      user.email?.toLowerCase().startsWith('admin@') ||
      user.email?.toLowerCase().startsWith('admin.')
    )
  );

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
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
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
          <span className="text-sm text-text">{t('settings.theme')}</span>
          <ThemeToggle />
          <span className="ml-2 text-sm text-text">{t('settings.language')}</span>
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

      {/* Секция администрирования — видна только администраторам */}
      {hasAdminAccess ? (
        <Card className="flex flex-col gap-4 border-accent/30 bg-accent/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Панель администратора (Admin Control)</CardTitle>
                <Badge tone="brand">ADMIN</Badge>
              </div>
              <CardText className="mt-1">
                Управление аккаунтами пользователей, изменение тарифов, лимиты расхода и маржинальность.
              </CardText>
            </div>
            <Link to="/admin">
              <Button variant="primary" size="sm">
                Открыть панель →
              </Button>
            </Link>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-stroke bg-canvas/60 p-3">
            <label htmlFor="admin-key-input" className="text-xs font-medium text-text">
              Ключ доступа к Admin API (x-admin-key):
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="admin-key-input"
                type="password"
                placeholder="ketner-ai-admin-key-dev"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="h-9 min-w-[220px] flex-1 rounded-md border border-stroke-strong bg-surface px-3 text-xs text-text outline-none focus:border-accent font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSaveAdminKey(adminKey)}
              >
                {adminKeySaved ? 'Сохранено ✓' : 'Сохранить ключ'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

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
