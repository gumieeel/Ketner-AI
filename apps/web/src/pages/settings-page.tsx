import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCardIcon,
  KeyIcon,
  LogoutIcon,
  MessagesIcon,
  SparkleIcon,
  SunIcon,
  TelegramIcon,
  UserIcon,
} from '@/components/icons';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { unlinkTelegram } from '@/features/auth/api';
import { useAuth } from '@/features/auth/auth-store';
import { useBilling } from '@/features/billing/billing-store';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format-date';

/** Подсвечивает в навигации раздел, который сейчас в верхней трети экрана. */
function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const sectionIds = key.split('|');
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        const first = sectionIds.find((id) => visible.has(id));
        if (first) {
          setActive(first);
        }
      },
      { rootMargin: '-8% 0px -65% 0px' },
    );
    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [key]);

  return active;
}

interface SettingsSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description?: string;
  /** Действие справа от заголовка: на мобильных переносится под него. */
  action?: ReactNode;
  tone?: 'default' | 'accent' | 'danger';
  children?: ReactNode;
}

const TONE_CARD: Record<NonNullable<SettingsSectionProps['tone']>, string> = {
  default: '',
  accent: 'border-accent/35',
  danger: 'border-danger/30',
};

const TONE_ICON: Record<NonNullable<SettingsSectionProps['tone']>, string> = {
  default: 'bg-surface-2 text-muted ring-stroke',
  accent: 'bg-accent-soft text-accent ring-accent/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
};

/** Карточка раздела настроек: иконка, заголовок, пояснение, действие и содержимое. */
function SettingsSection({
  id,
  icon,
  title,
  description,
  action,
  tone = 'default',
  children,
}: SettingsSectionProps) {
  const titleId = `${id}-title`;

  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-20 lg:scroll-mt-6">
      <Card className={cn('flex flex-col gap-4 p-4 sm:p-6', TONE_CARD[tone])}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
                TONE_ICON[tone],
              )}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <CardTitle id={titleId} className={cn(tone === 'danger' && 'text-danger')}>
                {title}
              </CardTitle>
              {description ? (
                <CardText className="mt-0.5 text-[13px] leading-5 break-words">{description}</CardText>
              ) : null}
            </div>
          </div>
          {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        </div>
        {children}
      </Card>
    </section>
  );
}

/** Строка «подпись — значение» внутри карточки. */
function InfoTile({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-stroke bg-canvas px-3.5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm text-text', mono && 'font-mono text-[13px] select-all')}>
        {children}
      </div>
    </div>
  );
}

/** Пояснение под действием: на подложке, чтобы отделить от заголовка карточки. */
function Note({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-stroke bg-canvas px-3.5 py-3 text-[13px] leading-5">
      {title ? <span className="font-medium text-text">{title}</span> : null}
      <span className="text-muted">{children}</span>
    </div>
  );
}

const PLAN_TONES: Record<string, BadgeTone> = {
  free: 'neutral',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
};

const PLAN_NAME_KEYS: Record<string, TranslationKey> = {
  free: 'pricing.free',
  plus: 'pricing.plus',
  pro: 'pricing.pro',
};

