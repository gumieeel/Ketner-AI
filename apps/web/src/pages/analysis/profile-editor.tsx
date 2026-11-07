import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { EditIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AnalysisView } from '@/features/discovery/api';
import {
  CHANNELS,
  INDUSTRIES,
  TEAM_SIZES,
  updateProfile,
  type BusinessProfileData,
} from '@/features/pricing/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { ErrorNotice } from './error-notice';

const EMPTY: BusinessProfileData = {
  businessName: null,
  industry: null,
  subIndustry: null,
  city: null,
  businessModel: null,
  website: null,
  teamSize: null,
  customerChannels: [],
  existingTools: [],
  monthlyRequests: null,
  monthlyOrders: null,
  additionalContext: null,
};

/**
 * Профиль бизнеса: что Ketner понял из описания, и правка человеком. Сохранение не вызывает
 * модель: сервер пересчитывает сметы по новым данным (объём обращений, каналы).
 */
export function ProfileEditor({
  analysis,
  onChanged,
}: {
  analysis: AnalysisView;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const profile = { ...EMPTY, ...(analysis.context?.profile ?? {}) };
  const [editing, setEditing] = useState(false);
  const titleId = useId();

  const facts: Array<[string, string]> = [];
  if (profile.businessName) facts.push([t('profile.businessName'), profile.businessName]);
  if (profile.industry)
    facts.push([
      t('profile.industry'),
      t(`profile.industry.${profile.industry}` as TranslationKey),
    ]);
  if (profile.city) facts.push([t('profile.city'), profile.city]);
  if (profile.customerChannels.length > 0)
    facts.push([
      t('profile.channels'),
      profile.customerChannels
        .map((channel) => t(`profile.channel.${channel}` as TranslationKey))
        .join(', '),
    ]);
  if (profile.teamSize)
    facts.push([t('profile.teamSize'), t(`profile.team.${profile.teamSize}` as TranslationKey)]);
  if (profile.monthlyRequests !== null)
    facts.push([t('profile.monthlyRequests'), String(profile.monthlyRequests)]);
  if (profile.monthlyOrders !== null)
    facts.push([t('profile.monthlyOrders'), String(profile.monthlyOrders)]);

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-stroke bg-surface px-5 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={titleId} className="flex items-center gap-2 text-[17px] font-medium text-text">
          {t('profile.title')}
          {profile.edited ? <Badge tone="brand">{t('profile.edited')}</Badge> : null}
        </h3>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <EditIcon aria-hidden="true" className="size-4" />
            {t('profile.edit')}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <ProfileForm
          analysisId={analysis.id}
          initial={profile}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      ) : (
        <>
          {facts.length > 0 ? (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] leading-6 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-subtle">{label}</dt>
                  <dd className="text-text">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="mt-3 text-[13px] leading-5 text-muted">{t('profile.hint')}</p>
        </>
      )}
    </section>
  );
}

function ProfileForm({
  analysisId,
  initial,
  onCancel,
  onSaved,
}: {
  analysisId: string;
  initial: BusinessProfileData;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<BusinessProfileData>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ids = {
    name: useId(),
    industry: useId(),
    city: useId(),
    team: useId(),
    requests: useId(),
    orders: useId(),
  };
  const set = <K extends keyof BusinessProfileData>(key: K, next: BusinessProfileData[K]) =>
    setValue((current) => ({ ...current, [key]: next }));
  const number = (raw: string) => {
    const parsed = Number.parseInt(raw.replace(/\s/g, ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const text = (raw: string) => (raw.trim() ? raw : null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(analysisId, {
        ...value,
        businessName: value.businessName?.trim() || null,
        city: value.city?.trim() || null,
      });
      await onSaved();
    } catch (caught) {
      setError(caught);
      setSaving(false);
    }
  };

  const selectClass =
    'h-12 w-full rounded-xl border border-stroke bg-surface px-3 text-[15px] text-text focus:border-accent focus:ring-2 focus:ring-accent-soft focus:outline-none md:h-11';

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Label id={ids.name} text={t('profile.businessName')}>
          <Input
            id={ids.name}
            value={value.businessName ?? ''}
            maxLength={120}
            onChange={(event) => set('businessName', text(event.target.value))}
          />
        </Label>
        <Label id={ids.industry} text={t('profile.industry')}>
          <select
            id={ids.industry}
            className={selectClass}
            value={value.industry ?? ''}
            onChange={(event) => set('industry', event.target.value || null)}
          >
            <option value="">{t('profile.notSet')}</option>
            {INDUSTRIES.map((industry) => (
              <option key={industry} value={industry}>
                {t(`profile.industry.${industry}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Label>
        <Label id={ids.city} text={t('profile.city')}>
          <Input
            id={ids.city}
            value={value.city ?? ''}
            maxLength={80}
            placeholder={t('profile.cityPlaceholder')}
            onChange={(event) => set('city', text(event.target.value))}
          />
        </Label>
        <Label id={ids.team} text={t('profile.teamSize')}>
          <select
            id={ids.team}
            className={selectClass}
            value={value.teamSize ?? ''}
            onChange={(event) =>
              set('teamSize', (event.target.value || null) as BusinessProfileData['teamSize'])
            }
          >
            <option value="">{t('profile.notSet')}</option>
            {TEAM_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`profile.team.${size}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Label>
        <Label id={ids.requests} text={t('profile.monthlyRequests')}>
          <Input
            id={ids.requests}
            inputMode="numeric"
            value={value.monthlyRequests ?? ''}
            onChange={(event) => set('monthlyRequests', number(event.target.value))}
          />
        </Label>
        <Label id={ids.orders} text={t('profile.monthlyOrders')}>
          <Input
            id={ids.orders}
            inputMode="numeric"
            value={value.monthlyOrders ?? ''}
            onChange={(event) => set('monthlyOrders', number(event.target.value))}
          />
        </Label>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-text">{t('profile.channels')}</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((channel) => {
            const checked = value.customerChannels.includes(channel);
            return (
              <label
                key={channel}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-stroke px-3 text-[14px] text-text has-[:checked]:border-accent md:min-h-9"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    set(
                      'customerChannels',
                      checked
                        ? value.customerChannels.filter((item) => item !== channel)
                        : [...value.customerChannels, channel],
                    )
                  }
                />
                {t(`profile.channel.${channel}` as TranslationKey)}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? <ErrorNotice error={error} redirect={`/analyses/${analysisId}`} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? t('profile.saving') : t('profile.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('profile.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Label({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {text}
      </label>
      {children}
    </div>
  );
}
