import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertIcon, CheckIcon, TelegramIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { QrCode } from '@/components/ui/qr-code';
import { Spinner } from '@/components/ui/spinner';
import type { AuthSession, User } from '@/features/auth/types';
import { ApiError } from '@/features/chat/api';
import {
  telegramSiteAuth,
  type TelegramAuthMode,
  type TelegramAuthStart,
} from '@/features/telegram/site-auth';
import { useTranslation } from '@/i18n';

type Phase =
  | { kind: 'starting' }
  | { kind: 'waiting'; request: TelegramAuthStart }
  | { kind: 'declined' }
  | { kind: 'expired' }
  | { kind: 'unlinked' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const POLL_MS = 2000;

/**
 * Вход или привязка через Telegram без кодов и команд: ссылка (или QR с телефона) открывает бота,
 * человек жмёт «Подтвердить», окно само узнаёт об этом и завершает вход.
 */
export function TelegramAuthDialog({
  mode,
  token,
  onClose,
  onLogin,
  onLinked,
}: {
  mode: TelegramAuthMode;
  /** Токен сессии сайта — нужен для привязки. */
  token?: string | null;
  onClose: () => void;
  onLogin?: (session: AuthSession) => void | Promise<void>;
  onLinked?: (user: User) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [now, setNow] = useState(() => Date.now());
  const tRef = useRef(t);
  tRef.current = t;
  const handlers = useRef({ onLogin, onLinked });
  handlers.current = { onLogin, onLinked };

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' });
    try {
      const request = await telegramSiteAuth.start(mode, token);
      setPhase({ kind: 'waiting', request });
      setNow(Date.now());
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof ApiError ? error.message : tRef.current('tgAuth.errorStart'),
      });
    }
  }, [mode, token]);

  useEffect(() => {
    void start();
  }, [start]);

  const requestId = phase.kind === 'waiting' ? phase.request.requestId : null;

  useEffect(() => {
    if (!requestId) return;
    let stopped = false;
    let busy = false;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      if (busy || stopped) return;
      busy = true;
      void telegramSiteAuth
        .poll(requestId)
        .then(async (result) => {
          if (stopped) return;
          if (result.status === 'approved') {
            stopped = true;
            setPhase({ kind: 'done' });
            if (result.mode === 'login') await handlers.current.onLogin?.(result);
            else handlers.current.onLinked?.(result.user);
          } else if (
            result.status === 'declined' ||
            result.status === 'expired' ||
            result.status === 'unlinked'
          ) {
            stopped = true;
            setPhase({ kind: result.status });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [requestId]);

  const left =
    phase.kind === 'waiting'
      ? Math.max(0, Math.ceil((Date.parse(phase.request.expiresAt) - now) / 1000))
      : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Modal labelledBy={titleId} onClose={onClose} size="sm">
      <ModalHeader
        titleId={titleId}
        icon={<TelegramIcon className="size-5" />}
        title={mode === 'login' ? t('tgAuth.loginTitle') : t('tgAuth.linkTitle')}
        description={mode === 'login' ? t('tgAuth.loginLead') : t('tgAuth.linkLead')}
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
        {phase.kind === 'starting' ? (
          <div className="flex min-h-48 items-center justify-center" aria-busy="true">
            <Spinner className="size-6" />
          </div>
        ) : null}

        {phase.kind === 'waiting' ? (
          <>
            <a
              href={phase.request.botUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ size: 'lg', fullWidth: true, className: 'gap-2' })}
            >
              <TelegramIcon className="size-5" />
              {t('tgAuth.openTelegram')}
            </a>
            <div className="hidden flex-col items-center gap-2 sm:flex">
              <p className="text-[13px] text-muted">{t('tgAuth.orScan')}</p>
              <QrCode
                value={phase.request.botUrl}
                size={168}
                badge={<TelegramIcon className="size-5 text-[#229ED9]" />}
              />
            </div>
            <ol className="flex flex-col gap-1.5 text-[14px] leading-5 text-text">
              <li>1. {t('tgAuth.step1')}</li>
              <li>2. {mode === 'login' ? t('tgAuth.step2Login') : t('tgAuth.step2Link')}</li>
            </ol>
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-muted"
            >
              <Spinner className="size-3.5 shrink-0" />
              <span className="flex-1">{t('tgAuth.waiting')}</span>
              <span className="tabular-nums text-subtle">{mmss}</span>
            </p>
          </>
        ) : null}

        {phase.kind === 'done' ? (
          <p
            role="status"
            className="flex min-h-32 items-center justify-center gap-2 text-[15px] font-medium text-text"
          >
            <CheckIcon className="size-5 text-accent" />
            {mode === 'login' ? t('tgAuth.doneLogin') : t('tgAuth.doneLink')}
          </p>
        ) : null}

        {phase.kind === 'declined' ||
        phase.kind === 'expired' ||
        phase.kind === 'unlinked' ||
        phase.kind === 'error' ? (
          <>
            <p
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-[14px] leading-5 text-danger"
            >
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {phase.kind === 'declined'
                ? t('tgAuth.declined')
                : phase.kind === 'expired'
                  ? t('tgAuth.expired')
                  : phase.kind === 'unlinked'
                    ? t('tgAuth.unlinked')
                    : phase.message}
            </p>
            <Button fullWidth onClick={() => void start()}>
              {t('tgAuth.retry')}
            </Button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
