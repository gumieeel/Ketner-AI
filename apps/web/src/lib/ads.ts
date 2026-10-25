/** Тег Google Ads (gtag.js подключается в index.html). */
export const GOOGLE_ADS_ID = 'AW-18517322078';

type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]): void {
  const fn = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch {
    // реклама не должна ломать оплату
  }
}

/**
 * Покупка на сайте: просмотр страницы /checkout/success (цель «Покупка» по URL)
 * и событие purchase с суммой.
 */
export function trackPurchase(purchase: { id: string; item: string; valueUsd: number }): void {
  gtag('event', 'page_view', {
    send_to: GOOGLE_ADS_ID,
    page_location: window.location.href,
    page_path: window.location.pathname,
  });
  gtag('event', 'purchase', {
    send_to: GOOGLE_ADS_ID,
    transaction_id: purchase.id,
    value: purchase.valueUsd,
    currency: 'USD',
    items: [{ item_id: purchase.item, price: purchase.valueUsd, quantity: 1 }],
  });
}
