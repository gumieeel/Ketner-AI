import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
import { RELEASES } from './src/features/content/changelog';
import { FAQ_ITEMS } from './src/features/content/faq';

/**
 * Кладёт в сборку seo-faq.json: вопросы и ответы с главной и дату последнего релиза (для lastmod /changelog). Сервер берёт их для разметки FAQPage
 * и текста для краулеров, чтобы тексты не дублировались в двух местах.
 */
function emitSeoFaq(): Plugin {
  return {
    name: 'emit-seo-faq',
    generateBundle() {
      const pick = (language: 'ru' | 'en') =>
        FAQ_ITEMS.map((item) => ({ q: item.q[language], a: item.a[language] }));
      this.emitFile({
        type: 'asset',
        fileName: 'seo-faq.json',
        source: JSON.stringify({
          ru: pick('ru'),
          en: pick('en'),
          changelogDate: RELEASES.map((release) => release.date)
            .sort()
            .at(-1),
        }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), emitSeoFaq()],
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
