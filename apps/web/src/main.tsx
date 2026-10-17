import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { captureAttribution } from './lib/attribution';
import './index.css';

// Источник посетителя (utm, сайт-источник) — до того, как роутер уберёт или сменит адрес.
captureAttribution();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден контейнер #root для монтирования приложения');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
