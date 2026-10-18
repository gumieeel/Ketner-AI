import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { AuthProvider } from '@/features/auth/auth-provider';
import { RELEASES } from '@/features/content/changelog';
import { FAQ_ITEMS } from '@/features/content/faq';
import { LEGAL_DOCUMENTS, LEGAL_UPDATED } from '@/features/content/legal';
import { usePreferences } from '@/features/preferences/preferences-store';
import { isEnPath } from '@/lib/locale-path';
import { SEO_PAGES } from '@/lib/seo-pages';
import { routes } from '@/router/routes';

/**
 * Предварительная отрисовка открытых страниц для поисковиков (запускает scripts/prerender.mjs).
 *
 * Поисковый робот, особенно Яндекс, часто индексирует только исходный HTML. Без этого у SPA в `<body>`
 * пустой `<div id="root">`: ни текста, ни внутренних ссылок. Здесь та же страница, что видит
 * гость (русский язык, тёмная тема), рендерится в HTML при сборке; сервер вставляет её в `#root`,
 * а браузер после загрузки скриптов заменяет её живым приложением (main.tsx).
 */

/** Адреса для отрисовки — все открытые страницы из seo-pages.json. */
export const PRERENDER_PATHS: readonly string[] = SEO_PAGES.map((page) => page.path);

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «18 октября 2026 г.» → «2026-10-18». Не разобралась дата — ошибка: сборка не должна выкатить неверный lastmod. */
function isoFromRussianDate(value: string): string {
  const match = /^(\d{1,2}) (\S+) (\d{4})/.exec(value);
  const month = match ? RU_MONTHS.indexOf(match[2]) : -1;
  if (!match || month === -1) throw new Error(`prerender: не разобрана дата «${value}»`);
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/**
 * Настоящие даты изменения страниц для <lastmod> в sitemap.xml: последний выпуск в журнале обновлений
 * и редакции правовых текстов. У остальных страниц даты нет, и sitemap её не пишет.
 */
export const PAGE_LASTMODS: Readonly<Record<string, string>> = {
  '/changelog': RELEASES.map((release) => release.date).reduce((a, b) => (a > b ? a : b)),
  ...Object.fromEntries(
    Object.values(LEGAL_DOCUMENTS).map((doc) => [
      doc.path,
      isoFromRussianDate(doc.updated ?? LEGAL_UPDATED),
    ]),
  ),
};

/** JSON для <script type="application/ld+json">: `<` экранируется, чтобы строка не закрыла тег. */
function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Разметка вопросов и ответов (Schema.org FAQPage) — те же вопросы, что на главной. */
function faqHead(language: 'ru' | 'en'): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q[language],
      acceptedAnswer: { '@type': 'Answer', text: item.a[language] },
    })),
  };
  return `<script type="application/ld+json">${jsonLd(data)}</script>`;
}

export async function render(url: string): Promise<{ html: string; head: string; status: number }> {
  // Язык берётся из адреса: в Node эффекты не выполняются, и useLocaleSync не успел бы его включить.
  // При серверной отрисовке zustand отдаёт компонентам не текущее, а начальное состояние, поэтому язык
  // меняем и в нём (код работает только при сборке, в браузере entry-prerender не подключается).
  const language = isEnPath(url) ? 'en' : 'ru';
  Object.assign(usePreferences.getInitialState(), { language });
  usePreferences.setState({ language });
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(url, 'https://ketner.org')));
  if (context instanceof Response) {
    return { html: '', head: '', status: context.status };
  }
  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(
    <StrictMode>
      <AuthProvider>
        <ThemeSync>
          <StaticRouterProvider router={router} context={context} hydrate={false} />
        </ThemeSync>
      </AuthProvider>
    </StrictMode>,
  );
  const head = url === '/' || url === '/en' ? faqHead(language) : '';
  return { html, head, status: context.statusCode };
}
