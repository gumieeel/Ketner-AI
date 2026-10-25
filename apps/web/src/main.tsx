import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, router } from './App';
import { captureAttribution } from './lib/attribution';
import './index.css';

// Источник посетителя (utm, сайт-источник) — до того, как роутер уберёт или сменит адрес.
captureAttribution();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден контейнер #root для монтирования приложения');
}

/**
 * Открытые страницы приходят с сервера уже с разметкой в #root (для поисковиков, см. entry-prerender).
 * React заменит её при первой отрисовке, поэтому сначала дожидаемся кода текущей страницы: иначе
 * между готовой разметкой и приложением мелькнул бы пустой экран.
 */
function whenRouterReady(): Promise<void> {
  if (!container?.firstElementChild || router.state.initialized) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = router.subscribe((state) => {
      if (!state.initialized) return;
      unsubscribe();
      resolve();
    });
  });
}

void whenRouterReady().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
