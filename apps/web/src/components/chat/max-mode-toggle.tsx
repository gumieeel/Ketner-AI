import { BoltIcon, LockIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { canUseMaxMode } from '@/features/chat/reasoning-mode';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Переключатель режима Max. На Ultra модели Pro и Ultra размышляют на уровне xhigh вместо medium
 * (запрос считается за 2 в суточном лимите модели). На остальных тарифах кнопка видна с замком и
 * открывает окно перехода на Ultra.
 */
export function MaxModeToggle({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const maxMode = usePreferences((state) => state.maxMode);
  const setMaxMode = usePreferences((state) => state.setMaxMode);
  const openUpgrade = useUpgradeModal((state) => state.open);

  const allowed = canUseMaxMode(user);
  const on = allowed && maxMode;
  const hint = !allowed ? t('chat.maxModeLocked') : on ? t('chat.maxModeOn') : t('chat.maxModeOff');

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={allowed ? on : undefined}
      aria-label={`${t('chat.maxMode')}: ${hint}`}
      title={hint}
      onClick={() => {
        if (!allowed) {
          openUpgrade({ reason: 'max_mode', requiredPlan: 'ULTRA' });
          return;
        }
        setMaxMode(!maxMode);
      }}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold max-md:h-11',
        'transition-[background-color,border-color,color,box-shadow] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        on
          ? 'border-accent/50 bg-accent-soft text-accent shadow-glow'
          : 'border-stroke bg-surface-2/70 text-muted hover:border-stroke-strong hover:bg-surface-2 hover:text-text',
      )}
    >
      {allowed ? (
        <BoltIcon className="size-3.5" aria-hidden="true" />
      ) : (
        <LockIcon className="size-3.5" aria-hidden="true" />
      )}
      <span>{t('chat.maxMode')}</span>
    </button>
  );
}
