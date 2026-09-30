import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import {
  ArrowLeftIcon,
  BitcoinIcon,
  CheckIcon,
  CopyIcon,
  CryptoIcon,
  SbpIcon,
  ShieldIcon,
  StarIcon,
  TelegramIcon,
  TonIcon,
  UsdtIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/docs/callout';
import { QrCode } from '@/components/ui/qr-code';
import {
  confirmCryptoPayment,
  confirmSbpPayment,
  confirmTelegramStarsPayment,
  createCryptoInvoice,
  createSbpInvoice,
  createTelegramStarsInvoice,
  getCryptoInvoiceStatus,
  getSbpInvoiceStatus,
  getTelegramStarsStatus,
} from '@/features/billing/api';
import { useBilling } from '@/features/billing/billing-store';
import { getPlan } from '@/features/billing/plans';
import type {
  CryptoCurrency,
  CryptoInvoice,
  PaymentMethod,
  SbpInvoice,
  TelegramStarsInvoice,
} from '@/features/billing/types';
import { copyText } from '@/lib/clipboard';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

function calculateStars(price: number): number {
  if (price <= 0) return 0;
  if (price === 30 || price === 39 || price === 2499 || price === 2990 || price === 49) return 1350;
  if (price === 20 || price === 29 || price === 1199 || price === 1990 || price === 1999) return 650;
  if (price === 10 || price === 9 || price === 990 || price === 999) return 550;
  return Math.round(price * 35);
}

function calculateRubPrice(priceUsd: number): number {
  if (priceUsd === 10) return 990;
  if (priceUsd === 20) return 1990;
  if (priceUsd === 30) return 2990;
  return Math.round(priceUsd * 99);
}

interface CryptoOption {
  id: CryptoCurrency;
  name: string;
  network: string;
  badge: string;
  icon: typeof UsdtIcon;
  calcAmount: (usd: number) => number;
  formatAmount: (usd: number) => string;
  defaultAddress: string;
}

const CRYPTO_OPTIONS: readonly CryptoOption[] = [
  {
    id: 'USDT_TRC20',
    name: 'USDT (TRC-20)',
    network: 'TRC-20 (Tron)',
    badge: 'Популярный',
    icon: UsdtIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
    defaultAddress: 'TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP',
  },
  {
    id: 'USDT_TON',
    name: 'USDT (TON)',
    network: 'TON Network',
    badge: 'Комиссия ~$0.05',
    icon: TonIcon,
    calcAmount: (usd) => usd,
    formatAmount: (usd) => `${usd.toFixed(2)} USDT`,
    defaultAddress: 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS',
  },
  {
    id: 'TON',
    name: 'TON',
    network: 'The Open Network',
    badge: 'Telegram',
    icon: TonIcon,
    calcAmount: (usd) => +(usd / 5.4).toFixed(2),
    formatAmount: (usd) => `${(usd / 5.4).toFixed(2)} TON`,
    defaultAddress: 'UQA6ebFQPlulDzarfUtQJX8T61BHknM76VVYZ-3j-8eLnbyS',
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    network: 'Bitcoin',
    badge: 'BTC Mainnet',
    icon: BitcoinIcon,
    calcAmount: (usd) => +(usd / 95000).toFixed(6),
    formatAmount: (usd) => `${(usd / 95000).toFixed(6)} BTC`,
    defaultAddress: 'bc1qa27xsypxy7pstvh2yrmzrlwev36qrr5az3vr7h',
  },
];

const RUSSIAN_BANKS = [
  { name: 'Т-Банк', color: 'from-yellow-500/20 to-yellow-600/10 text-yellow-500' },
  { name: 'СберБанк', color: 'from-emerald-500/20 to-emerald-600/10 text-emerald-500' },
  { name: 'Альфа-Банк', color: 'from-red-500/20 to-red-600/10 text-red-500' },
  { name: 'ВТБ', color: 'from-blue-500/20 to-blue-600/10 text-blue-500' },
];

export function CheckoutPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { planId } = useParams<{ planId: string }>();
  const authStatus = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
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

  // Выбранный способ оплаты: по умолчанию СБП
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('sbp');

  // СБП
  const [sbpInvoice, setSbpInvoice] = useState<SbpInvoice | null>(null);
  const [sbpLoading, setSbpLoading] = useState(false);
  const [sbpSecondsLeft, setSbpSecondsLeft] = useState(15 * 60);
  const [copiedSbpSum, setCopiedSbpSum] = useState(false);

  // Криптовалюта
  const [cryptoCurrency, setCryptoCurrency] = useState<CryptoCurrency>('USDT_TRC20');
  const [cryptoInvoice, setCryptoInvoice] = useState<CryptoInvoice | null>(null);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoSecondsLeft, setCryptoSecondsLeft] = useState(30 * 60);
  const [txHashInput, setTxHashInput] = useState('');
  const [copiedCryptoAddress, setCopiedCryptoAddress] = useState(false);
  const [copiedCryptoAmount, setCopiedCryptoAmount] = useState(false);

  // Telegram Stars
  const [starsInvoice, setStarsInvoice] = useState<TelegramStarsInvoice | null>(null);
  const [starsLoading, setStarsLoading] = useState(false);

  // Общий статус оформления
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [paidMethodName, setPaidMethodName] = useState<string>('');

  const pollingRef = useRef<number | null>(null);

  // Таймер СБП
  useEffect(() => {
    if (paymentMethod !== 'sbp') return;
    const interval = window.setInterval(() => {
      setSbpSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [paymentMethod]);

  // Таймер Криптовалюты
  useEffect(() => {
    if (paymentMethod !== 'crypto') return;
    const interval = window.setInterval(() => {
      setCryptoSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [paymentMethod]);

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

  // Загрузка инвойса Криптовалюты
  useEffect(() => {
    if (paymentMethod === 'crypto' && plan && plan.priceMonthly > 0) {
      setCryptoLoading(true);
      createCryptoInvoice(plan.id, cryptoCurrency)
        .then(({ invoice }) => {
          setCryptoInvoice(invoice);
          setCryptoSecondsLeft(30 * 60);
        })
        .catch((err) => {
          console.error('Failed to create Crypto invoice:', err);
        })
        .finally(() => setCryptoLoading(false));
    }
  }, [paymentMethod, cryptoCurrency, plan]);

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
    } else if (paymentMethod === 'crypto' && cryptoInvoice && cryptoInvoice.status !== 'paid') {
      pollingRef.current = window.setInterval(async () => {
        try {
          const res = await getCryptoInvoiceStatus(cryptoInvoice.id);
          if (res.status === 'paid') {
            await confirmCryptoPayment(cryptoInvoice.id);
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
  }, [paymentMethod, sbpInvoice, cryptoInvoice, starsInvoice, success, t]);

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

  // Подтверждение Криптовалюты
  const handleCryptoConfirm = async () => {
    const invoiceId = cryptoInvoice?.id || `crypto_${plan.id}`;
    setSubmitting(true);
    try {
      const res = await confirmCryptoPayment(invoiceId, txHashInput.trim() || undefined);
      setSubscription(res.subscription, res.user.plan);
      setPaidMethodName(t('checkout.methodCrypto'));
      setSuccess(true);
    } catch (err) {
      console.error('Failed to confirm Crypto payment:', err);
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

  const copyToClipboard = async (text: string, setCopiedFn: (val: boolean) => void) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedFn(true);
      setTimeout(() => setCopiedFn(false), 2000);
    }
  };

  const rubAmount = calculateRubPrice(plan.priceMonthly);
  const starsAmount = calculateStars(plan.priceMonthly);
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

  const currentCrypto =
    CRYPTO_OPTIONS.find((c) => c.id === cryptoCurrency) || CRYPTO_OPTIONS[0];
  const cryptoAmountStr = currentCrypto.formatAmount(plan.priceMonthly);
  const cryptoAddress = cryptoInvoice?.address || currentCrypto.defaultAddress;
  const cryptoQr =
    cryptoInvoice?.qrPayload || `${currentCrypto.network.toLowerCase()}:${cryptoAddress}`;

  // Экран успешного оформления
  if (success) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-16 text-center animate-fade-in">
        <div className="relative grid size-20 place-items-center rounded-3xl bg-accent/15 border-2 border-accent/40 text-accent shadow-lg shadow-accent/10">
          <div className="absolute inset-0 rounded-3xl bg-accent/10 animate-ping opacity-25" />
          <CheckIcon className="size-10 text-accent relative z-10" />
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

        <Card className="flex w-full items-center justify-between text-left p-5 border-stroke bg-surface/90 backdrop-blur-sm shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-text">{t(plan.nameKey)}</h2>
              <Badge tone="brand" className="text-[10px]">30 дней</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-accent font-medium">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              {t('settings.statusActive')} · Доступ активирован
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-text font-mono">
              ${plan.priceMonthly}
              <span className="ml-1 text-xs font-normal text-muted font-sans">/{t('pricing.month')}</span>
            </p>
            <p className="text-xs text-muted mt-0.5 font-mono">
              {paidMethodName || 'Оплачено'}
            </p>
          </div>
        </Card>

        <div className="flex w-full gap-3 pt-2">
          <Link to="/chat" className="flex-1">
            <Button variant="primary" className="w-full h-11 text-sm font-medium shadow-sm">
              {t('checkout.goToChat')}
            </Button>
          </Link>
          <Link to="/settings" className="flex-1">
            <Button variant="outline" className="w-full h-11 text-sm font-medium">
              {t('checkout.goToSettings')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 animate-fade-in text-text">
      {/* Шапка страницы */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stroke/60 pb-6">
        <div className="flex items-center gap-3.5">
          <Link
            to="/pricing"
            className="inline-flex size-10 items-center justify-center rounded-xl border border-stroke bg-surface hover:border-accent hover:text-accent transition-all shadow-xs"
            title="Назад к тарифам"
          >
            <ArrowLeftIcon className="text-sm" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">
              {t('checkout.title')}
            </h1>
            <p className="text-xs text-muted mt-0.5">
              Быстрая и безопасная активация подписки Ketner AI
            </p>
          </div>
        </div>

        {/* Индикатор шагов */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <Link
            to="/pricing"
            className="flex items-center gap-1.5 text-muted hover:text-text transition-colors"
          >
            <span className="grid size-5 place-items-center rounded-full bg-surface-2 border border-stroke text-[10px] font-bold">
              01
            </span>
            <span>Тариф</span>
          </Link>
          <span className="text-muted/40">/</span>
          <div className="flex items-center gap-1.5 text-accent font-semibold">
            <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-text text-[10px] font-bold">
              02
            </span>
            <span>Оплата</span>
          </div>
          <span className="text-muted/40">/</span>
          <div className="flex items-center gap-1.5 text-muted/60">
            <span className="grid size-5 place-items-center rounded-full bg-surface border border-stroke/40 text-[10px]">
              03
            </span>
            <span>Доступ</span>
          </div>
        </div>
      </div>

      {/* Двухколоночный макет: форма слева, сводка справа */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        {/* Левая колонка: выбор способов и платёжные реквизиты */}
        <div className="flex flex-col gap-6">
          {/* Выбор 3 способов оплаты */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-muted font-mono">
                {t('checkout.methodTitle')}
              </label>
              <span className="text-[11px] text-muted font-sans">
                Выберите наиболее удобный способ
              </span>
            </div>

            <div
              aria-label={t('checkout.methodTitle')}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              {/* СПОСОБ 1: СБП */}
              <button
                type="button"
                aria-pressed={paymentMethod === 'sbp'}
                onClick={() => setPaymentMethod('sbp')}
                className={cn(
                  'group flex flex-col items-start gap-2.5 rounded-2xl p-4 border text-left transition-all relative overflow-hidden',
                  paymentMethod === 'sbp'
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-sm'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/40',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="size-8 rounded-xl bg-surface-2 border border-stroke flex items-center justify-center group-hover:scale-105 transition-transform">
                    <SbpIcon className="size-4" />
                  </div>
                  <Badge tone="brand" className="text-[10px] px-1.5 py-0.5 font-bold">
                    0% комиссия
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-bold text-text block">СБП по QR</span>
                  <span className="text-[11px] text-muted block mt-0.5 leading-snug">
                    Любой банк РФ · 0% комиссии
                  </span>
                </div>
              </button>

              {/* СПОСОБ 2: КРИПТОВАЛЮТА */}
              <button
                type="button"
                aria-pressed={paymentMethod === 'crypto'}
                onClick={() => setPaymentMethod('crypto')}
                className={cn(
                  'group flex flex-col items-start gap-2.5 rounded-2xl p-4 border text-left transition-all relative overflow-hidden',
                  paymentMethod === 'crypto'
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-sm'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/40',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="size-8 rounded-xl bg-surface-2 border border-stroke flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
                    <CryptoIcon className="size-4 text-accent" />
                  </div>
                  <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5 font-mono">
                    USDT / TON
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-bold text-text block">Криптовалюта</span>
                  <span className="text-[11px] text-muted block mt-0.5 leading-snug">
                    USDT, TON, Bitcoin
                  </span>
                </div>
              </button>

              {/* СПОСОБ 3: TELEGRAM STARS */}
              <button
                type="button"
                aria-pressed={paymentMethod === 'stars'}
                onClick={() => setPaymentMethod('stars')}
                className={cn(
                  'group flex flex-col items-start gap-2.5 rounded-2xl p-4 border text-left transition-all relative overflow-hidden',
                  paymentMethod === 'stars'
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-sm'
                    : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2/40',
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="size-8 rounded-xl bg-surface-2 border border-stroke flex items-center justify-center text-amber-500 group-hover:scale-105 transition-transform">
                    <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                  </div>
                  <Badge tone="neutral" className="text-[10px] px-1.5 py-0.5 font-bold">
                    В боте
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-bold text-text block">Telegram Stars</span>
                  <span className="text-[11px] text-muted block mt-0.5 leading-snug">
                    В официальном боте
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* ПАНЕЛЬ СПОСОБА 1: СБП (Система быстрых платежей) */}
          {paymentMethod === 'sbp' && (
            <div className="flex flex-col gap-6 rounded-2xl border border-stroke bg-surface p-6 shadow-sm animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke/60 pb-5">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <SbpIcon className="size-5" />
                    <span>Оплата через СБП</span>
                  </h3>
                  <p className="text-xs text-muted mt-1">
                    Отсканируйте QR-код в приложении любого банка РФ без комиссии
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono rounded-xl bg-canvas border border-stroke/70 px-3 py-1.5 self-start sm:self-auto">
                  <span className="text-muted">Таймер счёта:</span>
                  <span className="font-bold text-accent">{formatTimer(sbpSecondsLeft)}</span>
                </div>
              </div>

              {/* Карточка суммы в рублях */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-surface-2 border border-stroke/70">
                <div>
                  <span className="text-xs text-muted block font-medium">Сумма к списанию:</span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-2xl font-bold font-mono text-text">
                      {rubAmount.toLocaleString('ru-RU')} ₽
                    </span>
                    <span className="text-xs text-muted font-normal font-sans">
                      (${plan.priceMonthly})
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 font-mono text-xs self-start sm:self-auto"
                  onClick={() => copyToClipboard(String(rubAmount), setCopiedSbpSum)}
                >
                  {copiedSbpSum ? (
                    <>
                      <CheckIcon className="size-3.5 text-accent" />
                      <span>{t('checkout.cryptoCopied')}</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3.5 text-muted" />
                      <span>{t('checkout.sbpCopySum')}</span>
                    </>
                  )}
                </Button>
              </div>

              {/* QR-код и инструкция */}
              <div className="flex flex-col md:flex-row items-center gap-6 p-4 rounded-2xl bg-canvas border border-stroke/70">
                <div className="relative p-3 rounded-2xl bg-white shadow-sm shrink-0 border border-slate-200">
                  {sbpLoading ? (
                    <div className="size-44 flex flex-col items-center justify-center gap-2 text-xs text-slate-500 font-mono">
                      <span className="size-5 animate-spin rounded-full border-2 border-slate-700 border-t-transparent" />
                      <span>Генерация СБП...</span>
                    </div>
                  ) : (
                    <QrCode
                      value={
                        sbpInvoice?.qrPayload ||
                        `https://qr.nspk.ru/AD10000KETNERAI_${plan.id}?amount=${rubAmount * 100}`
                      }
                      size={176}
                      badge={
                        <div className="size-8 flex items-center justify-center rounded-lg bg-white shadow-sm">
                          <SbpIcon className="size-5" />
                        </div>
                      }
                    />
                  )}
                </div>

                <div className="flex flex-col gap-3 text-left">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-text">
                      Как оплатить через смартфон:
                    </h4>
                    <ol className="text-xs text-muted space-y-1.5 list-decimal list-inside leading-relaxed">
                      <li>Откройте приложение вашего банка (Т-Банк, Сбер, Альфа и др.)</li>
                      <li>Выберите «Оплата по QR-коду» и наведите камеру на QR</li>
                      <li>Проверьте сумму ({rubAmount} ₽) и подтвердите платёж</li>
                    </ol>
                  </div>

                  {/* Быстрые ссылки банков */}
                  <div className="pt-2 border-t border-stroke/50">
                    <span className="text-[11px] font-semibold text-muted block mb-1.5 uppercase tracking-wider font-mono">
                      Поддерживаемые банки:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {RUSSIAN_BANKS.map((b) => (
                        <span
                          key={b.name}
                          className="rounded-lg bg-surface-2 border border-stroke/60 px-2 py-1 text-[11px] font-medium text-text"
                        >
                          {b.name}
                        </span>
                      ))}
                      <span className="rounded-lg bg-surface-2 border border-stroke/60 px-2 py-1 text-[11px] text-muted">
                        +150 других
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Кнопки действий */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {sbpInvoice?.deepLink && (
                  <a
                    href={sbpInvoice.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-text hover:bg-accent-hover transition-colors shadow-sm"
                  >
                    <SbpIcon className="size-4" />
                    <span>{t('checkout.sbpOpenBank')}</span>
                  </a>
                )}

                <Button
                  type="button"
                  variant={sbpInvoice?.deepLink ? 'outline' : 'primary'}
                  className={cn(
                    'h-11 rounded-xl font-semibold text-sm',
                    sbpInvoice?.deepLink ? 'flex-1' : 'w-full',
                  )}
                  disabled={submitting}
                  onClick={handleSbpConfirm}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span>{t('checkout.sbpChecking')}</span>
                    </span>
                  ) : (
                    <span>{t('checkout.sbpConfirm')}</span>
                  )}
                </Button>
              </div>

              <p className="text-[11px] text-muted text-center leading-relaxed">
                {t('checkout.sbpNotice')} Мгновенное зачисление средств и автоматическая активация.
              </p>
            </div>
          )}

          {/* ПАНЕЛЬ СПОСОБА 2: КРИПТОВАЛЮТА */}
          {paymentMethod === 'crypto' && (
            <div className="flex flex-col gap-6 rounded-2xl border border-stroke bg-surface p-6 shadow-sm animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke/60 pb-5">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <CryptoIcon className="size-5 text-accent" />
                    <span>Оплата криптовалютой</span>
                  </h3>
                  <p className="text-xs text-muted mt-1">
                    USDT (TRC-20, TON), нативный TON или Bitcoin
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono rounded-xl bg-canvas border border-stroke/70 px-3 py-1.5 self-start sm:self-auto">
                  <span className="text-muted">Фиксация курса:</span>
                  <span className="font-bold text-accent">{formatTimer(cryptoSecondsLeft)}</span>
                </div>
              </div>

              {/* Выбор монеты / сети */}
              <div className="flex flex-col gap-2.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
                  {t('checkout.cryptoNetwork')}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CRYPTO_OPTIONS.map((opt) => {
                    const active = cryptoCurrency === opt.id;
                    const IconComp = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCryptoCurrency(opt.id)}
                        className={cn(
                          'flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all',
                          active
                            ? 'border-accent bg-accent/10 shadow-xs'
                            : 'border-stroke bg-surface-2 hover:border-stroke-strong hover:bg-surface-2/80',
                        )}
                      >
                        <div className="flex items-center justify-between w-full">
                          <IconComp className="size-5" />
                          <span
                            className={cn(
                              'text-[9px] font-bold px-1 py-0.5 rounded font-mono',
                              active
                                ? 'bg-accent text-accent-text'
                                : 'bg-canvas text-muted border border-stroke/60',
                            )}
                          >
                            {opt.id === 'USDT_TRC20' ? 'TRC20' : opt.id === 'USDT_TON' ? 'TON' : opt.id}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-text mt-1">{opt.name}</span>
                        <span className="text-[10px] text-muted truncate w-full">{opt.badge}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Сумма и адрес для перевода */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Сумма */}
                <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-2 border border-stroke/70">
                  <span className="text-xs text-muted block font-medium">
                    {t('checkout.cryptoAmount')}:
                  </span>
                  <div className="flex items-baseline justify-between gap-2 mt-2">
                    <span className="text-xl font-bold font-mono text-accent">
                      {cryptoAmountStr}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs font-mono"
                      onClick={() =>
                        copyToClipboard(
                          String(currentCrypto.calcAmount(plan.priceMonthly)),
                          setCopiedCryptoAmount,
                        )
                      }
                    >
                      {copiedCryptoAmount ? (
                        <>
                          <CheckIcon className="size-3 text-accent" />
                          <span>{t('checkout.cryptoCopied')}</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon className="size-3 text-muted" />
                          <span>{t('checkout.cryptoCopyAmount')}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Сеть */}
                <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-2 border border-stroke/70">
                  <span className="text-xs text-muted block font-medium">Выбранная сеть:</span>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-text font-mono">
                      {currentCrypto.network}
                    </span>
                    <Badge tone="brand" className="text-[10px] font-mono">
                      1 подтверждение
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Адрес депозита */}
              <div className="flex flex-col gap-2 p-4 rounded-xl bg-canvas border border-stroke/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted uppercase tracking-wider font-mono">
                    {t('checkout.cryptoAddress')}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-mono gap-1.5"
                    onClick={() => copyToClipboard(cryptoAddress, setCopiedCryptoAddress)}
                  >
                    {copiedCryptoAddress ? (
                      <>
                        <CheckIcon className="size-3 text-accent" />
                        <span>{t('checkout.cryptoCopied')}</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon className="size-3 text-muted" />
                        <span>{t('checkout.cryptoCopyAddress')}</span>
                      </>
                    )}
                  </Button>
                </div>
                <div className="rounded-lg bg-surface-2 p-2.5 border border-stroke/60 font-mono text-xs text-text break-all select-all">
                  {cryptoAddress}
                </div>
              </div>

              {/* QR-код */}
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-surface-2 border border-stroke/70">
                <div className="relative p-2.5 rounded-xl bg-white shadow-xs shrink-0 border border-slate-200">
                  {cryptoLoading ? (
                    <div className="size-36 flex items-center justify-center text-xs text-slate-500 font-mono">
                      <span className="size-4 animate-spin rounded-full border-2 border-slate-700 border-t-transparent" />
                    </div>
                  ) : (
                    <QrCode
                      value={cryptoQr}
                      size={144}
                      badge={
                        <div className="size-6 flex items-center justify-center rounded-md bg-white shadow-xs">
                          {(() => {
                            const IconComp = currentCrypto.icon;
                            return <IconComp className="size-4" />;
                          })()}
                        </div>
                      }
                    />
                  )}
                </div>

                <div className="flex flex-col gap-2 text-left">
                  <h4 className="text-xs font-bold text-text uppercase tracking-wider font-mono">
                    {t('checkout.cryptoScanQr')}
                  </h4>
                  <p className="text-xs text-muted leading-relaxed">
                    Отсканируйте код в любом кошельке (Trust Wallet, Telegram Wallet, Tonkeeper,
                    Binance, Bybit) для автоматического заполнения адреса и суммы.
                  </p>
                  <p className="text-[11px] text-amber-500 dark:text-amber-400 font-medium">
                    ⚠️ Важно: перевод средств в неверной сети приведет к безвозвратной потере.
                  </p>
                </div>
              </div>

              {/* Опциональный TxID */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="crypto-tx-hash"
                  className="text-xs font-semibold text-muted font-mono"
                >
                  {t('checkout.cryptoTxHash')}
                </label>
                <input
                  id="crypto-tx-hash"
                  type="text"
                  placeholder={t('checkout.cryptoTxHashPlaceholder')}
                  value={txHashInput}
                  onChange={(e) => setTxHashInput(e.target.value)}
                  className="h-10 w-full rounded-xl border border-stroke bg-canvas px-3 text-xs font-mono text-text placeholder:text-muted/60 focus:border-accent focus:outline-none transition-colors"
                />
              </div>

              {/* Кнопка подтверждения */}
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full h-11 font-semibold text-sm rounded-xl shadow-sm"
                disabled={submitting}
                onClick={handleCryptoConfirm}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>{t('checkout.cryptoChecking')}</span>
                  </span>
                ) : (
                  <span>{t('checkout.cryptoConfirm')}</span>
                )}
              </Button>
            </div>
          )}

          {/* ПАНЕЛЬ СПОСОБА 3: TELEGRAM STARS */}
          {paymentMethod === 'stars' && (
            <div className="flex flex-col gap-6 rounded-2xl border border-stroke bg-surface p-6 shadow-sm animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke/60 pb-5">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <StarIcon className="size-5 fill-amber-400 text-amber-400" />
                    <span>Оплата через Telegram Stars</span>
                  </h3>
                  <p className="text-xs text-muted mt-1">
                    Официальная валюта платформы Telegram с мгновенным списанием
                  </p>
                </div>

                <Badge tone="brand" className="text-[10px] self-start sm:self-auto font-mono">
                  Официально
                </Badge>
              </div>

              <Callout tone="info" title={t('checkout.starsOfficial')} className="text-left">
                {t('checkout.starsNotice')}
              </Callout>

              {/* Виджет Stars */}
              <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-gradient-to-b from-amber-500/10 via-surface-2 to-surface-2 border border-amber-500/20 text-center">
                <div className="flex items-center justify-center gap-2.5 text-4xl font-mono font-extrabold text-amber-500">
                  <StarIcon className="size-8 fill-amber-400 text-amber-400 animate-pulse" />
                  <span>{starsAmount}</span>
                  <span className="text-xl font-normal text-muted font-sans">Stars</span>
                </div>
                <p className="text-xs text-muted mt-1">
                  {t('checkout.starsPeriodNotice', {
                    price: `$${plan.priceMonthly}`,
                    plan: t(plan.nameKey),
                  })}
                </p>
              </div>

              {/* QR-код в Telegram */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-medium text-muted">{t('checkout.starsQrHint')}</p>
                <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-xs">
                  {starsLoading ? (
                    <div className="size-40 flex items-center justify-center text-xs text-slate-500 font-mono">
                      {language === 'ru' ? 'Подготовка бота...' : 'Preparing bot...'}
                    </div>
                  ) : (
                    <QrCode
                      value={botDeepLink}
                      size={160}
                      badge={
                        <div className="size-8 flex items-center justify-center rounded-xl bg-[#24A1DE] text-white shadow-xs">
                          <TelegramIcon className="size-5" />
                        </div>
                      }
                    />
                  )}
                </div>
              </div>

              {/* Кнопки перехода в Telegram и подтверждения */}
              <div className="flex flex-col w-full gap-3 pt-2">
                <a
                  href={botDeepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#24A1DE] hover:bg-[#1E96D1] px-4 py-3 text-sm font-semibold text-white transition-colors shadow-sm"
                >
                  <TelegramIcon className="size-5" />
                  <span>{language === 'ru' ? `Оплатить в Telegram (@${botUsername})` : `Pay in Telegram (@${botUsername})`}</span>
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full h-11 font-semibold text-sm rounded-xl"
                  disabled={submitting}
                  onClick={handleStarsConfirm}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span>{t('checkout.starsChecking')}</span>
                    </span>
                  ) : (
                    <span>{t('checkout.starsConfirm')}</span>
                  )}
                </Button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted text-center leading-relaxed">
            {t('checkout.notice')}
          </p>
        </div>

        {/* Правая колонка: сводка заказа (Sticky) */}
        <aside className="lg:sticky lg:top-24 flex flex-col gap-4">
          <Card
            className={cn(
              'flex flex-col gap-5 p-6 border shadow-sm backdrop-blur-md relative overflow-hidden',
              plan.id === 'ultra'
                ? 'border-amber-500/40 bg-surface/90 ring-1 ring-amber-500/20'
                : plan.id === 'pro'
                  ? 'border-indigo-500/40 bg-surface/90 ring-1 ring-indigo-500/20'
                  : 'border-stroke bg-surface/90',
            )}
          >
            {/* Градиентный блик сверху */}
            <div
              className={cn(
                'absolute top-0 left-0 right-0 h-1',
                plan.id === 'ultra'
                  ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500'
                  : plan.id === 'pro'
                    ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-sky-500'
                    : 'bg-gradient-to-r from-sky-500 via-emerald-500 to-sky-500',
              )}
            />

            <div className="flex items-center justify-between border-b border-stroke/60 pb-4">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted">
                {t('checkout.selectedPlan')}
              </span>
              <Badge tone="brand" className="font-mono text-[10px]">
                30 дней
              </Badge>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl font-bold tracking-tight text-text">
                  {t(plan.nameKey)}
                </h2>
                {plan.discountBadge ? (
                  <Badge tone="brand" className="text-[10px] font-bold">
                    {plan.discountBadge[language]}
                  </Badge>
                ) : null}
              </div>

              <p className="text-xs text-muted mt-1.5 leading-relaxed">
                {typeof plan.modelsHighlight === 'string'
                  ? plan.modelsHighlight
                  : plan.modelsHighlight?.[language]}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl bg-canvas p-4 border border-stroke/70 text-xs text-muted">
              <div className="flex items-center justify-between">
                <span>{language === 'ru' ? 'Стоимость тарифа' : 'Plan price'}</span>
                <span className="font-mono text-text font-semibold">
                  {plan.originalPriceMonthly ? (
                    <span className="line-through text-muted mr-1.5">
                      ${plan.originalPriceMonthly}
                    </span>
                  ) : null}
                  ${plan.priceMonthly}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>{language === 'ru' ? 'Комиссия платёжной системы' : 'Processing fee'}</span>
                <span className="font-mono text-accent font-semibold">$0.00</span>
              </div>

              <div className="border-t border-stroke/60 pt-2.5 flex items-center justify-between text-base font-bold text-text">
                <span>{language === 'ru' ? 'Итого к оплате' : 'Total due'}</span>
                <span className="font-mono text-accent">${plan.priceMonthly}</span>
              </div>
            </div>

            {/* Включённые преимущества */}
            <div className="space-y-2 pt-1 border-t border-stroke/50">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-mono block">
                {language === 'ru' ? 'В подписку входит:' : 'Included:'}
              </span>
              <ul className="text-xs text-muted space-y-1.5">
                <li className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-accent shrink-0" />
                  <span>Полный доступ ко всем заявленным моделям</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-accent shrink-0" />
                  <span>Приоритетная генерация без очередей</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-accent shrink-0" />
                  <span>Контекст до 120 сообщений</span>
                </li>
              </ul>
            </div>

            {/* Блок безопасности */}
            <div className="flex items-center gap-2.5 pt-2 text-[11px] text-muted">
              <ShieldIcon className="text-accent shrink-0 text-base" />
              <span>Безопасное соединение TLS 1.3 · Мгновенный доступ</span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
