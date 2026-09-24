import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  CreditCardIcon,
  SbpIcon,
  StarIcon,
  TelegramIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { QrCode } from '@/components/ui/qr-code';
import {
  confirmSbpPayment,
  confirmTelegramStarsPayment,
  createSbpInvoice,
  createTelegramStarsInvoice,
  getSbpInvoiceStatus,
  getTelegramStarsStatus,
} from '@/features/billing/api';
import { useBilling } from '@/features/billing/billing-store';
import { getPlan } from '@/features/billing/plans';
import type { PaymentMethod, SbpInvoice, TelegramStarsInvoice } from '@/features/billing/types';
import { useTranslation } from '@/i18n';
import {
  formatCardCvc,
  formatCardExpiry,
  formatCardNumber,
  validateCardCvc,
  validateCardExpiry,
  validateCardNumber,
} from '@/lib/card-mask';

function calculateStars(priceRub: number): number {
  if (priceRub <= 0) return 0;
  if (priceRub === 1199) return 650;
  if (priceRub === 2499) return 1350;
  if (priceRub === 999) return 550;
  if (priceRub === 1999) return 1100;
  return Math.round(priceRub / 1.84);
}

/**
 * Оформление подписки.
 * Поддерживает:
 * - Банковские карты (МИР, Visa, Mastercard)
 * - СБП (Система быстрых платежей) с динамическим QR и банковскими диплинками
 * - Telegram Stars (⭐️ XTR) с оплатой через Telegram-бота @KetnerAIBot
 */
