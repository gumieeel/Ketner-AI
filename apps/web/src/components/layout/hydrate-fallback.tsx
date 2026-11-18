/**
 * Пока при первом открытии грузится код страницы (lazy), роутер показывает это: ровный фон без
 * текста. Без него React Router предупреждал «No HydrateFallback element provided».
 */
export function HydrateFallback() {
  return <div aria-busy="true" className="min-h-dvh bg-canvas" />;
}
