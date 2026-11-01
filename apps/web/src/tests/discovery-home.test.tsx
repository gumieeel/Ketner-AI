import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_TEXT_MAX, readDraft } from '@/features/discovery/draft';
import { DISCOVERY_EXAMPLES } from '@/features/discovery/examples';
import { setSiteFeatures, siteFeatures } from '@/lib/features';
import { seoTitleFor } from '@/lib/seo-pages';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const HOME_TITLE = 'Что вы хотите улучшить?';

describe('главная платформы решений (DISCOVERY_ENABLED)', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('один h1, подзаголовок, поле, кнопка и четыре примера; без витрины агрегатора', () => {
    renderRoute('/');

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName(HOME_TITLE);
    expect(
      screen.getByText(/Расскажите о своей работе, бизнесе, учёбе или личных целях/),
    ).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Опишите задачу' });
    expect(field).toHaveAttribute(
      'placeholder',
      'Расскажите о своём деле или работе — или вставьте ссылку на сайт...',
    );
    expect(screen.getByRole('button', { name: 'Найти возможности' })).toBeInTheDocument();

    const examples = within(screen.getByRole('group', { name: 'Примеры задач' })).getAllByRole(
      'button',
    );
    expect(examples.map((button) => button.textContent)).toEqual([
      'Автоматизировать работу',
      'Развить проект',
      'Создавать контент',
      'Улучшить обучение',
    ]);

    // Каталог моделей, пакеты и FAQ остались на /models и /pricing.
    expect(screen.queryByRole('heading', { level: 2, name: 'Кредиты' })).toBeNull();
    expect(screen.queryByText('Как работают кредиты?')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Все сильные модели без подписки' })).toBeNull();
  });

  it('пример подставляет свой текст в поле, его можно поправить', () => {
    renderRoute('/');
    const field = screen.getByRole('textbox', { name: 'Опишите задачу' });

    fireEvent.click(screen.getByRole('button', { name: 'Развить проект' }));
    const example = DISCOVERY_EXAMPLES.find((item) => item.id === 'grow')!;
    expect(field).toHaveValue(example.text.ru);

    fireEvent.change(field, { target: { value: `${example.text.ru} Продаю через сайт.` } });
    expect(field).toHaveValue(`${example.text.ru} Продаю через сайт.`);
  });

  it('пустое описание не отправляется и объясняет, что написать', () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('button', { name: 'Найти возможности' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Напишите хотя бы пару предложений о задаче.',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(HOME_TITLE);
  });

  it('слишком длинное описание не отправляется, лимит назван', () => {
    renderRoute('/');
    const field = screen.getByRole('textbox', { name: 'Опишите задачу' });
    fireEvent.change(field, { target: { value: 'а'.repeat(DISCOVERY_TEXT_MAX + 12) } });

    expect(screen.getByRole('alert')).toHaveTextContent(/на 12/);
    fireEvent.click(screen.getByRole('button', { name: 'Найти возможности' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(HOME_TITLE);
  });

  it('описание сохраняется черновиком и ведёт на страницу начала анализа', async () => {
    const first = renderRoute('/');
    const field = screen.getByRole('textbox', { name: 'Опишите задачу' });
    fireEvent.change(field, { target: { value: 'Веду учёт заказов в таблице вручную.' } });
    expect(readDraft()?.text).toBe('Веду учёт заказов в таблице вручную.');

    // Черновик переживает перезагрузку страницы.
    first.unmount();
    renderRoute('/');
    expect(screen.getByRole('textbox', { name: 'Опишите задачу' })).toHaveValue(
      'Веду учёт заказов в таблице вручную.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Найти возможности' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Проверим, где ИИ поможет' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Веду учёт заказов в таблице вручную.')).toBeInTheDocument();
  });

  it('шапка платформы: анализы, помощники, чат, модели и кредиты', () => {
    renderRoute('/');
    const nav = screen.getAllByRole('navigation', { name: 'Навигация' })[0];
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Анализы', '/analyses'],
      ['Мои автоматизации', '/solutions'],
      ['Чат', '/chat'],
      ['Модели', '/models'],
      ['Кредиты', '/pricing'],
    ]);
  });

  it('прежний посыл, разделы и калькулятор — на /models; вопросы — на /pricing', async () => {
    installFakeApi();
    renderRoute('/models');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Все сильные модели без подписки' }),
    ).toBeInTheDocument();
    expect(document.getElementById('spaces')).not.toBeNull();
    expect(document.getElementById('savings')).not.toBeNull();
  });

  it('вопросы и ответы — на /pricing', () => {
    renderRoute('/pricing');
    expect(screen.getByText('Как работают кредиты?')).toBeInTheDocument();
    expect(document.getElementById('faq')).not.toBeNull();
  });

  it('заголовок вкладки главной — новое позиционирование, у /models — прежний посыл', () => {
    expect(seoTitleFor('/')).toMatch(/найдите, где ИИ поможет/);
    expect(seoTitleFor('/models')).toMatch(/ChatGPT, Claude, Gemini и Grok в одном чате/);
  });
});

describe('без платформы решений главная прежняя', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });

  it('флаг выключен по умолчанию: лендинг агрегатора, адреса анализа нет', () => {
    expect(siteFeatures().discovery).toBe(false);
    const view = renderRoute('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      'Все сильные модели без подписки',
    );
    expect(seoTitleFor('/')).toMatch(/ChatGPT, Claude, Gemini и Grok в одном ИИ-чате/);
    view.unmount();

    renderRoute('/analyses/new');
    expect(screen.queryByRole('heading', { name: /Анализ задач/ })).toBeNull();
  });

  it('флаг читается из метки, которую сервер пишет в HTML', () => {
    const meta = document.createElement('meta');
    meta.name = 'ketner-features';
    meta.content = 'discovery';
    document.head.append(meta);
    try {
      expect(siteFeatures().discovery).toBe(true);
      meta.content = '';
      expect(siteFeatures().discovery).toBe(false);
    } finally {
      meta.remove();
    }
  });
});
