import type { MiniAppPayment } from '@/features/telegram/api';
import type { TranslationKey } from '@/i18n';

/** Есть ли у платежа заявка на возврат (поданная клиентом или оформленная автоматически). */
export function hasRefundCase(payment: MiniAppPayment): boolean {
  return Boolean(payment.refund?.requestedAt) && payment.status !== 'paid';
}

/** Короткая строка о ходе заявки — для списка заявок. */
export function refundCaseSummary(
  payment: MiniAppPayment,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const last = payment.refund?.messages?.at(-1);
  if (last?.from === 'admin' && payment.status === 'refund_requested') return t('tg.caseNewReply');
  if (payment.status === 'refund_requested') return t('tg.caseWaiting');
  if (payment.status === 'refunded')
    return payment.refund?.auto ? t('tg.caseDoneAuto') : t('tg.caseDoneHint');
  return payment.refund?.note
    ? t('tg.caseDeclinedNote', { note: payment.refund.note })
    : t('tg.caseDeclinedHint');
}
