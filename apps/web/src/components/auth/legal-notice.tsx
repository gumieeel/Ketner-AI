import { Link } from 'react-router-dom';
import { useTranslation } from '@/i18n';

/** Подпись под формами входа и регистрации со ссылками на условия и политику. */
export function LegalNotice() {
  const { t } = useTranslation();
  const link = 'underline underline-offset-4 hover:text-text';
  return (
    <p className="text-balance text-center text-xs leading-5 text-muted">
      {t('auth.legalPrefix')}{' '}
      <Link to="/terms" className={link}>
        {t('auth.legalTerms')}
      </Link>
      ,{' '}
      <Link to="/payment-terms" className={link}>
        {t('auth.legalPayment')}
      </Link>{' '}
      {t('auth.legalAnd')}{' '}
      <Link to="/privacy" className={link}>
        {t('auth.legalPrivacy')}
      </Link>
      .
    </p>
  );
}
