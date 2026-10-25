import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, CopyIcon, KeyIcon, PlusIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { DocSection } from '@/components/docs/doc-section';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Input } from '@/components/ui/input';
import { RichText } from '@/components/ui/rich-text';
import { useAuth } from '@/features/auth/auth-store';
import { ApiError, apiKeysApi, type ApiKeyInfo } from '@/features/api-keys/api';
import { useTranslation } from '@/i18n';
import { copyText } from '@/lib/clipboard';
import { formatShortDate } from '@/lib/format-date';

interface KeysSectionProps {
  /** Новый секрет: страница подставляет его в примеры, пока не обновится. */
  onSecretCreated: (secret: string | null) => void;
}

/**
 * Настоящие API-ключи: список, создание и отзыв через /api/keys. Секрет приходит с сервера
 * один раз — при создании, и показывается до тех пор, пока человек не нажмёт «Готово».
 */
export function KeysSection({ onSecretCreated }: KeysSectionProps) {
  const { t, language } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const signedIn = status === 'authenticated' && Boolean(user);
  const nameId = useId();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    setLoading(true);
    apiKeysApi
      .list()
      .then((list) => {
        if (!cancelled) setKeys(list);
      })
      .catch(() => {
        if (!cancelled) setError(t('dev.keysLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // t меняется вместе с языком, перезагружать ключи из-за этого не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiKeysApi.create(name.trim());
      setKeys((current) => [created.key, ...current]);
      setSecret(created.secret);
      onSecretCreated(created.secret);
      setName('');
      setFormOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('dev.keysLoadError'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiKeysApi.revoke(id);
      setKeys((current) => current.filter((key) => key.id !== id));
      setConfirmId(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('dev.keysLoadError'));
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    await copyText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DocSection
      id="keys"
      icon={<KeyIcon className="size-5" />}
      title={t('dev.keysTitle')}
      description={t('dev.keysDesc')}
      aside={
        signedIn && !formOpen ? (
          <Button
            size="sm"
            onClick={() => setFormOpen(true)}
            leftIcon={<PlusIcon className="size-3.5" />}
          >
            {t('dev.keysCreate')}
          </Button>
        ) : null
      }
    >
      {!signedIn ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-stroke bg-canvas p-4">
          <p className="text-[15px] text-text">{t('dev.keysSignIn')}</p>
          <Link to="/login" className={buttonClasses({ size: 'sm' })}>
            {t('dev.keysSignInCta')}
          </Link>
        </div>
      ) : null}

      {secret ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent-soft p-4"
        >
          <div>
            <p className="font-medium text-text">{t('dev.keysNewTitle')}</p>
            <p className="mt-1 text-[14px] text-muted">{t('dev.keysNewText')}</p>
          </div>
          <code
            tabIndex={0}
            className="block overflow-x-auto rounded-md border border-stroke bg-surface px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-text select-all"
          >
            {secret}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={copySecret}
              leftIcon={
                copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />
              }
            >
              {copied ? t('dev.keysCopied') : t('dev.keysCopy')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSecret(null);
                setCopied(false);
              }}
            >
              {t('dev.keysDone')}
            </Button>
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={create}
          className="flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3 @md:flex-row @md:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={nameId} className="text-[13px] font-medium text-text">
              {t('dev.keysName')}
            </label>
            <Input
              id={nameId}
              required
              autoFocus
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('dev.keysNamePlaceholder')}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={busy || name.trim() === ''}>
              {t('dev.keysSubmit')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              {t('dev.keysCancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[14px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {signedIn && loading ? (
        <p className="text-[14px] text-muted">{t('dev.keysLoading')}</p>
      ) : null}
      {signedIn && !loading && keys.length === 0 && !error ? (
        <p className="text-[14px] text-muted">{t('dev.keysEmpty')}</p>
      ) : null}

      {keys.length > 0 ? (
        <ul className="flex flex-col divide-y divide-stroke rounded-lg border border-stroke bg-canvas">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-col gap-3 p-4 @md:flex-row @md:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-text">{key.name}</p>
                <p className="mt-1 text-[13px] text-muted">
                  <code className="font-mono text-text">{key.prefix}…</code>{' '}
                  {t('dev.keysCreated', { date: formatShortDate(key.createdAt, language) })},{' '}
                  {key.lastUsedAt
                    ? t('dev.keysUsed', { date: formatShortDate(key.lastUsedAt, language) })
                    : t('dev.keysNeverUsed')}
                </p>
              </div>
              {confirmId === key.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text">
                    {t('dev.keysRevokeConfirm', { name: key.name })}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onClick={() => void revoke(key.id)}
                  >
                    {t('dev.keysRevokeYes')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                    {t('dev.keysCancel')}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirmId(key.id)}>
                  {t('dev.keysRevoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <Callout tone="info" className="my-0">
        <RichText text={t('dev.keysSafety')} />
      </Callout>
    </DocSection>
  );
}
