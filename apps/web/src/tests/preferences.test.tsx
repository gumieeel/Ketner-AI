import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute, resetPreferences } from './test-utils';

describe('тема и язык интерфейса', () => {
  beforeEach(() => {
    resetPreferences();
  });

  it('по умолчанию включена тёмная тема', () => {
    renderRoute('/chat');

    expect(document.documentElement).toHaveClass('dark');
  });

  it('переключение темы меняет разметку и сохраняется в браузере', async () => {
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.click(screen.getAllByRole('button', { name: /Тема:/ })[0]);

    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('ketner.theme')).toBe('light');
  });

  it('выбранный язык переключает подписи интерфейса', async () => {
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.click(screen.getByRole('button', { name: 'EN' }));

    expect(
      screen.getByRole('heading', { level: 2, name: 'What can I help with today?' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('ketner.language')).toBe('en');
  });
});
