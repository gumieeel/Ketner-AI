import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { AuthProvider } from '@/features/auth/auth-provider';
import { FAQ_ITEMS } from '@/features/content/faq';
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

/** JSON для <script type="application/ld+json">: `<` экранируется, чтобы строка не закрыла тег. */
function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Разметка вопросов и ответов (Schema.org FAQPage) — те же вопросы, что на главной. */
function faqHead(): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q.ru,
      acceptedAnswer: { '@type': 'Answer', text: item.a.ru },
    })),
  };
  return `<script type="application/ld+json">${jsonLd(data)}</script>`;
}

export async function render(url: string): Promise<{ html: string; head: string; status: number }> {
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
  const head = url === '/' ? faqHead() : '';
  return { html, head, status: context.statusCode };
}