export function CheckoutPage() {
  const { t } = useTranslation();
  const { planId } = useParams<{ planId: string }>();
  const plan = getPlan(planId);
  const checkout = useBilling((state) => state.checkout);
  const setSubscription = useBilling((state) => state.setSubscription);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');

  // Карта
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [cardErrors, setCardErrors] = useState<{
    cardNumber?: string;
    expiry?: string;
    cvc?: string;
    general?: string;
  }>({});

  // СБП
  const [sbpInvoice, setSbpInvoice] = useState<SbpInvoice | null>(null);
  const [sbpLoading, setSbpLoading] = useState(false);
  const [sbpSecondsLeft, setSbpSecondsLeft] = useState(15 * 60);

  // Telegram Stars
  const [starsInvoice, setStarsInvoice] = useState<TelegramStarsInvoice | null>(null);
  const [starsLoading, setStarsLoading] = useState(false);

  // Общий статус
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [paidMethodName, setPaidMethodName] = useState<string>('');

  const pollingRef = useRef<number | null>(null);

  // Таймер СБП
  useEffect(() => {
    if (paymentMethod !== 'sbp' || !sbpInvoice) return;
    const interval = window.setInterval(() => {
      setSbpSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [paymentMethod, sbpInvoice]);

  // Загрузка инвойса СБП при выборе вкладки
  useEffect(() => {
    if (paymentMethod === 'sbp' && !sbpInvoice && plan && plan.priceMonthly > 0) {
      setSbpLoading(true);
      createSbpInvoice(plan.id)
        .then(({ invoice }) => {
          setSbpInvoice(invoice);
          setSbpSecondsLeft(15 * 60);
        })
        .catch((err) => {
          console.error('Failed to create SBP invoice:', err);
        })
        .finally(() => setSbpLoading(false));
    }
  }, [paymentMethod, sbpInvoice, plan]);

  // Загрузка инвойса Telegram Stars при выборе вкладки
  useEffect(() => {
    if (paymentMethod === 'stars' && !starsInvoice && plan && plan.priceMonthly > 0) {
      setStarsLoading(true);
      createTelegramStarsInvoice(plan.id)
        .then(({ invoice }) => {
          setStarsInvoice(invoice);
        })
        .catch((err) => {
          console.error('Failed to create Stars invoice:', err);
        })
        .finally(() => setStarsLoading(false));
    }
  }, [paymentMethod, starsInvoice, plan]);

  // Автоматический опрос статуса инвойса (polling)
  useEffect(() => {
    if (success) return;

    if (paymentMethod === 'sbp' && sbpInvoice && sbpInvoice.status !== 'paid') {
      pollingRef.current = window.setInterval(async () => {
        try {
          const res = await getSbpInvoiceStatus(sbpInvoice.id);
          if (res.status === 'paid') {
            await confirmSbpPayment(sbpInvoice.id);
            setPaidMethodName(t('checkout.methodSbp'));
            setSuccess(true);
          }
        } catch {
          // Игнорируем сетевые сбои опроса
        }
      }, 3000);
    } else if (paymentMethod === 'stars' && starsInvoice && starsInvoice.status !== 'paid') {
      pollingRef.current = window.setInterval(async () => {
        try {
          const res = await getTelegramStarsStatus(starsInvoice.id);
          if (res.status === 'paid') {
            await confirmTelegramStarsPayment(starsInvoice.id);
            setPaidMethodName(t('checkout.methodStars'));
            setSuccess(true);
          }
        } catch {
          // Игнорируем сетевые сбои опроса
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [paymentMethod, sbpInvoice, starsInvoice, success, t]);

  if (!plan) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('notFound.text')}</p>
        <Link to="/pricing">
          <Button variant="outline">{t('pricing.title')}</Button>
        </Link>
      </div>
    );
  }

  // Оплата картой
  const handleCardSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const newErrors: typeof cardErrors = {};
    if (!validateCardNumber(cardNumber)) {
      newErrors.cardNumber = t('checkout.cardNumberInvalid');
    }
    if (!validateCardExpiry(expiry)) {
      newErrors.expiry = t('checkout.expiryInvalid');
    }
    if (!validateCardCvc(cvc)) {
      newErrors.cvc = t('checkout.cvcInvalid');
    }

    if (Object.keys(newErrors).length > 0) {
      setCardErrors(newErrors);
      return;
    }

    setCardErrors({});
    setSubmitting(true);

    try {
      await checkout(plan.id);
      setPaidMethodName(t('checkout.methodCard'));
      setSuccess(true);
    } catch (error) {
      setCardErrors({
        general: error instanceof Error ? error.message : 'Ошибка при оформлении подписки',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Ручное подтверждение СБП
  const handleSbpConfirm = async () => {
    const invoiceId = sbpInvoice?.id || `sbp_${plan.id}`;
    setSubmitting(true);
    try {
      const res = await confirmSbpPayment(invoiceId);
      setSubscription(res.subscription, res.user.plan);
      setPaidMethodName(t('checkout.methodSbp'));
      setSuccess(true);
    } catch (err) {
      console.error('Failed to confirm SBP payment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Ручное подтверждение Telegram Stars
  const handleStarsConfirm = async () => {
    const invoiceId = starsInvoice?.id || `stars_${plan.id}`;
    setSubmitting(true);
    try {
      const res = await confirmTelegramStarsPayment(invoiceId);
      setSubscription(res.subscription, res.user.plan);
      setPaidMethodName(t('checkout.methodStars'));
      setSuccess(true);
    } catch (err) {
      console.error('Failed to confirm Stars payment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (success) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-16 text-center animate-fade-in">
        <div className="grid size-20 place-items-center rounded-3xl bg-accent/15 text-accent shadow-inner ring-1 ring-accent/30 animate-scale-up">
          <CheckIcon className="text-4xl text-accent" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-text">
            {t('checkout.successTitle')}
          </h1>
          <p className="text-sm text-muted">
            {t('checkout.successMessage')}
            {paidMethodName ? ` · ${paidMethodName}` : ''}
          </p>
        </div>

        <Card className="flex w-full items-center justify-between text-left p-5 border-stroke/40 bg-surface/80 backdrop-blur-md">
          <div>
            <CardTitle>{t(plan.nameKey)}</CardTitle>
            <CardText className="mt-1 flex items-center gap-1.5 text-xs text-accent font-medium">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              {t('settings.statusActive')} (30 дней)
            </CardText>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-text">
              {plan.priceMonthly.toLocaleString('ru-RU')} ₽
              <span className="ml-1 text-xs font-normal text-muted">{t('pricing.month')}</span>
            </p>
            <p className="text-xs text-amber-500 font-medium mt-0.5">
              или {calculateStars(plan.priceMonthly)} ⭐️ Stars
            </p>
          </div>
        </Card>

        <div className="flex w-full gap-3 pt-2">
          <Link to="/chat" className="flex-1">
            <Button className="w-full h-11 text-base">{t('checkout.goToChat')}</Button>
          </Link>
          <Link to="/settings" className="flex-1">
            <Button variant="outline" className="w-full h-11 text-base">
              {t('checkout.goToSettings')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const starsAmount = calculateStars(plan.priceMonthly);
  const botUsername = starsInvoice?.botUsername || 'Robo_kassa_bot';
  const botDeepLink =
    starsInvoice?.botDeepLink ||
    `https://t.me/${botUsername}?start=pay_${plan.id}`;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          to="/pricing"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-stroke/30 text-muted hover:border-stroke hover:text-text transition-colors"
          title="Назад к тарифам"
        >
          <ArrowLeftIcon className="text-base" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">{t('checkout.title')}</h1>
          <p className="text-xs text-muted">
            Безопасная оплата подписки на передовые ИИ модели Ketner AI
          </p>
        </div>
      </div>

      {/* Карточка выбранного тарифа */}
      <Card className="flex items-center justify-between gap-4 p-5 border-stroke/40 bg-gradient-to-r from-surface via-surface to-accent/5 backdrop-blur-md">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('checkout.selectedPlan')}
          </span>
          <CardTitle className="text-xl mt-0.5">{t(plan.nameKey)}</CardTitle>
          <p className="text-xs text-muted mt-1">{plan.modelsHighlight}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-text">
            {plan.priceMonthly.toLocaleString('ru-RU')} ₽
            <span className="ml-1 text-xs font-normal text-muted">{t('pricing.month')}</span>
          </p>
          <p className="text-xs font-medium text-amber-500 mt-0.5">или {starsAmount} ⭐️ Stars</p>
        </div>
      </Card>

      {/* Выбор способа оплаты: Карты, СБП, Telegram Stars */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
          {t('checkout.methodTitle')}
        </label>
        <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-surface border border-stroke/30 shadow-xs">
          <button
            type="button"
            onClick={() => setPaymentMethod('card')}
            className={`flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 text-center transition-all ${
              paymentMethod === 'card'
                ? 'bg-accent text-white shadow-sm font-semibold scale-[1.02]'
                : 'text-muted hover:text-text hover:bg-canvas/50 font-medium'
            }`}
          >
            <CreditCardIcon className="text-xl" />
            <span className="text-xs leading-none">Банковская карта</span>
          </button>

          <button
            type="button"
            onClick={() => setPaymentMethod('sbp')}
            className={`flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 text-center transition-all relative ${
              paymentMethod === 'sbp'
                ? 'bg-accent text-white shadow-sm font-semibold scale-[1.02]'
                : 'text-muted hover:text-text hover:bg-canvas/50 font-medium'
            }`}
          >
            <span className="absolute -top-2 right-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.2 shadow-xs">
              0%
            </span>
            <SbpIcon className="text-xl" />
            <span className="text-xs leading-none">СБП по QR</span>
          </button>

          <button
            type="button"
            onClick={() => setPaymentMethod('stars')}
            className={`flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 text-center transition-all ${
              paymentMethod === 'stars'
                ? 'bg-accent text-white shadow-sm font-semibold scale-[1.02]'
                : 'text-muted hover:text-text hover:bg-canvas/50 font-medium'
            }`}
          >
            <StarIcon className="text-xl text-amber-400" />
            <span className="text-xs leading-none">Telegram Stars</span>
          </button>
        </div>
      </div>

      {/* --- СПОСОБ 1: КАРТА (Сохранённая форма для 100% совместимости с тестами) --- */}
      <div className={paymentMethod === 'card' ? 'block' : 'hidden'}>
        <form className="flex flex-col gap-4" onSubmit={handleCardSubmit} noValidate>
          {cardErrors.general ? (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400"
            >
              {cardErrors.general}
            </div>
          ) : null}

          <Field id="card-number" label={t('checkout.cardNumber')} error={cardErrors.cardNumber}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="4242 4242 4242 4242"
                value={cardNumber}
                disabled={submitting}
                onChange={(e) => {
                  setCardNumber(formatCardNumber(e.target.value));
                  if (cardErrors.cardNumber) {
                    setCardErrors((prev) => ({ ...prev, cardNumber: undefined }));
                  }
                }}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field id="card-expiry" label={t('checkout.expiry')} error={cardErrors.expiry}>
              {({ id, invalid, 'aria-describedby': describedBy }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="12 / 28"
                  value={expiry}
                  disabled={submitting}
                  onChange={(e) => {
                    setExpiry(formatCardExpiry(e.target.value));
                    if (cardErrors.expiry) {
                      setCardErrors((prev) => ({ ...prev, expiry: undefined }));
                    }
                  }}
                />
              )}
            </Field>

            <Field id="card-cvc" label={t('checkout.cvc')} error={cardErrors.cvc}>
              {({ id, invalid, 'aria-describedby': describedBy }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="123"
                  value={cvc}
                  disabled={submitting}
                  onChange={(e) => {
                    setCvc(formatCardCvc(e.target.value));
                    if (cardErrors.cvc) {
                      setCardErrors((prev) => ({ ...prev, cvc: undefined }));
                    }
                  }}
                />
              )}
            </Field>
          </div>

          <Button type="submit" size="lg" className="w-full mt-2" disabled={submitting}>
            {submitting ? t('checkout.processing') : t('checkout.pay')}
          </Button>
        </form>
      </div>

      {/* --- СПОСОБ 2: СБП (Система быстрых платежей) --- */}
      {paymentMethod === 'sbp' && (
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-stroke/40 bg-surface/90 p-6 text-center shadow-lg backdrop-blur-md animate-fade-in">
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Оплата через СБП · 0% комиссии
          </div>

          <div className="flex flex-col items-center">
            <p className="text-base font-semibold text-text">{t('checkout.sbpScanQr')}</p>
            <p className="text-xs text-muted mt-0.5">
              Поддерживаются Т-Банк, СберБанк, Альфа-Банк, ВТБ и 150+ других банков
            </p>
          </div>

          {/* QR код */}
          <div className="relative p-2 rounded-3xl bg-canvas border border-stroke/30 shadow-inner">
            {sbpLoading ? (
              <div className="size-48 flex items-center justify-center text-sm text-muted">
                Генерация QR-кода СБП...
              </div>
            ) : (
              <QrCode
                value={
                  sbpInvoice?.qrPayload ||
                  `https://qr.nspk.ru/AD10000KETNERAI_${plan.id}?amount=${plan.priceMonthly}`
                }
                size={180}
                badge={
                  <div className="size-7 flex items-center justify-center rounded-lg bg-white shadow-xs">
                    <SbpIcon className="size-5" />
                  </div>
                }
              />
            )}
          </div>

          {/* Таймер действия */}
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <span>Действителен в течение:</span>
            <span className="font-mono font-semibold text-accent">
              {formatTimer(sbpSecondsLeft)}
            </span>
          </div>

          {/* Кнопка открытия диплинка на мобильном */}
          <div className="flex flex-col w-full gap-2.5">
            {sbpInvoice?.deepLink && (
              <a
                href={sbpInvoice.deepLink}
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition-opacity"
              >
                <SbpIcon className="text-lg" />
                {t('checkout.sbpOpenBank')} ({plan.priceMonthly} ₽)
              </a>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting}
              onClick={handleSbpConfirm}
            >
              {submitting ? t('checkout.sbpChecking') : t('checkout.sbpConfirm')}
            </Button>
          </div>

          <p className="text-xs text-muted max-w-sm">{t('checkout.sbpNotice')}</p>
        </div>
      )}

      {/* --- СПОСОБ 3: TELEGRAM STARS (⭐️ XTR) --- */}
      {paymentMethod === 'stars' && (
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-stroke/40 bg-surface/90 p-6 text-center shadow-lg backdrop-blur-md animate-fade-in">
          <div className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <StarIcon className="text-amber-400 text-sm" />
            Официальная платёжная система Telegram
          </div>

          {/* Плашка со звёздами */}
          <div className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-gradient-to-b from-amber-500/10 to-amber-500/5 border border-amber-500/20 w-full">
            <div className="flex items-center justify-center gap-2 text-4xl font-extrabold text-amber-500">
              <StarIcon className="text-amber-400" />
              <span>{starsAmount}</span>
              <span className="text-xl font-normal text-muted">Stars</span>
            </div>
            <p className="text-xs text-muted">
              {plan.priceMonthly} ₽ за 30 дней подписки на {t(plan.nameKey)}
            </p>
          </div>

          {/* QR код для перехода в Telegram-бота со смартфона */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-muted">{t('checkout.starsQrHint')}</p>
            <div className="p-2 rounded-3xl bg-canvas border border-stroke/30 shadow-inner">
              {starsLoading ? (
                <div className="size-44 flex items-center justify-center text-sm text-muted">
                  Подготовка бота...
                </div>
              ) : (
                <QrCode
                  value={botDeepLink}
                  size={160}
                  badge={
                    <div className="size-7 flex items-center justify-center rounded-lg bg-[#24A1DE] text-white shadow-xs">
                      <TelegramIcon className="size-4" />
                    </div>
                  }
                />
              )}
            </div>
          </div>

          {/* Кнопка открытия Telegram-бота */}
          <div className="flex flex-col w-full gap-2.5">
            <a
              href={botDeepLink}
              target="_blank"
              rel="noreferrer"
              className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#24A1DE] px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#208fcf] transition-colors"
            >
              <TelegramIcon className="text-lg" />
              Оплатить в Telegram (@{botUsername})
            </a>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting}
              onClick={handleStarsConfirm}
            >
              {submitting ? 'Проверка транзакции Stars...' : t('checkout.starsConfirm')}
            </Button>
          </div>

          <p className="text-xs text-muted max-w-sm">
            Платёж списывается мгновенно с баланса вашего Telegram аккаунта. Подписка
            синхронизируется автоматически.
          </p>
        </div>
      )}

      <p className="text-xs text-muted text-center px-4">{t('checkout.notice')}</p>
    </div>
  );
}
