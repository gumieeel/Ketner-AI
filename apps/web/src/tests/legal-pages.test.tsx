import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

describe('правовые страницы и контакты', () => {
  beforeEach(() => {
    resetAuth();
    resetChat();
    resetPreferences();
    installFakeApi();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['/privacy', 'Политика конфиденциальности'],
    ['/terms', 'Пользовательское соглашение и оферта'],
    ['/payment-terms', 'Оплата и возврат'],
  ])('%s открывается, показывает заголовок и почту поддержки', (path, title) => {
    renderRoute(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: 'ketner.support@gmail.com' }).length,
    ).toBeGreaterThan(0);
  });

  it('условия возврата называют окно в 24 часа и правило про нетронутые кредиты пакета', () => {
    renderRoute('/payment-terms');
    expect(
      screen.getByText(/не более 24 часов и вы не потратили кредиты этого пакета/),
    ).toBeInTheDocument();
  });

  it('форма обратной связи отправляет обращение', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/contacts');

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } });
    fireEvent.change(screen.getByLabelText('Почта для ответа'), {
      target: { value: 'anna@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Сообщение'), {
      target: { value: 'Не пришёл чек после оплаты' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('anna@example.com'));
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
      url.endsWith('/contact'),
    );
    expect(JSON.parse(String(call?.[1].body))).toMatchObject({
      name: 'Анна',
      email: 'anna@example.com',
    });
  });

  it('в футере есть ссылки на правовые страницы', () => {
    renderRoute('/contacts');
    for (const [name, href] of [
      ['Соглашение и оферта', '/terms'],
      ['Конфиденциальность', '/privacy'],
      ['Оплата и возврат', '/payment-terms'],
    ] as const) {
      expect(
        screen.getAllByRole('link', { name }).some((link) => link.getAttribute('href') === href),
      ).toBe(true);
    }
  });
});