export function SettingsPage() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const setUser = useAuth((state) => state.setUser);
  const token = useAuth((state) => state.token);
  const logout = useAuth((state) => state.logout);
  const subscription = useBilling((state) => state.subscription);
  const billingLoading = useBilling((state) => state.loading);
  const loadSubscription = useBilling((state) => state.loadSubscription);
  const cancel = useBilling((state) => state.cancel);

  const [canceling, setCanceling] = useState(false);
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);

  const handleUnlinkTelegram = async () => {
    if (!token) return;
    setUnlinkingTelegram(true);
    try {
      const updated = await unlinkTelegram(token);
      setUser(updated);
    } catch {
      // ignore
    } finally {
      setUnlinkingTelegram(false);
    }
  };
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

  const hasAdminAccess = Boolean(user?.isAdmin);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription, user]);

  const isPaid = user?.plan && user.plan !== 'free';
  const isCanceled = subscription?.status === 'canceled';
  const telegramLinked = Boolean(user?.telegramChatId || user?.telegramUsername);

  const handleCancel = async () => {
    setCanceling(true);
    try {
      await cancel();
    } finally {
      setCanceling(false);
    }
  };

  const planKey = user?.plan ? PLAN_NAME_KEYS[user.plan] : undefined;
  const planLabel = planKey ? t(planKey) : user?.plan === 'ultra' ? 'Ultra' : t('pricing.free');
  const planTone: BadgeTone = (user?.plan && PLAN_TONES[user.plan]) || (user?.plan ? 'brand' : 'neutral');

  const sections: Array<{ id: string; label: string; danger?: boolean }> = [
    { id: 'account', label: t('settings.account') },
    { id: 'appearance', label: t('settings.appearance') },
    { id: 'subscription', label: t('settings.subscription') },
    { id: 'telegram', label: 'Telegram' },
    { id: 'support', label: t('settings.support') },
    ...(hasAdminAccess ? [{ id: 'admin', label: 'Admin API' }] : []),
    ...(user ? [{ id: 'danger', label: t('settings.logout'), danger: true }] : []),
  ];
  const active = useActiveSection(sections.map((section) => section.id));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 text-text md:px-8">
      <header className="pt-6 pb-4 md:pt-10 md:pb-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-text md:text-3xl">
          {t('settings.title')}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">{t('settings.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10">
        {/* Навигация: вкладки сверху на узких экранах, колонка слева на широких */}
        <nav
          aria-label={t('settings.navLabel')}
          className="sticky top-0 z-10 -mx-4 border-b border-stroke bg-canvas px-4 lg:top-6 lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0"
        >
          <ul className="flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-0 [&::-webkit-scrollbar]:hidden">
            {sections.map((section) => {
              const isActive = active === section.id;
              return (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'relative flex min-h-11 items-center rounded-md px-4 text-sm whitespace-nowrap transition-colors lg:min-h-10 lg:rounded-lg lg:px-3',
                      isActive
                        ? 'bg-surface-2 font-medium text-text ring-1 ring-stroke-strong ring-inset'
                        : 'text-muted hover:bg-surface hover:text-text',
                      section.danger && !isActive && 'text-danger hover:bg-danger-soft hover:text-danger',
                      section.danger && isActive && 'text-danger',
                    )}
                  >
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          {/* Аккаунт */}
          <SettingsSection
            id="account"
            icon={<UserIcon className="size-5" />}
            title={user ? user.name : t('settings.account')}
            description={
              user
                ? `${user.email} · ${t('settings.registeredOn')}: ${formatShortDate(user.createdAt, language)}`
                : `${t('settings.guestTitle')}. ${t('settings.guestText')}`
            }
            action={
              !user ? (
                <Link to="/login" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
                  {t('nav.login')}
                </Link>
              ) : null
            }
          >
            {user ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoTile label="User ID" mono>
                  {user.id}
                </InfoTile>
                <InfoTile label="Email">{user.email}</InfoTile>
              </div>
            ) : null}
          </SettingsSection>

          {/* Внешний вид */}
          <SettingsSection
            id="appearance"
            icon={<SunIcon className="size-5" />}
            title={t('settings.appearance')}
            description={t('settings.appearanceText')}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:max-xl:grid-cols-1">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-stroke bg-canvas py-1.5 pr-1.5 pl-3.5">
                <span className="text-sm font-medium text-text">{t('settings.theme')}</span>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-stroke bg-canvas py-1.5 pr-1.5 pl-3.5">
                <span className="text-sm font-medium text-text">{t('settings.language')}</span>
                <LanguageToggle />
              </div>
            </div>
          </SettingsSection>

          {/* Подписка */}
          <SettingsSection
            id="subscription"
            icon={<CreditCardIcon className="size-5" />}
            title={t('settings.subscription')}
            action={
              isPaid && !isCanceled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={canceling}
                  className="text-danger hover:border-danger/40 hover:bg-danger-soft"
                >
                  {canceling ? t('settings.canceling') : t('settings.cancelSubscription')}
                </Button>
              ) : (
                <Link to="/pricing" className={cn(buttonClasses({ variant: 'primary', size: 'sm' }), 'gap-1.5')}>
                  <SparkleIcon className="size-3.5" />
                  {t('nav.upgrade')}
                </Link>
              )
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={planTone}>{planLabel}</Badge>
              {isPaid ? (
                <Badge tone={isCanceled ? 'warning' : 'success'}>
                  {isCanceled ? t('settings.statusCanceled') : t('settings.statusActive')}
                </Badge>
              ) : null}
            </div>
            {isPaid && !subscription && billingLoading ? (
              <Skeleton className="h-4 w-56 max-w-full" />
            ) : (
              <CardText className="text-[13px] leading-5">
                {isPaid
                  ? isCanceled
                    ? t('settings.canceledNotice')
                    : `${t('settings.renewsAt')}: ${formatShortDate(
                        subscription?.renewsAt ?? new Date().toISOString(),
                        language,
                      )}`
                  : t('settings.subscriptionText')}
              </CardText>
            )}
          </SettingsSection>

          {/* Telegram: аккаунт и платежи */}
          <SettingsSection
            id="telegram"
            icon={<TelegramIcon className="size-5" />}
            title={t('settings.telegramTitle')}
            description={t('settings.telegramDesc')}
            action={
              telegramLinked ? (
                <>
                  <a
                    href="https://t.me/Robo_kassa_bot"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonClasses({ variant: 'secondary', size: 'sm' }), 'gap-1.5')}
                  >
                    <TelegramIcon className="size-3.5" />
                    {t('settings.telegramOpenBot')}
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnlinkTelegram}
                    disabled={unlinkingTelegram}
                    className="text-danger hover:border-danger/40 hover:bg-danger-soft"
                  >
                    {unlinkingTelegram ? t('settings.telegramUnlinking') : t('settings.telegramUnlink')}
                  </Button>
                </>
              ) : (
                <a
                  href={`https://t.me/Robo_kassa_bot?start=link_${user?.id || 'demo'}`}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonClasses({ variant: 'primary', size: 'sm' }), 'gap-1.5')}
                >
                  <TelegramIcon className="size-3.5" />
                  {t('settings.telegramConnect')}
                </a>
              )
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={telegramLinked ? 'success' : 'neutral'}>
                {telegramLinked ? t('settings.telegramConnected') : t('settings.telegramNotLinked')}
              </Badge>
            </div>
            {telegramLinked ? (
              <Note
                title={
                  <>
                    {t('settings.telegramLinkedAs')}{' '}
                    <strong className="font-mono font-semibold text-accent">
                      {user?.telegramUsername ? `@${user.telegramUsername}` : `ID: ${user?.telegramChatId}`}
                    </strong>
                  </>
                }
              >
                {t('settings.telegramLinkedHint')}
              </Note>
            ) : (
              <Note title={t('settings.telegramLinkTitle')}>{t('settings.telegramLinkHint')}</Note>
            )}
          </SettingsSection>

          {/* Поддержка */}
          <SettingsSection
            id="support"
            icon={<MessagesIcon className="size-5" />}
            title={t('settings.support')}
            description={t('settings.supportDesc')}
            action={
              <a
                href="https://t.me/ketner_support_bot"
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonClasses({ variant: 'secondary', size: 'sm' }),
                  'h-auto min-h-11 gap-1.5 py-2 text-center whitespace-normal md:min-h-9',
                )}
              >
                <TelegramIcon className="size-3.5 shrink-0" />
                <span>{t('settings.supportContactBtn')}</span>
              </a>
            }
          >
            <Note
              title={
                <>
                  {t('settings.supportBotLabel')}{' '}
                  <a
                    href="https://t.me/ketner_support_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-accent hover:underline"
                  >
                    @ketner_support_bot
                  </a>
                </>
              }
            >
              {t('settings.supportBotHint')}
              {user ? (
                <span className="mt-2 block font-mono text-xs text-subtle select-all">User ID: {user.id}</span>
              ) : null}
            </Note>
          </SettingsSection>

          {/* Администрирование (только для админов) */}
          {hasAdminAccess ? (
            <SettingsSection
              id="admin"
              tone="accent"
              icon={<KeyIcon className="size-5" />}
              title={t('settings.adminTitle')}
              description={t('settings.adminDesc')}
              action={
                <Link to="/admin" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
                  {t('settings.adminOpen')}
                </Link>
              }
            >
              <div className="flex flex-col gap-2 rounded-xl border border-stroke bg-canvas p-3.5">
                <label htmlFor="admin-key-input" className="text-xs text-muted">
                  {t('settings.adminKeyLabel')}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="admin-key-input"
                    type="password"
                    placeholder="ketner-ai-admin-key-dev"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    className="h-11 min-w-[200px] flex-1 rounded-md border border-stroke bg-surface px-3 font-mono text-[13px] text-text transition-[border-color,box-shadow] placeholder:text-subtle hover:border-stroke-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none md:h-9"
                  />
                  <Button variant="outline" size="sm" onClick={() => handleSaveAdminKey(adminKey)}>
                    {adminKeySaved ? t('settings.adminKeySaved') : t('settings.adminKeySave')}
                  </Button>
                </div>
              </div>
            </SettingsSection>
          ) : null}

          {/* Выход */}
          {user ? (
            <SettingsSection
              id="danger"
              tone="danger"
              icon={<LogoutIcon className="size-5" />}
              title={t('settings.logout')}
              description={`${t('settings.loggedInAs')} ${user.email}`}
              action={
                <Button variant="danger" size="sm" onClick={() => void logout()} className="gap-1.5">
                  <LogoutIcon className="size-3.5" />
                  {t('settings.logout')}
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
