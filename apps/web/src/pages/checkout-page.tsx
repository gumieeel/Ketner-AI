import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { useBilling } from '@/features/billing/billing-store';
import { getPlan } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import {
  formatCardCvc,
  formatCardExpiry,
  formatCardNumber,
  validateCardCvc,
  validateCardExpiry,
  validateCardNumber,
} from '@/lib/card-mask';

/**
 * Оформление подписки.
 * Маски ввода номера карты, срока и CVC, валидация и экран подтверждения.
 */
export function CheckoutPage() {
  const { t } = useTranslation();
  const { planId } = useParams<{ planId: string }>();
  const plan = getPlan(planId);
  const checkout = useBilling((state) => state.checkout);

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');

  const [errors, setErrors] = useState<{
    cardNumber?: string;
    expiry?: string;
    cvc?: string;
    general?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const newErrors: typeof errors = {};
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
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      await checkout(plan.id);
      setSuccess(true);
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : 'Ошибка при оформлении подписки',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-16 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-accent/20 text-accent">
          <CheckIcon className="text-3xl" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {t('checkout.successTitle')}
          </h1>
          <p className="text-sm text-muted">{t('checkout.successMessage')}</p>
        </div>

        <Card className="flex w-full items-center justify-between text-left">
          <div>
            <CardTitle>{t(plan.nameKey)}</CardTitle>
            <CardText className="mt-1 text-xs text-accent">{t('settings.statusActive')}</CardText>
          </div>
          <p className="text-xl font-semibold text-text">
            ${plan.priceMonthly}
            <span className="ml-1 text-xs font-normal text-muted">{t('pricing.month')}</span>
          </p>
        </Card>

        <div className="flex w-full gap-3">
          <Link to="/chat" className="flex-1">
            <Button className="w-full">{t('checkout.goToChat')}</Button>
          </Link>
          <Link to="/settings" className="flex-1">
            <Button variant="outline" className="w-full">
              {t('checkout.goToSettings')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{t('checkout.title')}</h1>

      <Card className="flex items-center justify-between gap-4">
        <div>
          <CardTitle>{t(plan.nameKey)}</CardTitle>
          <CardText className="mt-1">{t('checkout.selectedPlan')}</CardText>
        </div>
        <p className="text-2xl font-semibold">
          ${plan.priceMonthly}
          <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
            {t('pricing.month')}
          </span>
        </p>
      </Card>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {errors.general ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {errors.general}
          </div>
        ) : null}

        <Field id="card-number" label={t('checkout.cardNumber')} error={errors.cardNumber}>
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
                if (errors.cardNumber) {
                  setErrors((prev) => ({ ...prev, cardNumber: undefined }));
                }
              }}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field id="card-expiry" label={t('checkout.expiry')} error={errors.expiry}>
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
                  if (errors.expiry) {
                    setErrors((prev) => ({ ...prev, expiry: undefined }));
                  }
                }}
              />
            )}
          </Field>

          <Field id="card-cvc" label={t('checkout.cvc')} error={errors.cvc}>
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
                  if (errors.cvc) {
                    setErrors((prev) => ({ ...prev, cvc: undefined }));
                  }
                }}
              />
            )}
          </Field>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? t('checkout.processing') : t('checkout.pay')}
        </Button>
      </form>

      <p className="text-xs text-muted">{t('checkout.notice')}</p>
    </div>
  );
}
