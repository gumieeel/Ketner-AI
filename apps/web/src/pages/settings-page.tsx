import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyIcon, LogoutIcon, SparkleIcon, TelegramIcon, UserIcon } from '@/components/icons';
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

  const planLabel =
    user?.plan === 'pro'
      ? t('pricing.pro')
      : user?.plan === 'plus'
        ? t('pricing.plus')
        : user?.plan === 'ultra'
          ? 'Ultra'
          : t('pricing.free');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 md:px-8 text-text">
      {/* Шапка настроек */}
      <div className="border-b border-stroke pb-5">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-text">
          {t('settings.title')}
        </h1>
        <p className="text-xs md:text-sm text-muted mt-1">
          Управление профилем, внешним видом и параметрами тарифного плана
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        {/* Боковая навигация по разделам */}
        <nav className="flex md:flex-col gap-1 overflow-x-auto text-xs font-mono text-muted">
          <a
            href="#account"
            className="rounded-md px-3 py-2 text-text font-medium bg-surface border border-stroke"
          >
            {t('settings.account')}
          </a>
          <a
            href="#appearance"
            className="rounded-md px-3 py-2 hover:text-text hover:bg-surface/50 transition-colors"
          >
            {t('settings.appearance')}
          </a>
          <a
            href="#subscription"
            className="rounded-md px-3 py-2 hover:text-text hover:bg-surface/50 transition-colors"
          >
            {t('settings.subscription')}
          </a>
          <a
            href="#support"
            className="rounded-md px-3 py-2 hover:text-text hover:bg-surface/50 transition-colors"
          >
            {t('settings.support')}
          </a>
          {hasAdminAccess ? (
            <a
              href="#admin"
              className="rounded-md px-3 py-2 hover:text-text hover:bg-surface/50 transition-colors"
            >
              Admin API
            </a>
          ) : null}
          {user ? (
            <a
              href="#danger"
              className="rounded-md px-3 py-2 text-danger hover:bg-danger/10 transition-colors"
            >
              {t('settings.logout')}
            </a>
          ) : null}
        </nav>

        {/* Основной стек настроек */}
        <div className="flex flex-col gap-6">
          {/* 1. Аккаунт */}
          <section id="account">
            <Card className="flex flex-col gap-4 p-5 md:p-6 border-stroke bg-surface">
              <div className="flex items-center justify-between border-b border-stroke pb-4">
                <div className="flex items-center gap-3">
                  {user ? (
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 border border-stroke text-sm font-mono font-semibold text-accent">
                      {user.name.slice(0, 2).toUpperCase()}
                    </span>
                  ) : (
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 border border-stroke text-muted">
                      <UserIcon className="text-xl" />
                    </div>
                  )}
                  <div>
                    <CardTitle className="text-base font-semibold text-text">
                      {user ? user.name : t('settings.account')}
                    </CardTitle>
                    <CardText className="text-xs text-muted mt-0.5">
                      {user
                        ? `${user.email} · ${t('settings.registeredOn')}: ${formatShortDate(user.createdAt, language)}`
                        : `${t('settings.guestTitle')}. ${t('settings.guestText')}`}
                    </CardText>
                  </div>
                </div>

                {!user ? (
                  <Link to="/login">
                    <Button variant="outline" size="sm">
                      {t('nav.login')}
                    </Button>
                  </Link>
                ) : null}
              </div>

              {user ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-canvas p-3 border border-stroke">
                    <span className="text-muted block text-[11px] font-mono">User ID</span>
                    <span className="font-mono text-text text-xs select-all mt-0.5 block truncate">
                      {user.id}
                    </span>
                  </div>
                  <div className="rounded-lg bg-canvas p-3 border border-stroke">
                    <span className="text-muted block text-[11px] font-mono">Email</span>
                    <span className="text-text text-xs mt-0.5 block truncate">{user.email}</span>
                  </div>
                </div>
              ) : null}
            </Card>
          </section>

          {/* 2. Внешний вид */}
          <section id="appearance">
            <Card className="flex flex-col gap-4 p-5 md:p-6 border-stroke bg-surface">
              <div className="border-b border-stroke pb-3">
                <CardTitle className="text-base font-semibold text-text">
                  {t('settings.appearance')}
                </CardTitle>
                <CardText className="text-xs text-muted mt-0.5">
                  {t('settings.appearanceText')}
                </CardText>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-text">{t('settings.theme')}</span>
                  <ThemeToggle />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-text">{t('settings.language')}</span>
                  <LanguageToggle />
                </div>
              </div>
            </Card>
          </section>

          {/* 3. Подписка */}
          <section id="subscription">
            <Card className="flex flex-col gap-4 p-5 md:p-6 border-stroke bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-4">
                <div className="flex items-center gap-2.5">
                  <CardTitle className="text-base font-semibold text-text">
                    {t('settings.subscription')}
                  </CardTitle>
                  <Badge tone="brand" className="font-mono text-xs">
                    {planLabel}
                  </Badge>
                  {isPaid && (
                    <span className="text-xs text-muted font-mono">
                      ({isCanceled ? t('settings.statusCanceled') : t('settings.statusActive')})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isPaid && !isCanceled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancel}
                      disabled={canceling}
                      className="text-xs text-danger hover:bg-danger/10 hover:border-danger/40"
                    >
                      {canceling ? t('settings.canceling') : t('settings.cancelSubscription')}
                    </Button>
                  ) : (
                    <Link to="/pricing">
                      <Button variant="primary" size="sm" className="gap-1.5 text-xs">
                        <SparkleIcon className="text-xs" />
                        {t('nav.upgrade')}
                      </Button>
                    </Link>
                  )}
                </div>
              </div>

              <CardText className="text-xs text-muted leading-relaxed">
                {isPaid
                  ? isCanceled
                    ? t('settings.canceledNotice')
                    : `${t('settings.renewsAt')}: ${formatShortDate(
                        subscription?.renewsAt ?? new Date().toISOString(),
                        language,
                      )}`
                  : t('settings.subscriptionText')}
              </CardText>
            </Card>
          </section>

          {/* 4. Служба поддержки и помощь */}
          <section id="support">
            <Card className="flex flex-col gap-4 p-5 md:p-6 border-stroke bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stroke pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#24A1DE]/15 text-[#24A1DE]">
                    <TelegramIcon className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold text-text">
                      {t('settings.support')}
                    </CardTitle>
                    <CardText className="text-xs text-muted mt-0.5">
                      {t('settings.supportDesc')}
                    </CardText>
                  </div>
                </div>

                <a
                  href="https://t.me/ketner_support_bot"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#24A1DE] hover:bg-[#1E96D1] px-4 py-2.5 text-xs font-semibold text-white transition-colors shadow-xs"
                >
                  <TelegramIcon className="size-4" />
                  <span>{t('settings.supportContactBtn')}</span>
                </a>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs bg-canvas p-3 rounded-lg border border-stroke">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-text">
                    Официальный бот поддержки: <a href="https://t.me/ketner_support_bot" target="_blank" rel="noreferrer" className="text-accent hover:underline font-mono">@ketner_support_bot</a>
                  </span>
                  <span className="text-[11px] text-muted">
                    {t('settings.supportBotHint')}
                  </span>
                </div>
                {user ? (
                  <div className="font-mono text-[11px] text-muted bg-surface px-2.5 py-1 rounded border border-stroke/60 shrink-0">
                    User ID: {user.id}
                  </div>
                ) : null}
              </div>
            </Card>
          </section>

          {/* 4. Администрирование (только для админов) */}
          {hasAdminAccess ? (
            <section id="admin">
              <Card className="flex flex-col gap-4 p-5 md:p-6 border-accent/40 bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-3">
                  <div className="flex items-center gap-2.5">
                    <KeyIcon className="text-accent text-lg" />
                    <div>
                      <CardTitle className="text-sm font-semibold text-text">
                        Панель администратора
                      </CardTitle>
                      <CardText className="text-xs text-muted mt-0.5">
                        Управление пользователями, лимиты, маржинальность
                      </CardText>
                    </div>
                  </div>
                  <Link to="/admin">
                    <Button variant="primary" size="sm" className="text-xs">
                      Открыть панель →
                    </Button>
                  </Link>
                </div>

                <div className="flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3">
                  <label htmlFor="admin-key-input" className="text-xs font-mono text-muted">
                    Admin API Key (x-admin-key):
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="admin-key-input"
                      type="password"
                      placeholder="ketner-ai-admin-key-dev"
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                      className="h-8 min-w-[200px] flex-1 rounded-md border border-stroke bg-surface px-3 text-xs text-text outline-none focus:border-accent font-mono"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSaveAdminKey(adminKey)}
                      className="text-xs"
                    >
                      {adminKeySaved ? 'Сохранено ✓' : 'Сохранить ключ'}
                    </Button>
                  </div>
                </div>
              </Card>
            </section>
          ) : null}

          {/* 5. Опасная зона: Выход */}
          {user ? (
            <section id="danger">
              <Card className="flex items-center justify-between gap-4 p-5 border-danger/30 bg-surface">
                <div>
                  <CardTitle className="text-sm font-semibold text-danger">
                    {t('settings.logout')}
                  </CardTitle>
                  <CardText className="text-xs text-muted mt-0.5">
                    {t('settings.loggedInAs')} {user.email}
                  </CardText>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void logout()}
                  className="gap-1.5 text-xs"
                >
                  <LogoutIcon className="text-sm" />
                  {t('settings.logout')}
                </Button>
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
