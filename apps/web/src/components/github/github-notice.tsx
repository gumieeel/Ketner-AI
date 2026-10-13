import { useEffect } from 'react';
import { CheckIcon, CloseIcon, GitHubIcon } from '@/components/icons';
import { useGithub } from '@/features/github/github-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Короткое уведомление после возврата с GitHub: подключено, отменено или не получилось. */
export function GithubNoticeToast() {
  const { t } = useTranslation();
  const notice = useGithub((state) => state.notice);
  const dismiss = useGithub((state) => state.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, notice.kind === 'connected' ? 5000 : 9000);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  const ok = notice.kind === 'connected';
  const text =
    notice.kind === 'connected'
      ? t('github.noticeConnected', { login: notice.login })
      : notice.kind === 'denied'
        ? t('github.noticeDenied')
        : notice.message || t('github.noticeFailed');

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[var(--z-toast)] flex justify-center px-4">
      <div
        role={ok ? 'status' : 'alert'}
        className={cn(
          'pointer-events-auto flex max-w-md animate-scale-in items-start gap-3 rounded-lg border bg-surface-2 px-4 py-3 text-[14px] shadow-popover',
          ok ? 'border-accent/40' : 'border-danger/40',
        )}
      >
        <span className={cn('mt-0.5 shrink-0', ok ? 'text-accent' : 'text-danger')}>
          {ok ? <CheckIcon className="size-4" /> : <GitHubIcon className="size-4" />}
        </span>
        <p className="min-w-0 flex-1 leading-5 text-text">{text}</p>
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
