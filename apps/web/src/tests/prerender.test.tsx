import { PRERENDER_PATHS, render } from '@/entry-prerender';
import { seoTitleFor } from '@/lib/seo-pages';

/**
 * Открытые страницы отрисовываются в HTML при сборке (scripts/prerender.mjs). Если страница начнёт
 * обращаться к window или localStorage при отрисовке, сборка на Render упадёт — тест ловит это раньше.
 */
describe('предварительная отрисовка для поисковиков', () => {
  it('каждая открытая страница отрисовывается с заголовком h1', async () => {
    expect(PRERENDER_PATHS).toContain('/');
    expect(PRERENDER_PATHS).toContain('/pricing');
    for (const path of PRERENDER_PATHS) {
      const { html, status } = await render(path);
      expect(status, path).toBe(200);
      expect(html, path).toMatch(/<h1[\s>]/);
      expect(html, path).not.toMatch(/Страница не найдена/);
    }
  });

  it('главная получает разметку вопросов и ответов', async () => {
    const { head, html } = await render('/');
    expect(head).toContain('"@type":"FAQPage"');
    expect(html).toContain('href="/pricing"');
  });

  it('заголовок вкладки берётся из того же списка, что у сервера', () => {
    expect(seoTitleFor('/pricing/')).toMatch(/^Тарифы Ketner AI/);
    expect(seoTitleFor('/chat')).toBeUndefined();
  });
});
