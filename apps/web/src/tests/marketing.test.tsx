import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';
import { setProductSwitchesForTests } from '@/lib/product-switches';

// Закрытые возможности (lib/product-switches.ts): здесь проверяется их спящий код.
setProductSwitchesForTests({ chat: true });

describe('marketing: лендинг, шапка, футер и пакеты кредитов', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });

  it('лендинг содержит ровно один h1 и все ключевые секции', () => {
    renderRoute('/');

    const h1Headings = screen.getAllByRole('heading', { level: 1 });
    expect(h1Headings).toHaveLength(1);
    expect(h1Headings[0]).toHaveAccessibleName('Все сильные модели без подписки');

    // Проверяем наличие карточек моделей и секций
    expect(screen.getAllByText(/GPT-6\.1 Sol/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Claude Opus 5\.5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GPT-6 Astra/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DeepSeek V4\.1 Flash/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ketner Pro/).length).toBeGreaterThan(0);

    // Моделей, которых нет в каталоге, на лендинге быть не должно
    expect(screen.queryByText(/Gemini 3\.8|GPT-4o|Ketner Next/)).toBeNull();

    // Пять пакетов кредитов — заголовки третьего уровня внутри секции «Кредиты»
    expect(screen.getByRole('heading', { level: 2, name: 'Кредиты' })).toBeInTheDocument();
    for (const price of ['$5', '$10', '$25', '$50', '$100']) {
      expect(screen.getByRole('heading', { level: 3, name: price })).toBeInTheDocument();
    }
    // Подписочных тарифов на лендинге нет
    expect(screen.queryByRole('heading', { level: 3, name: /^(Plus|Pro|Ultra)$/ })).toBeNull();

    // FAQ аккордеон
    expect(screen.getByText('Как работают кредиты?')).toBeInTheDocument();
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

  it('страница /pricing отображает пять пакетов и сравнение уровней', () => {
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Кредиты' })).toBeInTheDocument();
    expect(screen.getByTestId('pack-list').children).toHaveLength(5);
    expect(screen.getByText('Что меняется после первой покупки')).toBeInTheDocument();
    expect(screen.getByText('Без покупок')).toBeInTheDocument();
    expect(screen.getByText('Есть купленные кредиты')).toBeInTheDocument();
  });
});
