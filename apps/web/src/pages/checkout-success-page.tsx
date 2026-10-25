import { Link } from 'react-router-dom';
import { CheckIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { useTranslation } from '@/i18n';
import { useDocumentTitle } from '@/lib/use-document-title';

/**
 * Страница после успешной оплаты на сайте. Обычно на неё попадают прямо с экрана оплаты
 * (адрес меняется без перезагрузки), а при обновлении страницы показывается этот общий экран.
 */
export function CheckoutSuccessPage() {
  const { t } = useTranslation();
  useDocumentTitle(`${t('checkout.successTitle')} — Ketner AI`);
  return (
    <div className="mx-auto flex w-full max-w-lg animate-fade-in flex-col items-center gap-6 py-10 text-center md:py-16">
      <div className="grid size-20 place-items-center rounded-3xl border border-accent/40 bg-accent-soft text-accent shadow-glow">
        <CheckIcon className="size-10 text-accent" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-text md:text-3xl">
          {t('checkout.successTitle')}
        </h1>
        <p className="text-sm text-muted">{t('checkout.successMessage')}</p>
      </div>
      <div className="flex w-full flex-col gap-3 pt-2 sm:flex-row">
        <Link
          to="/chat"
          className={buttonClasses({ variant: 'primary', size: 'lg', className: 'flex-1' })}
        >
          {t('checkout.goToChat')}
        </Link>
        <Link
          to="/settings"
          className={buttonClasses({ variant: 'outline', size: 'lg', className: 'flex-1' })}
        >
          {t('checkout.goToSettings')}
        </Link>
      </div>
    </div>
  );
}
