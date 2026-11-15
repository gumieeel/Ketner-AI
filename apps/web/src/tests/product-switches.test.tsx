import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { setSiteFeatures } from '@/lib/features';
import { appHomePath, PRODUCT_SWITCHES, productSwitch } from '@/lib/product-switches';
import { SEO_PAGES } from '@/lib/seo-pages';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

/**
 * Продукт таким, каким его видят сейчас (решения владельца 14.11.2026): звёзды, чат, Code, картинки,
 * API, проверка и сравнение ответов закрыты. Здесь переключатели не меняются — это production.
 */
describe('закрытые возможности на сайте', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: false });
  });
  afterEach(() => setSiteFeatures(null));

  it('всё закрыто, вход ведёт к решениям', () => {
    expect(Object.values(PRODUCT_SWITCHES).every((open) => !open)).toBe(true);
    expect(productSwitch('chat')).toBe(false);
    expect(appHomePath()).toBe('/solutions');
  });

  it.each([
    ['/chat', 'Чат временно недоступен'],
    ['/chat/abc-123', 'Чат временно недоступен'],
    ['/code', 'Ketner Code временно недоступен'],
    ['/images', 'Генерация картинок временно недоступна'],
    ['/api-docs', 'API для разработчиков временно недоступен'],
    ['/developers', 'API для разработчиков временно недоступен'],
    ['/docs/api', 'API для разработчиков временно недоступен'],
    ['/models', 'Чат временно недоступен'],
    ['/docs', 'Чат временно недоступен'],
    ['/docs/plans/pro', 'Чат временно недоступен'],
  ])('%s: «временно недоступно» и путь к решениям', async (path, title) => {
    renderRoute(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    const toSolutions = screen
      .getAllByRole('link', { name: 'Мои автоматизации' })
      .map((link) => link.getAttribute('href'));
    expect(toSolutions).toContain('/solutions');
    // Чат закрыт — ни композера, ни списка диалогов.
    expect(screen.queryByPlaceholderText('Спросите что-нибудь…')).not.toBeInTheDocument();
  });

  it('главная — платформа решений, без входов в чат, Code, картинки, документацию и API', async () => {
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Расскажите о своём бизнесе/ }),
    ).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    for (const closed of ['/chat', '/code', '/images', '/models', '/docs', '/docs/api']) {
      expect(hrefs.filter((href) => href === closed || href.startsWith(`${closed}#`))).toEqual([]);
    }
  });

  it('страница кредитов: без звёзд, без чата и без вопросов о моделях', async () => {
    renderRoute('/pricing');
    expect(await screen.findByRole('heading', { level: 1, name: 'Кредиты' })).toBeInTheDocument();
    expect(screen.queryByText(/⭐/)).not.toBeInTheDocument();
    expect(screen.queryByText(/звёзд/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Частые вопросы' })).not.toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs).not.toContain('/chat');
    expect(hrefs).not.toContain('/docs');
    expect(hrefs).not.toContain('/models');
    expect(document.body.textContent).not.toMatch(/Ketner Code|Claude|в чате/);
    // Пакеты по-прежнему продаются (это меняет отдельная задача).
    expect(screen.getAllByRole('link', { name: 'Купить' }).length).toBe(5);
  });

  it('сводка известных ограничений и SEO-страницы — без закрытых разделов', () => {
    expect(KNOWN_ISSUES.some((issue) => issue.feature)).toBe(false);
    const paths = SEO_PAGES.map((page) => page.path);
    for (const closed of ['/models', '/docs', '/docs/plans/pro', '/docs/api']) {
      expect(paths).not.toContain(closed);
    }
    expect(paths).toContain('/pricing');
  });
});
