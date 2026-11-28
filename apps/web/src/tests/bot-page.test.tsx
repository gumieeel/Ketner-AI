import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from './test-utils';

describe('/bot', () => {
  it('объясняет владельцу сайта, кто его читает: robots.txt, до 10 страниц, User-Agent, ссылка на политику', async () => {
    renderRoute('/bot');
    expect(await screen.findByRole('heading', { level: 1, name: 'KetnerBot' })).toBeVisible();
    expect(screen.getByText(/Не больше 10 страниц за раз/)).toBeVisible();
    expect(screen.getByText('KetnerBot/1.0 (+https://ketner.org/bot)')).toBeVisible();
    expect(screen.getByRole('link', { name: 'политике конфиденциальности' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});
