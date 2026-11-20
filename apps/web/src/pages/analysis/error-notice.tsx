import { Link } from 'react-router-dom';
import { DiscoveryApiError } from '@/features/discovery/api';
import { useTranslation } from '@/i18n';
import { AllowanceLine } from '@/pages/solutions/allowance-line';

/**
 * Понятный отказ API анализа: что случилось и что можно сделать (войти). Текст сервера
 * используется, когда он есть: сервер знает точную причину. Бесплатный лимит исчерпан — под
 * отказом строка «Бесплатный лимит месяца: использовано N%».
 */
export function ErrorNotice({ error, redirect }: { error: unknown; redirect: string }) {
  const { t } = useTranslation();
  const apiError = error instanceof DiscoveryApiError ? error : null;
  const code = apiError?.code ?? 'unknown_error';

  let message = apiError?.message || t('analysis.error.generic');
  if (code === 'network_error') message = t('analysis.error.network');
  const loginHref = `/login?redirect=${encodeURIComponent(redirect)}`;

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[14px] leading-6 text-text"
    >
      <p>{message}</p>
      {code === 'build_allowance_exhausted' ? <AllowanceLine className="mt-1" /> : null}
      {code === 'login_required' ? (
        <Link
          to={loginHref}
          className="mt-1 inline-block font-medium text-text underline underline-offset-4"
        >
          {t('analysis.error.login')}
        </Link>
      ) : null}
    </div>
  );
}
