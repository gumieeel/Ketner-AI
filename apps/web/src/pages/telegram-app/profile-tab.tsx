import { useState } from 'react';
import {
  ExternalLinkIcon,
  GlobeIcon,
  MessagesIcon,
  SettingsIcon,
  TelegramIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError, miniAppApi, type MiniAppState } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { formatDate, Notice, Panel, SUPPORT_URL, Segmented, Toggle, useMiniApp } from './shared';
import { appHomePath } from '@/lib/product-switches';

export function ProfileTab({ onUnlinked }: { onUnlinked: () => void }) {
  const { t, language } = useTranslation();
  const setLanguage = usePreferences((s) => s.setLanguage);
  const { app, token, state, setState, notify, openSite } = useMiniApp();
  const { user, prefs } = state;
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const displayName = user.name || (user.telegramUsername ? `@${user.telegramUsername}` : 'Ketner');

  const savePrefs = async (patch: Partial<MiniAppState['prefs']>) => {
    setSavingPrefs(true);
    try {
      setState(await miniAppApi.prefs(token, patch));
      haptic.select(app);
    } catch (error) {
      notify('danger', error instanceof ApiError ? error.message : t('tg.errorGeneric'));
    } finally {
      setSavingPrefs(false);
    }
  };

  const open = async (path: string) => {
    setOpening(path);
    try {
      await openSite(path);
    } finally {
      setOpening(null);
    }
  };

  const unlink = async () => {
    setUnlinkError(null);
    try {
      await miniAppApi.unlink(token);
      haptic.success(app);
      onUnlinked();
    } catch (error) {
      haptic.error(app);
      setUnlinkError(error instanceof ApiError ? error.message : t('tg.errorGeneric'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-[18px] font-semibold text-accent"
        >
          {displayName.replace('@', '').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{displayName}</p>
          <p className="truncate text-[13px] text-muted">{user.email ?? t('tg.telegramAccount')}</p>
          <p className="mt-0.5 text-[12px] text-subtle">
            {user.telegramUsername ? `@${user.telegramUsername} · ` : ''}
            {t('tg.memberSince', { date: formatDate(user.createdAt, language, true) })}
          </p>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">{t('tg.siteTitle')}</h2>
        <p className="text-[13px] leading-5 text-muted">
          {user.telegramOnly ? t('tg.siteTextTelegram') : t('tg.siteText')}
        </p>
        <Button
          className="w-full gap-2"
          loading={opening === appHomePath()}
          onClick={() => void open(appHomePath())}
        >
          <MessagesIcon className="size-4" />
          {t('tg.openChat')}
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          loading={opening === '/settings'}
          onClick={() => void open('/settings')}
        >
          <SettingsIcon className="size-4" />
          {t('tg.openSiteSettings')}
        </Button>
      </Panel>

      <Panel aria-labelledby="tg-notify-title">
        <h2 id="tg-notify-title" className="text-[15px] font-semibold">
          {t('tg.notifyTitle')}
        </h2>
        <div className="mt-1 divide-y divide-stroke">
          <Toggle
            label={t('tg.notifyReminders')}
            description={t('tg.notifyRemindersHint')}
            checked={prefs.reminders}
            disabled={savingPrefs}
            onChange={(next) => void savePrefs({ reminders: next })}
          />
          <Toggle
            label={t('tg.notifyReceipts')}
            description={t('tg.notifyReceiptsHint')}
            checked={prefs.receipts}
            disabled={savingPrefs}
            onChange={(next) => void savePrefs({ receipts: next })}
          />
        </div>
        <p className="mt-2 text-[12px] leading-5 text-subtle">{t('tg.notifyRefundsAlways')}</p>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <GlobeIcon className="size-4 text-muted" />
          <h2 className="text-[15px] font-semibold">{t('tg.language')}</h2>
        </div>
        <Segmented
          label={t('tg.language')}
          value={language}
          onChange={(value) => {
            haptic.select(app);
            setLanguage(value);
          }}
          options={[
            { value: 'ru', label: 'Русский' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Panel>

      <Panel className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => app.openTelegramLink(SUPPORT_URL)}
        >
          <TelegramIcon className="size-4" />
          {t('tg.support')}
          <ExternalLinkIcon className="size-3.5" />
        </Button>
        {confirmUnlink ? (
          <div className="flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3">
            <p className="text-[13px] leading-5 text-text">
              {user.telegramOnly ? t('tg.logoutConfirm') : t('tg.unlinkConfirm')}
            </p>
            {unlinkError ? <Notice tone="danger">{unlinkError}</Notice> : null}
            <div className="flex gap-2">
              <Button variant="danger" size="sm" className="flex-1" onClick={() => void unlink()}>
                {user.telegramOnly ? t('tg.logoutYes') : t('tg.unlinkYes')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setConfirmUnlink(false)}
              >
                {t('tg.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmUnlink(true)}
            className="min-h-10 text-[13px] text-muted hover:text-text"
          >
            {user.telegramOnly ? t('tg.logout') : t('tg.unlink')}
          </button>
        )}
      </Panel>
    </div>
  );
}
