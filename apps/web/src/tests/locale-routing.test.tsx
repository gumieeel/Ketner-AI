import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferences } from '@/features/preferences/preferences-store';
import { renderRoute, resetPreferences } from './test-utils';

describe('английская версия страниц', () => {
  beforeEach(() => {
    resetPreferences();
  });

  it('адрес /en/pricing включает английский язык и заголовок вкладки', async () => {
    renderRoute('/en/pricing');
    await waitFor(() => expect(usePreferences.getState().language).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toMatch(/^Ketner AI pricing/);
    expect(
      screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/en/docs'),
    ).toBe(true);
  });

  it('русский адрес с сохранённым английским ведёт на /en', async () => {
    usePreferences.setState({ language: 'en' });
    renderRoute('/pricing');
    await waitFor(() => expect(document.title).toMatch(/^Ketner AI pricing/));
  });

  it('переключатель языка меняет и адрес, и язык', async () => {
    renderRoute('/en/pricing');
    await waitFor(() => expect(usePreferences.getState().language).toBe('en'));
    fireEvent.click(screen.getAllByRole('button', { name: 'RU' })[0]);
    await waitFor(() => expect(document.title).toMatch(/^Тарифы Ketner AI/));
    expect(usePreferences.getState().language).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    fireEvent.click(screen.getAllByRole('button', { name: 'EN' })[0]);
    await waitFor(() => expect(document.title).toMatch(/^Ketner AI pricing/));
  });

  it('страница без английской версии остаётся на своём адресе', async () => {
    usePreferences.setState({ language: 'en' });
    renderRoute('/terms');
    await waitFor(() => expect(document.title).not.toMatch(/pricing/));
    expect(usePreferences.getState().language).toBe('en');
  });
});
