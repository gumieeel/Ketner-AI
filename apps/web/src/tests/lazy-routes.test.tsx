import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSync } from '@/app/theme-sync';
import { routes } from '@/router/routes';
import { installFakeApi } from './fake-api';
import { resetAuth, resetChat, resetPreferences } from './test-utils';

/** Настоящие маршруты приложения, без предзагрузки из test-utils: страница приходит отдельным чанком. */
function renderAppRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeSync>
      <RouterProvider router={router} />
    </ThemeSync>,
  );
}

describe('ленивая загрузка страниц', () => {
  beforeEach(() => {
    resetAuth();
    resetChat();
    resetPreferences();
    installFakeApi();
  });
  afterEach(() => vi.restoreAllMocks());

  it('правовая страница подгружается и открывается со своим документом', async () => {
    renderAppRoute('/terms');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Пользовательское соглашение и оферта',
      }),
    ).toBeInTheDocument();
  });

  it('экран чата подгружается внутри каркаса приложения', async () => {
    renderAppRoute('/chat');
    expect(await screen.findByPlaceholderText('Спросите что-нибудь…')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Чаты' })).toBeInTheDocument();
  });
});
