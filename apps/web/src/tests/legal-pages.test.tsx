import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLegalDocument,
  LEGAL_PATHS,
  REFUND_DAYS,
  type LegalPageId,
} from '@/features/content/legal';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { usePreferences } from '@/features/preferences/preferences-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const IDS = Object.keys(LEGAL_PATHS) as LegalPageId[];

/** Кириллица в английском тексте — значит, что-то осталось непереведённым. */
const CYRILLIC = /[А-Яа-яЁё]/;

describe('правовые страницы: две языковые версии', () => {
  it.each(IDS)('%s: в русской и английской версиях одинаковая структура', (id) => {
    const ru = getLegalDocument(id, 'ru');
    const en = getLegalDocument(id, 'en');
    expect(en.sections).toHaveLength(ru.sections.length);
    ru.sections.forEach((section, index) => {
      const other = en.sections[index]!;
      expect(other.paragraphs?.length ?? 0, `${id} §${index + 1} абзацы`).toBe(
        section.paragraphs?.length ?? 0,
      );
      expect(other.items?.length ?? 0, `${id} §${index + 1} пункты`).toBe(
        section.items?.length ?? 0,
      );
    });
  });

  it.each(IDS)('%s: в английской версии нет русских слов', (id) => {
    const en = getLegalDocument(id, 'en');
    const text = [
      en.title,
      en.lead,
      ...en.sections.flatMap((section) => [
        section.title,
        ...(section.paragraphs ?? []),
        ...(section.items ?? []),
      ]),
    ].join('\n');
    expect(text).not.toMatch(CYRILLIC);
  });

  it('известные проблемы переведены на английский', () => {
    for (const issue of KNOWN_ISSUES) {
      expect(`${issue.en.title} ${issue.en.details} ${issue.en.workaround ?? ''}`).not.toMatch(
        CYRILLIC,
      );
      expect(Boolean(issue.en.workaround)).toBe(Boolean(issue.workaround));
    }
  });

  it('окно возврата — 14 дней, как на сервере', () => {
    expect(REFUND_DAYS).toBe(14);
  });
});

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

  it.each([
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service and Public Offer'],
    ['/payment-terms', 'Payments and Refunds'],
  ])('%s на английском: заголовок, дата редакции и навигация переведены', (path, title) => {
    usePreferences.setState({ language: 'en' });
    renderRoute(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText('Last updated: November 1, 2026')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Legal information' });
    expect(within(nav).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByText('Questions:')).toBeInTheDocument();
  });

  it('условия возврата называют окно в 14 дней и правило про нетронутые кредиты пакета', () => {
    renderRoute('/payment-terms');
    expect(
      screen.getByText(/в течение 14 дней после оплаты, пока вы не потратили ни одного кредита/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Комиссию сети за возвратный перевод мы берём на себя/),
    ).toBeInTheDocument();
  });

  it('условия возврата на английском называют окно в 14 дней и право отказа по закону', () => {
    usePreferences.setState({ language: 'en' });
    renderRoute('/payment-terms');
    expect(
      screen.getByText(/within 14 days of paying, as long as you have not spent any credit/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Withdrawal by law\./)).toBeInTheDocument();
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

  it('контакты на английском: форма переведена и проверяет поля на английском', async () => {
    usePreferences.setState({ language: 'en' });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/contacts');

    expect(screen.getByRole('heading', { level: 1, name: 'Contact us' })).toBeInTheDocument();
    expect(screen.getByText('Support email')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your name');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Email for the reply'), {
      target: { value: 'anna@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'My receipt did not arrive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('anna@example.com'));
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

  it('в футере на английском подписи ссылок переведены', () => {
    usePreferences.setState({ language: 'en' });
    renderRoute('/contacts');
    for (const [name, href] of [
      ['Terms and Offer', '/terms'],
      ['Privacy', '/privacy'],
      ['Payments and Refunds', '/payment-terms'],
    ] as const) {
      expect(
        screen.getAllByRole('link', { name }).some((link) => link.getAttribute('href') === href),
      ).toBe(true);
    }
    expect(screen.queryByRole('link', { name: 'Соглашение и оферта' })).not.toBeInTheDocument();
  });
});
