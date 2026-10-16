import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { CloseIcon } from '@/components/icons';
import { ApiError, miniAppApi, type MiniAppState } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { formatStars, useMiniApp } from './shared';

/**
 * ВРЕМЕННО, для проверки: окно подтверждения покупки, повторяющее окно оплаты звёздами Telegram
 * (цвета темы Telegram, разлетающиеся звёзды), но звёзды списываются с тестового баланса
 * (сервер: POST /telegram/miniapp/test-pay). Стили — `.tg-pay-*` в index.css.
 */
export interface TestInvoice {
  invoiceId: string;
  stars: number;
  title: string;
  balance: number;
}

/** Имя бота-продавца, как его показывает Telegram в окне оплаты. */
const SELLER = 'Ketner_Kassa';

/** Псевдослучайные, но одинаковые при каждом показе числа — чтобы звёзды не прыгали при рендере. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

interface Particle {
  dx: number;
  dy: number;
  size: number;
  duration: number;
  delay: number;
  rotate: number;
  scale: number;
}

/** Звёзды, вылетающие из-за значка: в стороны шире, чем вверх и вниз — как в Telegram. */
const PARTICLES: Particle[] = (() => {
  const random = seeded(20261016);
  const count = 22;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const distance = 0.75 + random() * 0.35;
    const duration = 2.2 + random() * 1.6;
    return {
      dx: Math.cos(angle) * 125 * distance,
      dy: Math.sin(angle) * 50 * distance,
      size: 6 + random() * 8,
      duration,
      delay: -random() * duration,
      rotate: (random() - 0.5) * 140,
      scale: 0.8 + random() * 0.5,
    };
  });
})();

/** Звёзды, которые видны всегда (и при «уменьшить движение»): x, y в процентах, размер, поворот. */
const STATIC_STARS: Array<[number, number, number, number]> = [
  [22, 36, 11, -12],
  [14, 64, 8, 18],
  [28, 70, 13, 8],
  [70, 22, 12, 14],
  [76, 66, 13, -8],
  [86, 40, 8, 22],
  [65, 80, 7, -16],
];

function GoldStar({
  size,
  className,
  style,
}: {
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE07A" />
          <stop offset="0.55" stopColor="#FDC53A" />
          <stop offset="1" stopColor="#F29E1B" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 1.8c.5 0 .95.29 1.17.74l2.5 5.2 5.66.78c.5.07.93.42 1.08.9.16.48.03 1.02-.34 1.37l-4.12 3.97 1 5.63c.09.5-.11 1-.52 1.3a1.3 1.3 0 0 1-1.37.1L12 19.13l-5.06 2.66c-.44.23-.97.19-1.37-.1-.41-.3-.61-.8-.52-1.3l1-5.63-4.12-3.97a1.32 1.32 0 0 1-.34-1.37c.15-.48.58-.83 1.08-.9l5.66-.78 2.5-5.2c.22-.45.67-.74 1.17-.74Z"
      />
    </svg>
  );
}

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
    if (invoice.balance < invoice.stars) {
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
      className="tg-pay-backdrop fixed inset-0 z-[var(--z-modal)] grid place-items-center px-6"
      onClick={() => (busy ? undefined : onClose())}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onClick={(event) => event.stopPropagation()}
        className="tg-pay-card relative w-full max-w-[320px] overflow-hidden px-4 pt-3.5 pb-5 text-center"
      >
        <div className="absolute top-3.5 left-4 z-10 text-left">
          <p className="text-[13px] leading-[17px]">{t('tg.testPayBalance')}</p>
          <p className="flex items-center gap-1 text-[14px] leading-[18px] font-semibold tabular-nums">
            <GoldStar size={15} />
            {formatStars(invoice.balance, language)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('tg.close')}
          className="tg-pay-close absolute top-2 right-2 z-10 grid size-10 place-items-center disabled:opacity-50"
        >
          <CloseIcon className="size-[18px]" />
        </button>

        <div className="relative mx-auto mt-3 h-[112px] w-full" aria-hidden="true">
          {STATIC_STARS.map(([x, y, size, rotate], index) => (
            <GoldStar
              key={`s${index}`}
              size={size}
              className="tg-pay-star-static"
              style={{ left: `${x}%`, top: `${y}%`, '--rot': `${rotate}deg` } as CSSProperties}
            />
          ))}
          {PARTICLES.map((particle, index) => (
            <GoldStar
              key={`p${index}`}
              size={particle.size}
              className="tg-pay-star"
              style={
                {
                  '--dx': `${particle.dx.toFixed(1)}px`,
                  '--dy': `${particle.dy.toFixed(1)}px`,
                  '--dur': `${particle.duration.toFixed(2)}s`,
                  '--delay': `${particle.delay.toFixed(2)}s`,
                  '--rot': `${particle.rotate.toFixed(0)}deg`,
                  '--scale': particle.scale.toFixed(2),
                } as CSSProperties
              }
            />
          ))}
          <div className="absolute top-1/2 left-1/2 z-[1] grid size-[80px] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full bg-black">
            <img src="/logo-mark-160.png" alt="" className="size-[42px]" />
          </div>
        </div>

        <h2 id={titleId} className="mt-3 text-[19px] leading-6 font-semibold">
          {t('tg.testPayTitle')}
        </h2>
        <p id={textId} className="mx-auto mt-2 max-w-[280px] text-[14px] leading-5">
          {t('tg.testPayLead')} <b className="font-semibold">«{invoice.title}»</b>{' '}
          {t('tg.testPayFrom')} <b className="font-semibold">{SELLER}</b> {t('tg.testPayFor')}{' '}
          <b className="font-semibold">{t('tg.testPayStars', { stars })}</b>?
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-5 text-[#ec3942]">
            {error}
          </p>
        ) : null}

        <button
          ref={confirmRef}
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="tg-pay-button mt-5 flex min-h-11 w-full flex-wrap items-center justify-center gap-x-1 px-1 py-2 text-[14px] font-medium transition-[filter] disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tg-theme-button-color,#2f6ea5)]"
        >
          {busy ? (
            t('tg.testPayBusy')
          ) : (
            <>
              <span className="whitespace-nowrap">{t('tg.testPayConfirm')}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                <svg
                  viewBox="0 0 24 24"
                  className="size-[17px] shrink-0"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 1.8c.5 0 .95.29 1.17.74l2.5 5.2 5.66.78c.5.07.93.42 1.08.9.16.48.03 1.02-.34 1.37l-4.12 3.97 1 5.63c.09.5-.11 1-.52 1.3a1.3 1.3 0 0 1-1.37.1L12 19.13l-5.06 2.66c-.44.23-.97.19-1.37-.1-.41-.3-.61-.8-.52-1.3l1-5.63-4.12-3.97a1.32 1.32 0 0 1-.34-1.37c.15-.48.58-.83 1.08-.9l5.66-.78 2.5-5.2c.22-.45.67-.74 1.17-.74Z" />
                </svg>
                {t('tg.testPayStars', { stars })}
              </span>
            </>
          )}
        </button>
        <p className="tg-pay-hint mt-3 text-[12px] leading-4">{t('tg.testPayNote')}</p>
      </div>
    </div>
  );
}
