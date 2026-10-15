import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import { ArrowLeftIcon, CheckIcon, CryptoIcon, ShieldIcon, StarIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button-classes';
import { Card } from '@/components/ui/card';
import {
  confirmCryptoPayment,
  confirmTelegramStarsPayment,
  createCryptoInvoice,
  createTelegramStarsInvoice,
  getCryptoInvoiceStatus,
  getTelegramStarsStatus,
} from '@/features/billing/api';
import { useBilling } from '@/features/billing/billing-store';
import { getPlan } from '@/features/billing/plans';
import type {
  CryptoCurrency,
  CryptoInvoice,
  PaymentMethod,
  TelegramStarsInvoice,
} from '@/features/billing/types';
import { copyText } from '@/lib/clipboard';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { cryptoOption } from './checkout/crypto-options';
import { CryptoPanel } from './checkout/crypto-panel';
import { closeGatewayWindow } from './checkout/gateway-window';
import { OrderSummary } from './checkout/order-summary';
import { CheckoutSkeleton } from './checkout/parts';
import { StarsPanel } from './checkout/stars-panel';

/** Оценка цены в звёздах до выставления счёта: курс по умолчанию $0.015, округление до 10. */
function calculateStars(priceUsd: number): number {
  if (priceUsd <= 0) return 0;
  return Math.max(10, Math.ceil(priceUsd / 0.015 / 10) * 10);
}

export function CheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { planId } = useParams<{ planId: string }>();
  const authStatus = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const setUser = useAuth((state) => state.setUser);
  const plan = getPlan(planId);
  const setSubscription = useBilling((state) => state.setSubscription);

  useEffect(() => {
    if (authStatus !== 'loading' && (!user || authStatus === 'unauthenticated')) {
      const targetPlan = planId || 'gpt-pro';
      navigate(`/signup?redirect=${encodeURIComponent(`/checkout/${targetPlan}`)}`, {
        replace: true,
      });
    }
  }, [authStatus, user, planId, navigate]);

  // Выбранный способ оплаты: по умолчанию криптовалюта (Trybit)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('crypto');
  const [payerEmail, setPayerEmail] = useState(user?.email || '');
  const [sendReceiptEmail, setSendReceiptEmail] = useState(true);
  const [gatewayOpened, setGatewayOpened] = useState(false);

  useEffect(() => {
    if (user?.email && !payerEmail) {
      setPayerEmail(user.email);
    }
  }, [user?.email, payerEmail]);

  // Криптовалюта
  const [cryptoCurrency, setCryptoCurrency] = useState<CryptoCurrency>('USDT_TRC20');
  const [cryptoInvoice, setCryptoInvoice] = useState<CryptoInvoice | null>(null);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [cryptoAttempt, setCryptoAttempt] = useState(0);
  const [cryptoSecondsLeft, setCryptoSecondsLeft] = useState(30 * 60);
  const [copiedCryptoAddress, setCopiedCryptoAddress] = useState(false);
  const [copiedCryptoAmount, setCopiedCryptoAmount] = useState(false);

  // Telegram Stars
  const [starsInvoice, setStarsInvoice] = useState<TelegramStarsInvoice | null>(null);
  const [starsLoading, setStarsLoading] = useState(false);

  // Обратная связь при ручной проверке оплаты
  const [checkFeedback, setCheckFeedback] = useState<{
    method: PaymentMethod;
    type: 'info' | 'warning' | 'success';
    message: string;
  } | null>(null);

  // Общий статус оформления
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [paidMethodName, setPaidMethodName] = useState<string>('');

  const pollingRef = useRef<number | null>(null);

  // Таймер Криптовалюты
  useEffect(() => {
    if (paymentMethod !== 'crypto') return;
    const interval = window.setInterval(() => {
      setCryptoSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [paymentMethod]);

  // Загрузка инвойса Криптовалюты
  useEffect(() => {
    if (paymentMethod === 'crypto' && plan && plan.priceMonthly > 0) {
      setCryptoLoading(true);
      setCryptoError(null);
      setCryptoInvoice(null);
      createCryptoInvoice(plan.id, cryptoCurrency)
        .then(({ invoice }) => {
          setCryptoInvoice(invoice);
          // Таймер по сроку счёта в шлюзе (у H2H-счёта он свой), иначе 30 минут.
          const left = Math.floor((new Date(invoice.expiresAt).getTime() - Date.now()) / 1000);
          setCryptoSecondsLeft(invoice.gatewayDetails && left > 0 ? left : 30 * 60);
        })
        .catch((err) => {
          console.error('Failed to create Crypto invoice:', err);
          setCryptoError(err instanceof Error && err.message ? err.message : t('checkout.cryptoInvoiceFailed'));
        })
        .finally(() => setCryptoLoading(false));
    }
    // t меняется при смене языка — счёт из-за этого заново не выставляем
  }, [paymentMethod, cryptoCurrency, plan, cryptoAttempt]);

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

  // Оплата прошла — закрываем окно виджета Trybit
  useEffect(() => {
    if (success) closeGatewayWindow();
  }, [success]);

  // Polling статуса инвойса
  useEffect(() => {
    if (success) return;

    if (paymentMethod === 'crypto' && cryptoInvoice && cryptoInvoice.status !== 'paid') {
      pollingRef.current = window.setInterval(async () => {
        try {
          const res = await getCryptoInvoiceStatus(cryptoInvoice.id);
          if (res.status === 'paid') {
            const conf = await confirmCryptoPayment(cryptoInvoice.id);
            setSubscription(conf.subscription, conf.user.plan);
            if (user) setUser({ ...user, plan: conf.user.plan });
            setPaidMethodName(t('checkout.methodCrypto'));
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
            const conf = await confirmTelegramStarsPayment(starsInvoice.id);
            setSubscription(conf.subscription, conf.user.plan);
            if (user) setUser({ ...user, plan: conf.user.plan });
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
  }, [paymentMethod, cryptoInvoice, starsInvoice, success, user, setUser, setSubscription, t]);

  if (authStatus === 'loading') {
    return <CheckoutSkeleton label={t('common.loading')} />;
  }

  if (authStatus === 'unauthenticated' || !user) {
    return null;
  }

  if (!plan) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-text">{t('notFound.title')}</h1>
        <p className="text-sm text-muted">{t('notFound.text')}</p>
        <Link to="/pricing" className={buttonClasses({ variant: 'outline' })}>
          {t('pricing.title')}
        </Link>
      </div>
    );
  }

  // Подтверждение Криптовалюты
  const handleCryptoConfirm = async () => {
    if (!cryptoInvoice) return;
    setSubmitting(true);
    setCheckFeedback(null);
    try {
      const res = await confirmCryptoPayment(cryptoInvoice.id);
      setSubscription(res.subscription, res.user.plan);
      if (user) setUser({ ...user, plan: res.user.plan });
      setPaidMethodName(t('checkout.methodCrypto'));
      setSuccess(true);
    } catch (err) {
      console.error('Failed to confirm Crypto payment:', err);
      setCheckFeedback({
        method: 'crypto',
        type: 'warning',
        message:
          err instanceof Error && err.message
            ? err.message
            : t('checkout.cryptoPending'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Проверка и подтверждение Telegram Stars
  const handleStarsConfirm = async () => {
    const invoiceId = starsInvoice?.id || `stars_${plan.id}`;
    setSubmitting(true);
    setCheckFeedback(null);
    try {
      const statusRes = await getTelegramStarsStatus(invoiceId);
      if (statusRes.status === 'paid') {
        const res = await confirmTelegramStarsPayment(invoiceId);
        setSubscription(res.subscription, res.user.plan);
        if (user) setUser({ ...user, plan: res.user.plan });
        setPaidMethodName(t('checkout.methodStars'));
        setSuccess(true);
      } else {
        setCheckFeedback({
          method: 'stars',
          type: 'warning',
          message: t('checkout.starsNotPaid', { bot: botUsername }),
        });
      }
    } catch (err) {
      console.error('Failed to check Stars payment:', err);
      setCheckFeedback({
        method: 'stars',
        type: 'warning',
        message: t('checkout.starsCheckFailed'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const pad = (value: number) => value.toString().padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    // Счёт Trybit живёт сутки: часы показываем, только когда они есть.
    return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  };

  const copyToClipboard = async (text: string, setCopiedFn: (val: boolean) => void) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedFn(true);
      setTimeout(() => setCopiedFn(false), 2000);
    }
  };

  // Сумма в звёздах приходит со счётом (по текущему курсу Telegram Stars); до счёта — оценка.
  const starsAmount = starsInvoice?.starsAmount ?? calculateStars(plan.priceMonthly);
  const rawBot = starsInvoice?.botUsername;
  const botUsername =
    rawBot && rawBot.trim() !== '' && rawBot !== 'KetnerAIBot'
      ? rawBot.replace(/^@/, '')
      : 'Robo_kassa_bot';
  const startParam = starsInvoice?.id
    ? `pay_${plan.id}__${starsInvoice.id}`
    : `pay_${plan.id}_${user.id}`;
  let botDeepLink = `https://t.me/${botUsername}?start=${startParam}`;
  if (
    starsInvoice?.botDeepLink &&
    !starsInvoice.botDeepLink.includes('t.me/?') &&
    !starsInvoice.botDeepLink.includes('t.me//') &&
    !starsInvoice.botDeepLink.includes('KetnerAIBot')
  ) {
    botDeepLink = starsInvoice.botDeepLink;
  }
  // Ссылка на окно оплаты открывает оплату сразу, без переписки с ботом.
  if (starsInvoice?.invoiceLink) botDeepLink = starsInvoice.invoiceLink;

  const currentCrypto = cryptoOption(cryptoCurrency);
  // Реквизиты от Trybit (H2H): точная сумма в криптовалюте приходит со счётом.
  const gatewayDetails = Boolean(cryptoInvoice?.gatewayDetails);
  const cryptoTicker = currentCrypto.ticker;
  const cryptoAmountStr =
    gatewayDetails && cryptoInvoice
      ? `${cryptoInvoice.amount} ${cryptoTicker}`
      : currentCrypto.formatAmount(plan.priceMonthly);
  // Адрес и QR выдаёт только Trybit; своих кошельков на странице нет.
  const cryptoAddress = cryptoInvoice?.address ?? '';
  const cryptoQr = cryptoInvoice?.qrPayload ?? '';

  const planName = t(plan.nameKey);
  const feedbackFor = (method: PaymentMethod): string | null =>
    checkFeedback && checkFeedback.method === method ? checkFeedback.message : null;
  const selectMethod = (method: PaymentMethod): void => {
    setPaymentMethod(method);
    setCheckFeedback(null);
  };

  // Экран успешного оформления
  if (success) {
    return (
      <div className="mx-auto flex w-full max-w-lg animate-fade-in flex-col items-center gap-6 py-10 text-center md:py-16">
        <div className="relative grid size-20 place-items-center rounded-3xl border border-accent/40 bg-accent-soft text-accent shadow-glow">
          <CheckIcon className="relative z-10 size-10 text-accent" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-text md:text-3xl">
            {t('checkout.successTitle')}
          </h1>
          <p className="text-sm text-muted">
            {t('checkout.successMessage')}
            {paidMethodName ? ` · ${paidMethodName}` : ''}
          </p>
        </div>

        <Card className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl p-5 text-left">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text">{planName}</h2>
              <Badge tone="brand">{t('checkout.days30')}</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-success">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-success" />
              {t('settings.statusActive')} · {t('checkout.accessActivated')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-text tabular-nums">
              ${plan.priceMonthly}
              <span className="ml-1 text-xs font-normal text-muted">/{t('pricing.month')}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">{paidMethodName || t('checkout.paid')}</p>
          </div>
        </Card>

        <div className="flex w-full flex-col gap-3 pt-2 sm:flex-row">
          <Link to="/chat" className={buttonClasses({ variant: 'primary', size: 'lg', className: 'flex-1' })}>
            {t('checkout.goToChat')}
          </Link>
          <Link to="/settings" className={buttonClasses({ variant: 'outline', size: 'lg', className: 'flex-1' })}>
            {t('checkout.goToSettings')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl animate-fade-in flex-col gap-6 text-text md:gap-8">
      {/* Шапка страницы */}
      <div className="flex flex-col justify-between gap-4 border-b border-stroke pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3.5">
          <Link
            to="/pricing"
            aria-label={t('checkout.back')}
            title={t('checkout.back')}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-stroke bg-surface text-muted shadow-xs transition-[border-color,color] hover:border-accent hover:text-accent"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance text-text md:text-3xl">
              {t('checkout.title')}
            </h1>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">{t('checkout.lead')}</p>
          </div>
        </div>

        {/* Индикатор шагов */}
        <ol aria-label={t('checkout.stepsLabel')} className="flex items-center gap-2 text-[13px]">
          <li>
            <Link
              to="/pricing"
              className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-muted transition-colors hover:text-text"
            >
              <span className="grid size-6 place-items-center rounded-full border border-stroke bg-surface-2 text-xs font-semibold">
                <CheckIcon className="size-3.5 text-accent" />
              </span>
              <span>{t('checkout.stepPlan')}</span>
            </Link>
          </li>
          <li aria-hidden="true" className="h-px w-5 bg-stroke-strong" />
          <li aria-current="step" className="flex items-center gap-2 font-semibold text-text">
            <span className="grid size-6 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-accent-text">
              2
            </span>
            <span>{t('checkout.stepPay')}</span>
          </li>
          <li aria-hidden="true" className="h-px w-5 bg-stroke-strong" />
          <li className="flex items-center gap-2 text-subtle">
            <span className="grid size-6 place-items-center rounded-full border border-stroke text-xs font-semibold">
              3
            </span>
            <span>{t('checkout.stepAccess')}</span>
          </li>
        </ol>
      </div>

      {/* Двухколоночный макет: форма слева, сводка справа */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Выбор способа оплаты */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p id="checkout-methods" className="text-[13px] font-semibold text-text">
                {t('checkout.methodTitle')}
              </p>
              <span className="text-xs text-muted">{t('checkout.chooseMethod')}</span>
            </div>

            <div role="group" aria-labelledby="checkout-methods" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MethodTile
                selected={paymentMethod === 'crypto'}
                onSelect={() => selectMethod('crypto')}
                icon={<CryptoIcon className="size-[18px]" />}
                badge={t('checkout.tileCryptoBadge')}
                badgeTone="brand"
                title={t('checkout.tileCrypto')}
                description={t('checkout.tileCryptoDesc')}
              />
              <MethodTile
                selected={paymentMethod === 'stars'}
                onSelect={() => selectMethod('stars')}
                icon={<StarIcon className="size-[18px] fill-warning" />}
                iconClassName="bg-warning-soft text-warning ring-warning/25"
                badge="XTR"
                title={t('checkout.tileStars')}
                description={t('checkout.tileStarsDesc')}
              />
            </div>
          </div>

          <p className="text-[12px] leading-5 text-subtle">
            Оплачивая, вы принимаете{' '}
            <Link to="/terms" className="underline underline-offset-4 hover:text-text">
              оферту
            </Link>{' '}
            и{' '}
            <Link to="/payment-terms" className="underline underline-offset-4 hover:text-text">
              условия оплаты и возврата
            </Link>
            : в течение 24 часов, если моделями ещё не пользовались.
          </p>

          {paymentMethod === 'crypto' && (
            <CryptoPanel
              plan={plan}
              planName={planName}
              amount={cryptoAmountStr}
              timer={formatTimer(cryptoSecondsLeft)}
              currency={cryptoCurrency}
              onCurrencyChange={setCryptoCurrency}
              payerEmail={payerEmail}
              onPayerEmailChange={setPayerEmail}
              sendReceipt={sendReceiptEmail}
              onSendReceiptChange={setSendReceiptEmail}
              gatewayOpened={gatewayOpened}
              onGatewayOpen={() => setGatewayOpened(true)}
              invoice={cryptoInvoice}
              loading={cryptoLoading}
              invoiceError={cryptoError}
              onRetryInvoice={() => setCryptoAttempt((attempt) => attempt + 1)}
              option={currentCrypto}
              address={cryptoAddress}
              qr={cryptoQr}
              copiedAddress={copiedCryptoAddress}
              copiedAmount={copiedCryptoAmount}
              onCopyAddress={() => void copyToClipboard(cryptoAddress, setCopiedCryptoAddress)}
              onCopyAmount={() =>
                void copyToClipboard(
                  String(gatewayDetails && cryptoInvoice ? cryptoInvoice.amount : (currentCrypto.calcAmount(plan.priceMonthly) ?? plan.priceMonthly)),
                  setCopiedCryptoAmount,
                )
              }
              submitting={submitting}
              feedback={feedbackFor('crypto')}
              onConfirm={() => void handleCryptoConfirm()}
            />
          )}

          {paymentMethod === 'stars' && (
            <StarsPanel
              plan={plan}
              planName={planName}
              starsAmount={starsAmount}
              botUsername={botUsername}
              botDeepLink={botDeepLink}
              loading={starsLoading}
              submitting={submitting}
              feedback={feedbackFor('stars')}
              onConfirm={() => void handleStarsConfirm()}
            />
          )}

          <p className="flex items-center justify-center gap-2 text-center text-xs leading-5 text-muted">
            <ShieldIcon className="size-3.5 shrink-0 text-accent" />
            <span>{t('checkout.notice')}</span>
          </p>
        </div>

        <OrderSummary plan={plan} feeUsd={paymentMethod === 'crypto' && !cryptoLoading ? (cryptoInvoice?.fees?.payerUsd ?? 0) : 0} />
      </div>
    </div>
  );
}

interface MethodTileProps {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  iconClassName?: string;
  badge: string;
  badgeTone?: BadgeTone;
  title: string;
  description: string;
}

/** Плитка способа оплаты: иконка, метка, название и короткое пояснение. */
function MethodTile({
  selected,
  onSelect,
  icon,
  iconClassName,
  badge,
  badgeTone = 'neutral',
  title,
  description,
}: MethodTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'lift group relative grid grid-cols-[auto_1fr_auto] items-center gap-x-3 overflow-hidden rounded-2xl border p-3.5 text-left',
        'sm:grid-cols-[auto_1fr] sm:gap-y-3 sm:p-4',
        selected
          ? 'border-accent bg-accent-soft shadow-glow ring-1 ring-accent/30'
          : 'border-stroke bg-surface shadow-xs hover:border-stroke-strong hover:bg-surface-2 hover:shadow-md',
      )}
    >
      <span
        className={cn(
          'col-start-1 row-start-1 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/20 ring-inset transition-transform duration-200 group-hover:scale-105 sm:size-9',
          iconClassName,
        )}
      >
        {icon}
      </span>
      <span className="col-start-2 row-start-1 flex min-w-0 flex-col gap-0.5 sm:col-span-2 sm:col-start-1 sm:row-start-2">
        <span className="text-sm font-semibold text-text">{title}</span>
        <span className="text-xs leading-5 text-muted">{description}</span>
      </span>
      <Badge
        tone={selected ? 'brand' : badgeTone}
        className={cn(
          'col-start-3 row-start-1 self-start px-2 py-0 text-[11px] font-semibold sm:col-start-2 sm:self-center sm:justify-self-end',
          selected && 'bg-surface',
        )}
      >
        {badge}
      </Badge>
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 h-full w-1 bg-brand-gradient sm:top-auto sm:bottom-0 sm:h-1 sm:w-full"
        />
      ) : null}
    </button>
  );
}
