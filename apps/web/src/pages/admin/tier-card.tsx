import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';

/** Тариф и обращения пользователя (P3, `GET /api/admin/users/:id` → `tier`). */
export interface AdminTierInfo {
  tier: 'start' | 'growth' | 'business' | 'scale' | null;
  used: number;
  included: number | null;
  limit: number | null;
  state: 'ok' | 'warning' | 'grace' | 'leads_only' | 'no_tier';
  action: 'answer' | 'form_only' | 'leads_only';
  enforced: boolean;
  wouldLimit: number;
  setBy: string | null;
  setAt: string | null;
  note: string | null;
}

const TIERS = ['start', 'growth', 'business', 'scale'] as const;
const TIER_NAMES: Record<(typeof TIERS)[number], string> = {
  start: 'Start',
  growth: 'Growth',
  business: 'Business',
  scale: 'Scale',
};

/**
 * Тариф аккаунта в карточке администратора: назначить, сменить, снять. Пока тарифы не включены
 * (`TIER_ENFORCED = false`), здесь видно, что было бы с ответами посетителям при включении.
 */
export function AdminTierCard({
  userId,
  info,
  headers,
  onChanged,
}: {
  userId: string;
  info: AdminTierInfo;
  headers: () => HeadersInit;
  onChanged: () => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const selectId = useId();
  const noteId = useId();
  const [tier, setTier] = useState<string>(info.tier ?? '');
  const [note, setNote] = useState(info.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}/tier`, {
        method: tier ? 'PUT' : 'DELETE',
        headers: headers(),
        credentials: 'include',
        ...(tier ? { body: JSON.stringify({ tier, note: note.trim() || undefined }) } : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message || t('admin.tier.error'));
      }
      setSaved(true);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('admin.tier.error'));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');

  return (
    <div className="space-y-3" data-testid="admin-tier">
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{t('admin.tier.current')}</dt>
          <dd className="font-medium text-text">
            {info.tier ? TIER_NAMES[info.tier] : t('admin.tier.none')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.tier.requests')}</dt>
          <dd className="font-medium text-text tabular-nums">
            {info.included !== null && info.limit !== null
              ? t('admin.tier.usedOf', {
                  used: fmt(info.used),
                  included: fmt(info.included),
                  limit: fmt(info.limit),
                })
              : fmt(info.used)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.tier.state')}</dt>
          <dd className="text-text">{t(`admin.tier.state.${info.state}` as TranslationKey)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.tier.wouldLimit')}</dt>
          <dd className="font-medium text-text tabular-nums">{fmt(info.wouldLimit)}</dd>
        </div>
      </dl>
      {!info.enforced ? (
        <p className="rounded-lg border border-stroke bg-surface px-3 py-2 text-[13px] leading-5 text-muted">
          {t('admin.tier.shadow')}
        </p>
      ) : null}
      {info.setBy && info.setAt ? (
        <p className="text-xs text-subtle">
          {t('admin.tier.setBy', { who: info.setBy, when: formatDateTime(info.setAt, language) })}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end">
        <label htmlFor={selectId} className="flex flex-col gap-1 text-xs text-muted">
          {t('admin.tier.select')}
          <select
            id={selectId}
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            className="h-10 rounded-lg border border-stroke bg-surface px-2 text-sm text-text"
          >
            <option value="">{t('admin.tier.none')}</option>
            {TIERS.map((id) => (
              <option key={id} value={id}>
                {TIER_NAMES[id]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={noteId} className="flex flex-col gap-1 text-xs text-muted">
          {t('admin.tier.note')}
          <input
            id={noteId}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            className="h-10 rounded-lg border border-stroke bg-surface px-3 text-sm text-text"
          />
        </label>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {t('admin.tier.save')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-success">{t('admin.tier.saved')}</p> : null}
    </div>
  );
}
