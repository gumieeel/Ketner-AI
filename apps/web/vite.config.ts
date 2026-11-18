import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Стили — первыми в <head>. Vite ставит <link rel="stylesheet"> после главного модуля и его
 * modulepreload; стиль блокирует первую отрисовку, и на медленной сети он делил канал со скриптами:
 * готовая разметка страницы уже была в HTML, а экран оставался пустым секунды.
 */
function stylesFirst(): Plugin {
  return {
    name: 'ketner-styles-first',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const styles = html.match(/^\s*<link rel="stylesheet"[^>]*>\n?/gm) ?? [];
        if (styles.length === 0) return html;
        let rest = html;
        for (const tag of styles) rest = rest.replace(tag, '');
        const firstScript = rest.search(/^\s*<(script type="module"|link rel="modulepreload")/m);
        if (firstScript === -1) return html;
        return rest.slice(0, firstScript) + styles.join('') + rest.slice(firstScript);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stylesFirst()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // OpenAI-совместимый API для CLI и редакторов
      '/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    testTimeout: 25000,
    fileParallelism: false,
  },
});
