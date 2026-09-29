import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден контейнер #root для монтирования приложения');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
