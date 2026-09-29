import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import {
  ArrowLeftIcon,
  CheckIcon,
  CreditCardIcon,
  SbpIcon,
  ShieldIcon,
  StarIcon,
  TelegramIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/docs/callout';
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
import { cn } from '@/lib/cn';
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
  if (priceRub === 1199 || priceRub === 20 || priceRub === 29) return 650;
  if (priceRub === 2499 || priceRub === 39 || priceRub === 49) return 1350;
  if (priceRub === 999 || priceRub === 9) return 550;
  if (priceRub === 1999) return 1100;
  return Math.round(priceRub / 1.84);
}

export function CheckoutPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { planId } = useParams<{ planId: string }>();
  const authStatus = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const plan = getPlan(planId);
  const checkout = useBilling((state) => state.checkout);
  const setSubscription = useBilling((state) => state.setSubscription);

  useEffect(() => {
    if (authStatus !== 'loading' && (!user || authStatus === 'unauthenticated')) {
      const targetPlan = planId || 'gpt-pro';
      navigate(`/signup?redirect=${encodeURIComponent(`/checkout/${targetPlan}`)}`, { replace: true });
    }
  }, [authStatus, user, planId, navigate]);

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

  // Загрузка инвойса СБП
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

  // Загрузка инвойса Telegram Stars
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

  // Polling статуса инвойса
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
          // ignore network polling errors
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
          // ignore network polling errors
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [paymentMethod, sbpInvoice, starsInvoice, success, t]);

  if (authStatus === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-lg items-center justify-center px-4 py-20 text-muted">
        <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-2" />
        <span>Загрузка...</span>
      </div>
    );
  }

  if (authStatus === 'unauthenticated' || !user) {
    return null;
  }

  if (!plan) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-text">{t('notFound.title')}</h1>
        <p className="text-sm text-muted">{t('notFound.text')}</p>
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

  // Подтверждение СБП
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

  // Подтверждение Telegram Stars
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
        <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 border border-stroke text-accent shadow-xs">
          <CheckIcon className="size-8 text-accent" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {t('checkout.successTitle')}
          </h1>
          <p className="text-sm text-muted">
            {t('checkout.successMessage')}
            {paidMethodName ? ` · ${paidMethodName}` : ''}
          </p>
        </div>

        <Card className="flex w-full items-center justify-between text-left p-5 border-stroke bg-surface">
          <div>
            <h2 className="text-lg font-semibold text-text">{t(plan.nameKey)}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-accent font-medium">
              <span className="size-2 rounded-full bg-accent" />
              {t('settings.statusActive')} (30 дней)
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-text">
              {plan.priceMonthly.toLocaleString('ru-RU')} ₽
              <span className="ml-1 text-xs font-normal text-muted">{t('pricing.month')}</span>
            </p>
            <p className="text-xs text-muted mt-0.5 font-mono">
              или {calculateStars(plan.priceMonthly)} Stars
            </p>
          </div>
        </Card>

        <div className="flex w-full gap-3 pt-2">
          <Link to="/chat" className="flex-1">
            <Button variant="primary" className="w-full h-10 text-sm">
              {t('checkout.goToChat')}
            </Button>
          </Link>
          <Link to="/settings" className="flex-1">
            <Button variant="outline" className="w-full h-10 text-sm">
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 animate-fade-in text-text">
      {/* Шапка страницы */}
      <div className="flex items-center gap-3 border-b border-stroke pb-6">
        <Link
          to="/pricing"
          className="inline-flex size-9 items-center justify-center rounded-lg border border-stroke text-muted hover:border-stroke-strong hover:text-text transition-colors"
          title="Назад к тарифам"
        >
          <ArrowLeftIcon className="text-sm" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {t('checkout.title')}
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Безопасная оплата подписки на передовые ИИ модели Ketner AI
          </p>
        </div>
      </div>

      {/* Двухколоночный макет: форма слева, сводка справа */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        {/* Левая колонка: шаги и форма оплаты */}
        <div className="flex flex-col gap-6">
          {/* Индикатор шагов */}
          <div className="flex items-center gap-3 text-xs font-mono border-b border-stroke pb-4">
            <div className="flex items-center gap-1.5 text-muted">
              <span className="grid size-5 place-items-center rounded-full bg-surface-2 border border-stroke text-[11px] font-semibold text-muted">
                01
              </span>
              <span>Выбор тарифа</span>
            </div>
            <span className="text-muted">/</span>
            <div className="flex items-center gap-1.5 text-accent font-semibold">
              <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-text text-[11px] font-semibold">
                02
              </span>
              <span className="text-text">Оплата</span>
            </div>
          </div>

          {/* Выбор способа оплаты */}
          <div className="flex flex-col gap-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
              {t('checkout.methodTitle')}
            </label>
            <div aria-label={t('checkout.methodTitle')} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                aria-pressed={paymentMethod === 'card'}
                onClick={() => setPaymentMethod('card')}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl p-3.5 border transition-all text-left',
                  paymentMethod === 'card'
                    ? 'border-accent bg-surface-2 shadow-xs'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/50',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <CreditCardIcon className="text-lg text-accent" />
                  <Badge tone="outline" className="text-[10px] py-0 px-1 font-mono">МИР / Visa</Badge>
                </div>
                <div>
                  <span className="text-xs font-semibold text-text block">Банковская карта</span>
                  <span className="text-[11px] text-muted block mt-0.5">МИР, Visa, MC</span>
                </div>
              </button>

              <button
                type="button"
                aria-pressed={paymentMethod === 'sbp'}
                onClick={() => setPaymentMethod('sbp')}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl p-3.5 border transition-all text-left relative',
                  paymentMethod === 'sbp'
                    ? 'border-accent bg-surface-2 shadow-xs'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/50',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <SbpIcon className="text-lg text-accent" />
                  <Badge tone="brand" className="text-[10px] py-0 px-1 font-mono">0%</Badge>
                </div>
                <div>
                  <span className="text-xs font-semibold text-text block">СБП по QR</span>
                  <span className="text-[11px] text-muted block mt-0.5">Без комиссии</span>
                </div>
              </button>

              <button
                type="button"
                aria-pressed={paymentMethod === 'stars'}
                onClick={() => setPaymentMethod('stars')}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-xl p-3.5 border transition-all text-left',
                  paymentMethod === 'stars'
                    ? 'border-accent bg-surface-2 shadow-xs'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/50',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <StarIcon className="text-lg text-accent" />
                  <Badge tone="neutral" className="text-[10px] py-0 px-1 font-mono">Telegram</Badge>
                </div>
                <div>
                  <span className="text-xs font-semibold text-text block">Telegram Stars</span>
                  <span className="text-[11px] text-muted block mt-0.5">В боте Telegram</span>
                </div>
              </button>
            </div>
          </div>

          {/* СПОСОБ 1: КАРТА */}
          <div className={paymentMethod === 'card' ? 'block' : 'hidden'}>
            <form className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface p-5 shadow-xs" onSubmit={handleCardSubmit} noValidate>
              {cardErrors.general ? (
                <Callout tone="danger" title="Ошибка">{cardErrors.general}</Callout>
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

              <Button type="submit" variant="primary" size="lg" className="w-full mt-2 font-medium" disabled={submitting}>
                {submitting ? t('checkout.processing') : t('checkout.pay')}
              </Button>
            </form>
          </div>

          {/* СПОСОБ 2: СБП */}
          {paymentMethod === 'sbp' && (
            <div className="flex flex-col items-center gap-5 rounded-xl border border-stroke bg-surface p-6 text-center shadow-xs animate-fade-in">
              <Callout tone="success" title="Оплата через СБП · 0% комиссии" className="w-full text-left">
                Перевод выполняется по защищённому протоколу НСПК без комиссии со стороны банка.
              </Callout>

              <div className="flex flex-col items-center">
                <p className="text-sm font-semibold text-text">{t('checkout.sbpScanQr')}</p>
                <p className="text-xs text-muted mt-0.5">
                  Т-Банк, СберБанк, Альфа-Банк, ВТБ и 150+ других банков
                </p>
              </div>

              {/* QR код */}
              <div className="relative p-2 rounded-xl bg-canvas border border-stroke">
                {sbpLoading ? (
                  <div className="size-48 flex items-center justify-center text-xs text-muted font-mono">
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

              {/* Таймер */}
              <div className="flex items-center gap-2 text-xs font-mono text-muted">
                <span>Действителен:</span>
                <span className="font-semibold text-accent">
                  {formatTimer(sbpSecondsLeft)}
                </span>
              </div>

              <div className="flex flex-col w-full gap-2.5">
                {sbpInvoice?.deepLink && (
                  <a
                    href={sbpInvoice.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-xs font-medium text-accent-text hover:bg-accent-hover transition-colors"
                  >
                    <SbpIcon className="text-base" />
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

              <p className="text-[11px] text-muted max-w-sm">{t('checkout.sbpNotice')}</p>
            </div>
          )}

          {/* СПОСОБ 3: TELEGRAM STARS */}
          {paymentMethod === 'stars' && (
            <div className="flex flex-col items-center gap-5 rounded-xl border border-stroke bg-surface p-6 text-center shadow-xs animate-fade-in">
              <Callout tone="info" title={t('checkout.starsOfficial')} className="w-full text-left">
                {t('checkout.starsNotice')}
              </Callout>

              <div className="flex flex-col items-center gap-2 p-5 rounded-xl bg-surface-2 border border-stroke w-full">
                <div className="flex items-center justify-center gap-2 text-3xl font-mono font-bold text-accent">
                  <StarIcon className="text-accent" />
                  <span>{starsAmount}</span>
                  <span className="text-lg font-normal text-muted font-sans">Stars</span>
                </div>
                <p className="text-xs text-muted">
                  {t('checkout.starsPeriodNotice', { price: `${plan.priceMonthly} ₽`, plan: t(plan.nameKey) })}
                </p>
              </div>

              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-medium text-muted">{t('checkout.starsQrHint')}</p>
                <div className="p-2 rounded-xl bg-canvas border border-stroke">
                  {starsLoading ? (
                    <div className="size-44 flex items-center justify-center text-xs text-muted font-mono">
                      {language === 'ru' ? 'Подготовка бота...' : 'Preparing bot...'}
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

              <div className="flex flex-col w-full gap-2.5">
                <a
                  href={botDeepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-xs font-medium text-accent-text hover:bg-accent-hover transition-colors"
                >
                  <TelegramIcon className="text-base" />
                  {language === 'ru' ? `Оплатить в Telegram (@${botUsername})` : `Pay in Telegram (@${botUsername})`}
                </a>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={submitting}
                  onClick={handleStarsConfirm}
                >
                  {submitting ? t('checkout.starsChecking') : t('checkout.starsConfirm')}
                </Button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted text-center leading-relaxed">
            {t('checkout.notice')}
          </p>
        </div>

        {/* Правая колонка: сводка заказа (Sticky) */}
        <aside className="lg:sticky lg:top-20 flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5 border-stroke bg-surface">
            <div className="flex items-center justify-between border-b border-stroke pb-3">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-muted">
                {t('checkout.selectedPlan')}
              </span>
              <Badge tone="brand">30 дней</Badge>
            </div>

            <div>
              <h2 className="text-xl font-semibold tracking-tight text-text">
                {t(plan.nameKey)}
              </h2>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                {typeof plan.modelsHighlight === 'string'
                  ? plan.modelsHighlight
                  : plan.modelsHighlight?.[language]}
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3 border border-stroke text-xs text-muted">
              <div className="flex items-center justify-between">
                <span>Стоимость тарифа</span>
                <span className="font-mono text-text font-medium">{plan.priceMonthly.toLocaleString('ru-RU')} ₽</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Комиссия платёжной системы</span>
                <span className="font-mono text-accent font-medium">0 ₽</span>
              </div>
              <div className="border-t border-stroke pt-2 flex items-center justify-between text-sm font-semibold text-text">
                <span>Итого к оплате</span>
                <span className="font-mono text-accent">{plan.priceMonthly.toLocaleString('ru-RU')} ₽</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted">
              <ShieldIcon className="text-accent shrink-0 text-sm" />
              <span>Безопасное соединение TLS 1.3 · Данные карты не сохраняются</span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
