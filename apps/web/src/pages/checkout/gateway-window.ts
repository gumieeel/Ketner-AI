/**
 * Платёжная страница Trybit запрещает встраивание во frame (X-Frame-Options: SAMEORIGIN),
 * поэтому открываем её как окно-виджет поверх сайта и закрываем, когда оплата подтвердилась.
 */
let gatewayWindow: Window | null = null;

export function openGatewayWindow(url: string): void {
  const width = 460;
  const height = 780;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener=no`;
  const opened = window.open(url, 'ketner-trybit-pay', features);
  if (opened) {
    gatewayWindow = opened;
    opened.focus?.();
    return;
  }
  // Браузер заблокировал окно (например, внутри Telegram) — открываем обычной вкладкой.
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function closeGatewayWindow(): void {
  try {
    gatewayWindow?.close();
  } catch {
    // окно уже закрыто или недоступно
  }
  gatewayWindow = null;
}
