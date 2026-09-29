import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

describe('marketing: лендинг, шапка, футер и тарифные карточки', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });

  it('лендинг содержит ровно один h1 и все ключевые секции', () => {
    renderRoute('/');

    const h1Headings = screen.getAllByRole('heading', { level: 1 });
    expect(h1Headings).toHaveLength(1);
    expect(h1Headings[0]).toHaveAccessibleName('Ketner AI');

    // Проверяем наличие карточек моделей и секций
    expect(screen.getAllByText(/GPT-6/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Claude (Opus|Fable)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DeepSeek/i).length).toBeGreaterThan(0);

    // 4 тарифа
    expect(screen.getByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Plus' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ultra' })).toBeInTheDocument();

    // FAQ аккордеон
    expect(screen.getByText('Это правда безлимитно?')).toBeInTheDocument();
  });

  it('мобильное меню открывается по клику и закрывается по Escape', () => {
    renderRoute('/');

    // Кнопка открытия мобильного меню
    const openMenuButton = screen.getByRole('button', { name: 'Открыть меню' });
    expect(openMenuButton).toBeInTheDocument();

    // Открываем меню
    fireEvent.click(openMenuButton);

    const dialog = screen.getByRole('dialog', { name: 'Навигация' });
    expect(dialog).toBeInTheDocument();

    // Нажимаем Escape для закрытия
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Навигация' })).not.toBeInTheDocument();
  });

  it('страница /pricing отображает 4 карточки и матрицу сравнения', () => {
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Тарифы' })).toBeInTheDocument();
    expect(screen.getByText('Сравнение возможностей')).toBeInTheDocument();
    expect(screen.getByText('Тариф Free')).toBeInTheDocument();
    expect(screen.getByText('Тариф Pro')).toBeInTheDocument();
  });
});
