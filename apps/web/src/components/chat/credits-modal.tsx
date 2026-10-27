import { Link, useNavigate } from 'react-router-dom';
import { CloseIcon, CreditsIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/auth-store';
import { useCreditsModal } from '@/features/billing/credits-modal-store';
import { CRYPTO_BONUS_RATE, PACKS, PACK_VALID_DAYS } from '@/features/billing/plans';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatCredits, pluralForm } from '@/lib/format-date';

/** Пакеты, которые предлагает окно: три первых, остальные — на странице «Кредиты». */
const OFFERED_PACKS = PACKS.slice(0, 3);

/**
 * Окно покупки кредитов. Появляется, когда исчерпан лимит бесплатного доступа: выбор пакета
 * ведёт сразу к оплате, полный список — на странице «Кредиты».
 */
export function CreditsModal() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const isOpen = useCreditsModal((state) => state.isOpen);
  const close = useCreditsModal((state) => state.close);
  const user = useAuth((state) => state.user);

  if (!isOpen) return null;

  const choosePack = (packId: string): void => {
    close();
    const target = `/checkout/${packId}`;
    navigate(user ? target : `/signup?redirect=${encodeURIComponent(target)}`);
  };

  const plural = (base: 'pricing.credits' | 'pricing.requests', count: number): string =>
    t(`${base}.${pluralForm(count, language)}` as TranslationKey, {
      count: formatCredits(count, language),
    });

  return (
    <Modal labelledBy="credits-modal-title" onClose={close} size="md" className="p-6 sm:p-7">
      <div
        aria-hidden="true"
        className="bg-brand-soft pointer-events-none absolute -top-24 -left-16 size-72 rounded-full opacity-70 blur-3xl"
      />

      <IconButton
        label={t('chat.close')}
        size="sm"
        onClick={close}
        className="absolute top-3 right-3 z-10"
      >
        <CloseIcon className="size-4" />
      </IconButton>

      <div className="relative min-h-0 overflow-y-auto">
        <div className="mb-5 pr-8">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            <CreditsIcon className="size-3.5" aria-hidden="true" />
            <span>{t('creditsModal.badge')}</span>
          </div>
          <h2 id="credits-modal-title" className="text-xl font-semibold tracking-tight text-text">
            {t('creditsModal.title')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t('creditsModal.desc', { days: PACK_VALID_DAYS })}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {OFFERED_PACKS.map((pack) => {
            const example = pack.examples.find((item) => item.model === 'gpt-6.1-sol');
            return (
              <button
                key={pack.id}
                type="button"
                data-testid={`modal-pack-${pack.id}`}
                onClick={() => choosePack(pack.id)}
                className="lift group flex min-h-14 flex-col justify-between gap-2 rounded-xl border border-stroke bg-canvas p-3.5 text-left hover:border-accent/40 hover:bg-surface-2 sm:min-h-[112px]"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="tabular text-lg font-semibold text-text">${pack.priceUsd}</span>
                  {pack.discountPct > 0 ? <Badge tone="success">−{pack.discountPct}%</Badge> : null}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text transition-colors group-hover:text-accent">
                    {plural('pricing.credits', pack.credits)}
                  </span>
                  {example ? (
                    <span className="text-xs text-muted">
                      {t('pricing.creditsExample', {
                        requests: plural('pricing.requests', example.requests),
                        model: example.name,
                      })}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:items-center">
          <Link
            to="/pricing"
            onClick={close}
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              className: 'w-full sm:flex-1',
            })}
          >
            <span>{t('creditsModal.allPacks')}</span>
            <span aria-hidden="true">→</span>
          </Link>
          <button
            type="button"
            onClick={close}
            className={buttonClasses({
              variant: 'outline',
              size: 'lg',
              className: 'w-full sm:w-auto',
            })}
          >
            {t('chat.close')}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-subtle">
          {t('creditsModal.payMethods', { bonus: Math.round(CRYPTO_BONUS_RATE * 100) })}
        </p>
      </div>
    </Modal>
  );
}
