import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertIcon } from '@/components/icons';
import { AuthShell } from '@/components/layout/auth-shell';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/features/auth/auth-store';
import { ApiError } from '@/features/chat/api';
import { telegramSiteAuth } from '@/features/telegram/site-auth';
import { useTranslation } from '@/i18n';

function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/chat';
}

/**
 * `/auth/telegram?t=…&next=…` — вход по одноразовой ссылке из кабинета в Telegram.
 * Ссылка живёт две минуты и срабатывает один раз; токен сразу убирается из адресной строки.
 */
export function TelegramMagicPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const applySession = useAuth((state) => state.applySession);
  const [searchParams] = useSearchParams();
  // Параметры читаем один раз: после этого токен убирается из адреса.
  const initial = useRef({ magic: searchParams.get('t'), next: safeNext(searchParams.get('next')) });
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { magic, next } = initial.current;
    navigate('/auth/telegram', { replace: true });
    if (!magic) {
      setError(t('tgAuth.magicMissing'));
      return;
    }
    void telegramSiteAuth
      .magic(magic)
      .then(async (session) => {
        await applySession(session);
        navigate(next, { replace: true });
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : t('tgAuth.magicFailed')));
  }, [applySession, navigate, t]);

  return (
    <AuthShell title={t('tgAuth.magicTitle')}>
      {error ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[14px] leading-5 text-danger">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
          <Link to="/login" className={buttonClasses({ size: 'lg', fullWidth: true })}>
            {t('tgAuth.toLogin')}
          </Link>
        </div>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2.5 py-8 text-[15px] text-muted">
          <Spinner className="size-5" />
          {t('tgAuth.magicProgress')}
        </p>
      )}
    </AuthShell>
  );
}
