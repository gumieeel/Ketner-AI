import { useEffect } from 'react';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { useAuthNotice, type AuthNotice } from '@/features/auth/auth-notice';
import { useTranslation, type TranslationKey } from '@/i18n';

const NOTICE_TEXT: Record<AuthNotice, TranslationKey> = {
  'signed-up': 'auth.noticeSignedUp',
  'logged-in': 'auth.noticeLoggedIn',
  'password-reset': 'auth.noticePasswordReset',
};

/** «Регистрация завершена» / «Вы вошли» / «Пароль изменён» после кода из письма или нового пароля. */
export function AuthNoticeToast() {
  const { t } = useTranslation();
  const notice = useAuthNotice((state) => state.notice);
  const dismiss = useAuthNotice((state) => state.dismiss);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[var(--z-toast)] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md animate-scale-in items-start gap-3 rounded-lg border border-accent/40 bg-surface-2 px-4 py-3 text-[14px] shadow-popover"
      >
        <span className="mt-0.5 shrink-0 text-accent">
          <CheckIcon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 leading-5 text-text">{t(NOTICE_TEXT[notice])}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('common.close')}
          className="-m-1.5 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-text"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
