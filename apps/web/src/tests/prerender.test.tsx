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

  it('английские страницы отрисовываются на английском, русские после них — снова на русском', async () => {
    expect(PRERENDER_PATHS).toEqual(expect.arrayContaining(['/en', '/en/pricing', '/en/docs/api']));
    const en = await render('/en');
    expect(en.head).toContain('"@type":"FAQPage"');
    expect(en.head).not.toMatch(/[А-Яа-яЁё]/);
    expect(en.html).toContain('href="/en/pricing"');
    const enPricing = await render('/en/pricing');
    expect(enPricing.html).toMatch(/<h1[^>]*>[^<]*Pricing/i);
    expect(enPricing.html).toContain('href="/en/docs"');
    const ru = await render('/pricing');
    expect(ru.html).toMatch(/<h1[^>]*>Тарифы/);
    expect(ru.html).toContain('href="/docs"');
    expect(ru.html).not.toContain('href="/en/');
  });

  it('заголовок вкладки берётся из того же списка, что у сервера', () => {
    expect(seoTitleFor('/en/pricing')).toMatch(/^Ketner AI pricing/);
    expect(seoTitleFor('/pricing/')).toMatch(/^Тарифы Ketner AI/);
    expect(seoTitleFor('/chat')).toBeUndefined();
  });
});
