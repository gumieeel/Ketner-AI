import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLegalDocument,
  LEGAL_PATHS,
  REFUND_DAYS,
  type LegalPageId,
} from '@/features/content/legal';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { TIERS } from '@/features/billing/tiers';
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
    ['/privacy', 'Privacy Policy', 'November 23, 2026'],
    ['/terms', 'Terms of Service and Public Offer', 'November 20, 2026'],
    ['/payment-terms', 'Payments and Refunds', 'November 20, 2026'],
  ])('%s на английском: заголовок, дата редакции и навигация переведены', (path, title, date) => {
    usePreferences.setState({ language: 'en' });
    renderRoute(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(`Last updated: ${date}`)).toBeInTheDocument();
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

  it('оплата и возврат: тарифы из каталога, подключение командой, без автосписаний, пакеты не продаются', () => {
    renderRoute('/payment-terms');
    for (const tier of TIERS) {
      expect(
        screen.getByText((text) => text.startsWith(`${tier.name} — $${tier.priceUsd} в месяц`)),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/Start — \$10 в месяц: 1 активное решение/)).toBeInTheDocument();
    expect(screen.getByText(/Growth — \$29 в месяц: 3 активных решения/)).toBeInTheDocument();
    expect(
      screen.getByText(/Оплаты тарифа на сайте пока нет\. Тариф подключает команда Ketner/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Автоматических списаний нет/)).toBeInTheDocument();
    expect(screen.getByText(/Пакеты кредитов больше не продаются/)).toBeInTheDocument();
    // Прежний способ оплаты пакета как действующий на странице не описан.
    expect(screen.queryByText(/на странице оформления пакета/)).not.toBeInTheDocument();
  });

  it('соглашение: раздел 3 — тарифы и бесплатный лимит, пакеты и подписки больше не продаются', () => {
    const terms = getLegalDocument('terms', 'ru');
    const text = (section: number) => {
      const found = terms.sections[section - 1]!;
      return [found.title, ...(found.paragraphs ?? []), ...(found.items ?? [])].join(' ');
    };
    expect(terms.lead).toMatch(/подключая тариф/);
    expect(text(1)).toMatch(/Пакеты кредитов и подписки больше не продаются/);
    expect(text(3)).toMatch(/^3\. Тарифы и бесплатный лимит/);
    expect(text(3)).toMatch(/Автоматических списаний нет/);
    expect(text(3)).toMatch(/80% объёма тарифа.*ещё 10%/);
    expect(text(3)).toMatch(/Кредиты пакетов, купленных до 20 ноября 2026 г\., действуют 365 дней/);
    expect(text(3)).not.toMatch(/странице «Кредиты»/);
    // Возврат за тариф — только по странице «Оплата и возврат» (сбои и двойные списания).
    expect(text(7)).toMatch(/возврат за тариф — по правилам страницы «Оплата и возврат»/);
    expect(text(9)).toMatch(/за тариф — как при сбое/);
    expect(getLegalDocument('terms', 'en').sections[2]!.title).toBe(
      '3. Plans and the free allowance',
    );
  });

  it('политика: Google Таблицы — по запросу владельца, drive.file, действует с запуском возможности', () => {
    for (const language of ['ru', 'en'] as const) {
      const doc = getLegalDocument('privacy', language);
      const text = doc.sections
        .flatMap((section) => [...(section.paragraphs ?? []), ...(section.items ?? [])])
        .join(' ');
      expect(text).toMatch(/drive\.file/);
      expect(text).toMatch(/Limited Use/);
      expect(text).not.toMatch(
        /Without purchased credits \(the Free level\)|Без купленных кредитов \(уровень Free\) и после/,
      );
    }
    const ru = getLegalDocument('privacy', 'ru')
      .sections.flatMap((section) => section.items ?? [])
      .join(' ');
    expect(ru).toMatch(/Возможность появится позже: этот пункт начнёт действовать с её запуском/);
    expect(ru).toMatch(/тариф \(или пакет кредитов — для покупок до 20 ноября 2026 г\.\)/);
  });

  it('политика: уведомления в Telegram о заявках названы — что уходит и при каком условии', () => {
    for (const [language, pattern] of [
      ['ru', /Telegram — если вы привязали его к аккаунту: .*имя, контакт и вопрос клиента/],
      [
        'en',
        /Telegram — if you linked it to your account: .*the customer’s name, contact and question/,
      ],
    ] as const) {
      const items = getLegalDocument('privacy', language).sections.flatMap(
        (section) => section.items ?? [],
      );
      expect(items.join(' ')).toMatch(pattern);
    }
  });

  it('политика: почтовый сервис Resend назван — кому передаём и что (адрес и текст письма)', () => {
    for (const [language, pattern] of [
      ['ru', /Почтовый сервис Resend — адрес получателя и текст письма/],
      ['en', /The Resend email service — the recipient address and the email text/],
    ] as const) {
      const doc = getLegalDocument('privacy', language);
      expect(doc.sections.flatMap((section) => section.items ?? []).join(' ')).toMatch(pattern);
      expect(doc.sections.flatMap((section) => section.paragraphs ?? []).join(' ')).toMatch(
        /Resend/,
      );
    }
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
