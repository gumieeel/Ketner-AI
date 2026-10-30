import { Link } from 'react-router-dom';
import { DiscoveryApiError } from '@/features/discovery/api';
import { creditsText } from '@/features/discovery/format';
import { useTranslation } from '@/i18n';

/**
 * Понятный отказ API анализа: что случилось и что можно сделать (пополнить, войти). Текст
 * сервера используется, когда он есть: сервер знает точную причину и суммы.
 */
export function ErrorNotice({ error, redirect }: { error: unknown; redirect: string }) {
  const translator = useTranslation();
  const { t } = translator;
  const apiError = error instanceof DiscoveryApiError ? error : null;
  const code = apiError?.code ?? 'unknown_error';
  const details = apiError?.details ?? {};

  let message = apiError?.message || t('analysis.error.generic');
  if (code === 'network_error') message = t('analysis.error.network');
  if (
    code === 'insufficient_credits' &&
    typeof details.maxCredits === 'number' &&
    typeof details.balanceCredits === 'number'
  ) {
    message = t('analysis.error.insufficient', {
      max: creditsText(translator, details.maxCredits),
      balance: creditsText(translator, details.balanceCredits),
    });
  }
  const loginHref = `/login?redirect=${encodeURIComponent(redirect)}`;

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[14px] leading-6 text-text"
    >
      <p>{message}</p>
      {code === 'insufficient_credits' ? (
        <Link
          to="/pricing"
          className="mt-1 inline-block font-medium text-text underline underline-offset-4"
        >
          {t('analysis.error.topUp')}
        </Link>
      ) : null}
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
