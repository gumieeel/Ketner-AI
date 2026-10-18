/**
 * Предварительная отрисовка открытых страниц (лендинг, тарифы, модели, документация, правовые…).
 *
 * Запускается после `vite build` (см. "build" в package.json):
 * 1. собирает src/entry-prerender.tsx для Node в dist-ssr/ (не публикуется);
 * 2. рендерит каждую страницу из seo-pages.json в HTML;
 * 3. пишет dist/.prerender.json — сервер (apps/mock-api/src/seo/pages.ts) вставляет разметку в `#root`.
 *
 * Файл начинается с точки, поэтому express.static его не отдаёт. Если отрисовка страницы падает,
 * сборка останавливается: лучше заметить это сразу, чем выкатить сайт без разметки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ssrDir = path.join(root, 'dist-ssr');
const outFile = path.join(root, 'dist', '.prerender.json');

await build({
  root,
  logLevel: 'warn',
  build: {
    ssr: 'src/entry-prerender.tsx',
    outDir: ssrDir,
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
  },
});

const { render, PRERENDER_PATHS } = await import(
  pathToFileURL(path.join(ssrDir, 'entry-prerender.js')).href
);

const pages = {};
let totalBytes = 0;
for (const pagePath of PRERENDER_PATHS) {
  const { html, head, status } = await render(pagePath);
  if (status !== 200 || !html) {
    throw new Error(`prerender: ${pagePath} → статус ${status}, разметка пустая`);
  }
  pages[pagePath] = head ? { html, head } : { html };
  totalBytes += html.length;
}

fs.writeFileSync(outFile, JSON.stringify({ pages }));
fs.rmSync(ssrDir, { recursive: true, force: true });
console.log(
  `prerender: ${PRERENDER_PATHS.length} страниц, ${Math.round(totalBytes / 1024)} КБ разметки → dist/.prerender.json`,
);
