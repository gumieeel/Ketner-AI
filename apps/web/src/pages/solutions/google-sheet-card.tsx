import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  ApiError,
  clearGoogleReturn,
  googleSheetsApi,
  readGoogleReturn,
  type GoogleSheetStatus,
} from '@/features/google/api';
import { useTranslation } from '@/i18n';

/**
 * Запись заявок в Google Таблицу (этап F): подключение, статус, поломки и «дописать пропущенные».
 * Показывается только при открытом переключателе `googleSheets` (решает LeadsSection).
 *
 * Возврат от Google приходит фрагментом адреса (`#google_code=…&google_state=…`): код
 * подтверждается здесь, в той же сессии, и сразу убирается из адреса.
 */
export function GoogleSheetCard({
  onChange,
  onAvailable,
}: {
  onChange: () => void;
  /** Открыты ли Google Таблицы для аккаунта (сервер ответил не 503). */
  onAvailable: (available: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GoogleSheetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const handledReturn = useRef(false);
  // Закрыто для аккаунта (503 feature_unavailable): карточки нет.
  const [closed, setClosed] = useState(false);

  const fail = useCallback(
    (error: unknown) => {
      setMessage({
        tone: 'error',
        text: error instanceof ApiError && error.message ? error.message : t('google.sheet.error'),
      });
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      setStatus(await googleSheetsApi.status());
      onAvailable(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'feature_unavailable') {
        setClosed(true);
        onAvailable(false);
        return;
      }
      fail(error);
    }
  }, [fail, onAvailable]);

  useEffect(() => {
    if (handledReturn.current) return;
    handledReturn.current = true;
    const returned = readGoogleReturn(window.location.hash);
    if (!returned) {
      void load();
      return;
    }
    clearGoogleReturn();
    if ('error' in returned) {
      setMessage({
        tone: 'error',
        text: returned.error === 'denied' ? t('google.sheet.denied') : t('google.sheet.error'),
      });
      void load();
      return;
    }
    setBusy(true);
    googleSheetsApi
      .confirm(returned.code, returned.state)
      .then((next) => {
        setStatus(next);
        setMessage({ tone: 'ok', text: t('google.sheet.connectedNotice') });
        onChange();
      }, fail)
      .finally(() => {
        setBusy(false);
        void load();
      });
  }, [fail, load, onChange, t]);

  const run = async (action: () => Promise<GoogleSheetStatus | null>, notice?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      if (next) setStatus(next);
      if (notice) setMessage({ tone: 'ok', text: notice });
      onChange();
      await load();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await googleSheetsApi.start(window.location.href.split('#')[0]!);
      window.location.assign(url);
    } catch (error) {
      fail(error);
      setBusy(false);
    }
  };

  const state = status?.status ?? null;
  const pending = status?.pending ?? 0;
  // Пока не известно, открыто ли, и для закрытых аккаунтов — ничего не показываем.
  if (closed || (status === null && !message && !busy)) return null;

  return (
    <div className="mt-4 rounded-xl border border-stroke px-5 py-4" data-testid="google-sheet-card">
      <p className="text-[15px] font-medium text-text">{t('google.sheet.title')}</p>
      {status === null && !message ? (
        <p className="mt-2">
          <Spinner />
        </p>
      ) : null}

      {status && (state === null || state === 'disconnected') ? (
        <>
          <p className="mt-1 text-[14px] leading-6 text-muted">{t('google.sheet.offer')}</p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void connect()}>
            {t('google.sheet.connect')}
          </Button>
        </>
      ) : null}

      {state === 'connected' ? (
        <>
          <p className="mt-1 text-[14px] leading-6 text-muted">
            {status?.email
              ? t('google.sheet.connectedAs', { email: status.email })
              : t('google.sheet.connected')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {status?.spreadsheetUrl ? (
              <a
                href={status.spreadsheetUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[14px] font-medium text-accent underline-offset-4 hover:underline"
              >
                {t('google.sheet.open')}
              </a>
            ) : null}
            {pending > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => googleSheetsApi.backfill(), t('google.sheet.backfillDone'))
                }
              >
                {t('google.sheet.backfill', { count: String(pending) })}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => googleSheetsApi.disconnect())}
            >
              {t('google.sheet.disconnect')}
            </Button>
          </div>
        </>
      ) : null}

      {state === 'reconnect_required' ? (
        <div role="alert" className="mt-2 rounded-lg bg-warning-soft px-4 py-3">
          <p className="text-[14px] leading-6 text-text">{t('google.sheet.revoked')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              {t('google.sheet.reconnect')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => googleSheetsApi.disconnect())}
            >
              {t('google.sheet.disconnect')}
            </Button>
          </div>
        </div>
      ) : null}

      {state === 'sheet_missing' ? (
        <div role="alert" className="mt-2 rounded-lg bg-warning-soft px-4 py-3">
          <p className="text-[14px] leading-6 text-text">{t('google.sheet.missing')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => googleSheetsApi.newSheet(), t('google.sheet.newSheetDone'))
              }
            >
              {t('google.sheet.newSheet')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await googleSheetsApi.recheck();
                  setMessage(
                    next.status === 'connected'
                      ? { tone: 'ok', text: t('google.sheet.recheckDone') }
                      : { tone: 'error', text: t('google.sheet.recheckStill') },
                  );
                  return next;
                })
              }
            >
              {t('google.sheet.recheck')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => googleSheetsApi.disconnect())}
            >
              {t('google.sheet.disconnect')}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={
            message.tone === 'error'
              ? 'mt-3 text-[14px] leading-6 text-danger'
              : 'mt-3 text-[14px] leading-6 text-success'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
