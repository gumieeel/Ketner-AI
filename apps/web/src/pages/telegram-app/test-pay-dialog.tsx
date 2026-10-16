import { useEffect, useId, useRef, useState } from 'react';
import { CloseIcon, StarIcon } from '@/components/icons';
import { ApiError, miniAppApi, type MiniAppState } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { formatStars, useMiniApp } from './shared';

/**
 * ВРЕМЕННО, для проверки: окно подтверждения покупки в том же виде, что окно оплаты Telegram,
 * но звёзды списываются с тестового баланса (сервер: POST /telegram/miniapp/test-pay).
 */
export interface TestInvoice {
  invoiceId: string;
  stars: number;
  title: string;
  balance: number;
}

/** Звёзды вокруг значка — как в окне Telegram. Координаты в процентах от блока 260×110. */
const SPARKLES: Array<[number, number, number, number]> = [
  [8, 30, 14, 0.9],
  [16, 58, 18, 1],
  [27, 78, 12, 0.8],
  [32, 40, 16, 1],
  [12, 82, 9, 0.6],
  [68, 36, 16, 1],
  [73, 12, 12, 0.8],
  [78, 60, 18, 1],
  [84, 28, 10, 0.7],
  [88, 76, 14, 0.9],
  [93, 46, 9, 0.6],
  [64, 70, 10, 0.7],
  [36, 92, 8, 0.5],
];

export function TestPayDialog({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: TestInvoice;
  onClose: () => void;
  onPaid: (state: MiniAppState) => void;
}) {
  const { t, language } = useTranslation();
  const { app, token } = useMiniApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stars = formatStars(invoice.stars, language);
  const enough = invoice.balance >= invoice.stars;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, []);

  const confirm = async () => {
    if (!enough) {
      haptic.error(app);
      setError(t('tg.testPayNotEnough'));
      return;
    }
    haptic.tap(app);
    setBusy(true);
    setError(null);
    try {
      const next = await miniAppApi.testPay(token, invoice.invoiceId);
      haptic.success(app);
      onPaid(next);
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/60 px-4 animate-fade-in"
      onClick={() => (busy ? undefined : onClose())}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-[340px] rounded-2xl border border-stroke bg-surface px-5 pt-4 pb-5 text-center shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div className="text-left">
            <p className="text-[13px] leading-4 text-text">{t('tg.testPayBalance')}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold tabular-nums">
              <StarIcon className="size-3.5 fill-[#f6b93b] text-[#f6b93b]" aria-hidden />
              {formatStars(invoice.balance, language)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('tg.close')}
            className="-mt-1 -mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="relative mx-auto -mt-6 h-[110px] w-full max-w-[260px]" aria-hidden>
          {SPARKLES.map(([x, y, size, opacity], index) => (
            <StarIcon
              key={index}
              className="absolute fill-[#f6b93b] text-[#f6b93b]"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: size,
                height: size,
                opacity,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
          <div className="absolute top-1/2 left-1/2 grid size-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black">
            <img src="/logo-mark-160.png" alt="" className="size-10" />
          </div>
        </div>

        <h2 id={titleId} className="mt-2 text-[19px] font-semibold">
          {t('tg.testPayTitle')}
        </h2>
        <p id={textId} className="mt-1.5 text-[14px] leading-5 text-text">
          {t('tg.testPayText', { title: invoice.title, stars })}
        </p>

        {error ? <p className="mt-3 text-[13px] leading-5 text-danger">{error}</p> : null}

        <button
          ref={confirmRef}
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="mt-5 flex min-h-12 w-full items-center justify-center flex-wrap gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ backgroundColor: 'var(--tg-theme-button-color, #2f6ea5)' }}
        >
          {busy ? (
            t('tg.testPayBusy')
          ) : (
            <>
              <span className="whitespace-nowrap">{t('tg.testPayConfirm')}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                <StarIcon className="size-4 shrink-0 fill-white text-white" aria-hidden />
                {t('tg.testPayStars', { stars })}
              </span>
            </>
          )}
        </button>
        <p className="mt-3 text-[12px] leading-4 text-subtle">{t('tg.testPayNote')}</p>
      </div>
    </div>
  );
}
