import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { getPlan } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';

/**
 * Оформление подписки.
 *
 * Этап 1 — форма без обработки платежа. Маски ввода и смена статуса подписки
 * появляются на этапе 4; контракт эндпоинтов — в docs/payment-integration-todo.md.
 */
export function CheckoutPage() {
  const { t } = useTranslation();
  const { planId } = useParams<{ planId: string }>();
  const plan = getPlan(planId);
  const [submitted, setSubmitted] = useState(false);

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

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <Field id="card-number" label={t('checkout.cardNumber')}>
          {({ id, invalid, 'aria-describedby': describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4242 4242 4242 4242"
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field id="card-expiry" label={t('checkout.expiry')}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="12 / 30"
              />
            )}
          </Field>

          <Field id="card-cvc" label={t('checkout.cvc')}>
            {({ id, invalid, 'aria-describedby': describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
              />
            )}
          </Field>
        </div>

        <Button type="submit" size="lg" className="w-full">
          {t('checkout.pay')}
        </Button>
      </form>

      {submitted ? (
        <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('checkout.notice')}
        </p>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('checkout.notice')}</p>
      )}
    </div>
  );
}
