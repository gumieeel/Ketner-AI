import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { BotOverview, SolutionDetails } from '@/features/builder/api';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function stubFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const call = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

/** Кнопка «Оставить заявку» под ответом бота с этим текстом. */
function offerButton(reply: string) {
  const item = screen.getByText(reply).closest('li')!;
  return within(item).getByRole('button', { name: 'Оставить заявку' });
}

/** Постоянная кнопка «Оставить заявку» в шапке чата. */
function headerButton() {
  return within(screen.getByRole('banner')).getByRole('button', { name: 'Оставить заявку' });
}

const BOT = {
  slug: 'lisa-shop',
  name: 'Лиса',
  greeting: 'Здравствуйте! Чем помочь?',
  quickReplies: ['Доставка', 'Цены'],
  language: 'ru',
  status: 'active',
};

describe('страница бота для клиентов /b/:slug', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    window.localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('приветствие и кнопки; ответ бота; «не знаю» — форма заявки уходит владельцу', async () => {
    let replies = 0;
    const calls = stubFetch((call) => {
      if (call.path === '/api/b/lisa-shop') return json(200, { bot: BOT });
      if (call.path === '/api/b/lisa-shop/messages') {
        replies += 1;
        return json(200, {
          conversationId: 'conv-1',
          message: {
            id: `a${replies}`,
            role: 'assistant',
            content: replies === 1 ? 'Доставка по городу — 1 500 ₸.' : 'Уточнит сотрудник.',
            offerContact: replies > 1,
            status: 'complete',
            createdAt: '2026-11-01T10:00:00.000Z',
          },
        });
      }
      if (call.path === '/api/b/lisa-shop/leads') return json(201, { ok: true });
      return json(404, { error: { code: 'not_found' } });
    });
    renderRoute('/b/lisa-shop');

    expect(await screen.findByRole('heading', { level: 1, name: 'Лиса' })).toBeVisible();
    expect(screen.getByText('Здравствуйте! Чем помочь?')).toBeVisible();
    // Нет ссылок внутрь Ketner: страница живёт во фрейме на чужих сайтах.
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
    }

    fireEvent.click(screen.getByRole('button', { name: 'Доставка' }));
    expect(await screen.findByText('Доставка по городу — 1 500 ₸.')).toBeVisible();
    const first = calls.find((call) => call.path === '/api/b/lisa-shop/messages')!;
    expect(first.body?.content).toBe('Доставка');
    expect(String(first.body?.visitorId)).toMatch(/^v_[a-z0-9]{24}$/);
    expect(first.body?.conversationId).toBeUndefined();
    // Кнопки частых вопросов — только до первого вопроса.
    expect(screen.queryByRole('button', { name: 'Цены' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Ваше сообщение'), {
      target: { value: 'А в Астану?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Уточнит сотрудник.')).toBeVisible();
    const second = calls.filter((call) => call.path === '/api/b/lisa-shop/messages')[1]!;
    expect(second.body?.conversationId).toBe('conv-1');

    // Форма свёрнута: под ответом — кнопка «Оставить заявку», форма раскрывается по нажатию.
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(offerButton('Уточнит сотрудник.'));
    const form = await screen.findByRole('form', { name: 'Оставьте контакт — вам ответят' });
    expect(within(form).getByLabelText('Вопрос')).toHaveValue('А в Астану?');
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'Анна' } });
    fireEvent.change(within(form).getByLabelText('Телефон, мессенджер или почта'), {
      target: { value: '+7 700 000 00 00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText('Спасибо! Заявка отправлена — с вами свяжутся.')).toBeVisible();
    const lead = calls.find((call) => call.path === '/api/b/lisa-shop/leads')!;
    expect(lead.body).toMatchObject({
      name: 'Анна',
      contact: '+7 700 000 00 00',
      question: 'А в Астану?',
      conversationId: 'conv-1',
    });
  });

  it('после перезагрузки переписка восстанавливается; неизвестный адрес — «не найден»', async () => {
    window.localStorage.setItem('ketner.bot_visitor', 'v_abcdefghijklmnopqrstuvwx');
    window.localStorage.setItem('ketner.bot_conversation.lisa-shop', 'conv-9');
    const calls = stubFetch((call) => {
      if (call.path === '/api/b/lisa-shop') return json(200, { bot: BOT });
      if (call.path.startsWith('/api/b/lisa-shop/conversations/conv-9')) {
        return json(200, {
          messages: [
            {
              id: 'u1',
              role: 'user',
              content: 'Есть розы?',
              offerContact: false,
              status: 'complete',
              createdAt: '2026-11-01T10:00:00.000Z',
            },
            {
              id: 'a1',
              role: 'assistant',
              content: 'Да, есть.',
              offerContact: false,
              status: 'complete',
              createdAt: '2026-11-01T10:00:01.000Z',
            },
          ],
        });
      }
      return json(404, { error: { code: 'bot_not_found' } });
    });
    renderRoute('/b/lisa-shop');
    expect(await screen.findByText('Да, есть.')).toBeVisible();
    expect(calls.some((call) => call.path.includes('visitorId=v_abcdefghijklmnopqrstuvwx'))).toBe(
      true,
    );

    renderRoute('/b/nobody');
    expect(await screen.findByRole('heading', { name: 'Бот не найден' })).toBeVisible();
  });
});

/** Бот в кабинете владельца (общие данные тестов кабинета). */
function botDetails(): SolutionDetails {
  return {
    solution: {
      id: 'b1',
      type: 'customer_bot',
      kind: 'assistant',
      template: 'customer_bot',
      bot: {
        slug: 'lisa-shop',
        greeting: 'Здравствуйте!',
        quickReplies: [],
        dailyCapCredits: 1000,
        corrections: [],
      },
      status: 'active',
      name: 'Лиса',
      currentVersion: 1,
      activeVersion: 1,
      source: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
    config: {
      name: 'Лиса',
      purpose: '',
      instructions: '',
      tone: 'friendly',
      knowledge: '',
      examples: [],
      restrictions: [],
      language: 'ru',
    },
    versions: [{ number: 1, createdAt: '2026-11-01T10:00:00.000Z' }],
    cases: [],
    run: null,
    readiness: { ready: true },
    testQuote: null,
  };
}

function botOverview(): BotOverview {
  const details = botDetails();
  return {
    settings: details.solution.bot!,
    today: { replies: 3, credits: 7, newLeads: 1 },
    publicUrl: 'https://ketner.org/b/lisa-shop',
  };
}

describe('кабинет бота: ссылка, код для сайта, заявки, исправление ответа', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } as never,
    });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('владелец видит, где живёт бот, заявки и исправляет ответ из диалога', async () => {
    const details = botDetails();
    let overview: BotOverview = botOverview();
    const calls = stubFetch((call) => {
      const path = call.path.replace(/^\/api\/solutions/, '');
      if (path === '/b1') return json(200, details);
      if (path === '/b1/bot' && call.method === 'GET') return json(200, overview);
      if (path === '/b1/bot' && call.method === 'PUT') {
        overview = { ...overview, settings: { ...overview.settings, ...call.body } };
        return json(200, overview);
      }
      if (path === '/b1/leads') {
        return json(200, {
          leads: [
            {
              id: 'l1',
              solutionId: 'b1',
              conversationId: 'c1',
              name: 'Анна',
              contact: '+7 700 000 00 00',
              question: 'Букет на завтра',
              status: 'new',
              createdAt: '2026-11-01T10:00:00.000Z',
              updatedAt: '2026-11-01T10:00:00.000Z',
            },
          ],
        });
      }
      if (path === '/b1/conversations') {
        return json(200, {
          conversations: [
            {
              id: 'c1',
              solutionId: 'b1',
              messageCount: 2,
              createdAt: '2026-11-01T10:00:00.000Z',
              updatedAt: '2026-11-01T10:00:00.000Z',
            },
          ],
        });
      }
      if (path === '/b1/conversations/c1') {
        return json(200, {
          messages: [
            {
              id: 'm1',
              conversationId: 'c1',
              role: 'user',
              content: 'До скольки работаете?',
              model: null,
              offerContact: false,
              status: 'complete',
              chargedCredits: 0,
              createdAt: '2026-11-01T10:00:00.000Z',
            },
            {
              id: 'm2',
              conversationId: 'c1',
              role: 'assistant',
              content: 'Уточнит сотрудник.',
              model: null,
              offerContact: true,
              status: 'complete',
              chargedCredits: 2,
              createdAt: '2026-11-01T10:00:01.000Z',
            },
          ],
        });
      }
      return json(404, { error: { code: 'not_found', message: '' } });
    });
    renderRoute('/solutions/b1');

    expect(await screen.findByText('https://ketner.org/b/lisa-shop')).toBeVisible();
    expect(
      screen.getByText(
        '<script src="https://ketner.org/widget.js" data-bot="lisa-shop" async></script>',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Открыть страницу бота' })).toHaveAttribute(
      'href',
      '/b/lisa-shop',
    );
    // Задача 0b: остатка кредитов и «хватит на N дней» в кабинете бота нет.
    expect(screen.queryByText(/хватит примерно/)).toBeNull();
    expect(screen.queryByText(/На балансе/)).toBeNull();
    // У бота нет чата владельца: он отвечает на своей странице.
    expect(screen.queryByRole('link', { name: 'Открыть чат' })).toBeNull();
    expect(await screen.findByText('Букет на завтра')).toBeVisible();

    fireEvent.click(await screen.findByRole('button', { name: /Сообщений: 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить ответ' }));
    fireEvent.change(screen.getByLabelText(/Как бот должен был ответить/), {
      target: { value: 'С 9 до 20 каждый день.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить исправление' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        corrections: [{ question: 'До скольки работаете?', answer: 'С 9 до 20 каждый день.' }],
      }),
    );
    // Исправление сразу видно в настройках страницы.
    expect(await screen.findByDisplayValue('С 9 до 20 каждый день.')).toBeVisible();
  });

  it('развёртывание: ссылка и QR первыми, шаги под конструктор, письмо разработчику, проверка установки', async () => {
    const details = botDetails();
    let overview: BotOverview = { ...botOverview(), install: { sites: [] } };
    const calls = stubFetch((call) => {
      const path = call.path.replace(/^\/api\/solutions/, '');
      if (path === '/b1') return json(200, details);
      if (path === '/b1/bot') return json(200, overview);
      if (path === '/b1/leads') return json(200, { leads: [] });
      if (path === '/b1/conversations') return json(200, { conversations: [] });
      return json(404, { error: { code: 'not_found', message: '' } });
    });
    renderRoute('/solutions/b1');

    const link = await screen.findByText('https://ketner.org/b/lisa-shop');
    const embed = screen.getByText(
      '<script src="https://ketner.org/widget.js" data-bot="lisa-shop" async></script>',
    );
    // Ссылка и QR — раньше кода для сайта: у многих клиентов сайта нет.
    expect(link.compareDocumentPosition(embed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скачать PNG' })).toBeVisible();
    const svg = screen.getByRole('link', { name: 'Скачать SVG для печати' });
    expect(svg).toHaveAttribute('download', 'ketner-bot-lisa-shop.svg');
    const svgMarkup = decodeURIComponent(svg.getAttribute('href')!.split(',')[1]!);
    expect(svgMarkup).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svgMarkup).toMatch(/fill="#ffffff"/);

    // Шаги меняются вместе с конструктором; где код не вставить — кнопка-ссылка.
    const builder = screen.getByLabelText('На чём сделан сайт');
    expect(screen.getByRole('list', { name: 'Tilda' })).toHaveTextContent(
      'HTML-код для вставки внутрь HEAD',
    );
    fireEvent.change(builder, { target: { value: 'taplink' } });
    expect(screen.getByText(/кнопка со ссылкой на страницу бота/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Taplink' })).toHaveTextContent('блок «Ссылка»');
    fireEvent.change(builder, { target: { value: 'shopify' } });
    expect(screen.getByRole('list', { name: 'Shopify' })).toHaveTextContent('layout/theme.liquid');

    // Письмо разработчику: код, куда вставить и как проверить; данных аккаунта нет.
    const mail = screen.getByRole('link', { name: 'Написать письмо' });
    const href = mail.getAttribute('href')!;
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    const body = decodeURIComponent(href.split('&body=')[1]!);
    expect(body).toContain('data-bot="lisa-shop"');
    expect(body).toContain('перед </body>');
    expect(body).toContain('https://ketner.org/b/lisa-shop');
    expect(body).not.toContain('owner@example.com');
    expect(screen.getByRole('button', { name: 'Скопировать текст' })).toBeVisible();

    // Тариф не назначен — строки обращений нет (до включения тарифов владельца это не касается).
    expect(screen.queryByText(/Обращений посетителей в этом месяце/)).toBeNull();

    // Проверка установки: пока не найден; после «Проверить ещё раз» — адрес сайта.
    expect(screen.getByText(/Пока не найден/)).toBeVisible();
    overview = {
      ...overview,
      requests: {
        tier: 'growth',
        used: 42,
        included: 5_000,
        limit: 5_500,
        state: 'ok',
        periodEnd: '2026-12-01T00:00:00.000Z',
      },
      install: {
        sites: [
          {
            origin: 'https://shop.example',
            firstSeenAt: '2026-11-15T10:00:00.000Z',
            lastSeenAt: '2026-11-15T10:05:00.000Z',
          },
        ],
      },
    };
    const before = calls.filter((call) => call.path === '/api/solutions/b1/bot').length;
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ещё раз' }));
    expect(await screen.findByText('Виджет открывали на shop.example')).toBeVisible();
    // Отметка — подсказка, а не доказательство: панель так и говорит.
    expect(screen.getByText(/Это подсказка, а не проверка/)).toBeVisible();
    expect(screen.getByText(/Обращений посетителей в этом месяце: 42 из 5\s000/)).toBeVisible();
    expect(screen.queryByText(/Пока не найден/)).toBeNull();
    expect(calls.filter((call) => call.path === '/api/solutions/b1/bot').length).toBe(before + 1);
  });
});

describe('страница бота: форма заявки и прокрутка', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // jsdom не умеет scrollIntoView; тест подставляет шпиона — убираем, чтобы не мешал другим.
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  /** Ответ бота по номеру; `offers` — номера ответов, после которых бот предлагает оставить контакт. */
  function botReplies(offers: number[]) {
    let replies = 0;
    return stubFetch((call) => {
      if (call.path === '/api/b/lisa-shop') return json(200, { bot: BOT });
      if (call.path === '/api/b/lisa-shop/messages') {
        replies += 1;
        return json(200, {
          conversationId: 'conv-1',
          message: {
            id: `a${replies}`,
            role: 'assistant',
            content: `Ответ ${replies}.`,
            offerContact: offers.includes(replies),
            status: 'complete',
            createdAt: '2026-11-01T10:00:00.000Z',
          },
        });
      }
      if (call.path === '/api/b/lisa-shop/leads') return json(201, { ok: true });
      return json(404, { error: { code: 'not_found' } });
    });
  }

  async function ask(text: string, reply: string) {
    fireEvent.change(screen.getByLabelText('Ваше сообщение'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText(reply)).toBeVisible();
  }

  it('форма свёрнута; кнопка под ответом раскрывает её на месте и сворачивает без прокрутки', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    botReplies([1, 2]);
    renderRoute('/b/lisa-shop');
    await screen.findByRole('heading', { level: 1, name: 'Лиса' });

    await ask('Возите в Астану?', 'Ответ 1.');
    expect(screen.queryByRole('form')).toBeNull();
    const inline = offerButton('Ответ 1.');
    expect(inline).toHaveAttribute('aria-expanded', 'false');

    scroll.mockClear();
    fireEvent.click(inline);
    const form = await screen.findByRole('form', { name: 'Оставьте контакт — вам ответят' });
    // На месте: внутри того же сообщения, а не поверх чата и не в конце переписки.
    expect(screen.getByText('Ответ 1.').closest('li')!.contains(form)).toBe(true);
    expect(inline).toHaveAttribute('aria-expanded', 'true');
    expect(inline).toHaveAttribute('aria-controls', form.id);
    // Раскрытие не перескакивает к концу переписки (прокрутка к концу — только на новые сообщения;
    // сдвиг на высоту формы проверен в браузере, см. PR).
    expect(scroll).not.toHaveBeenCalled();
    expect(within(form).getByLabelText('Имя')).toHaveFocus();
    expect(within(form).getByLabelText('Вопрос')).toHaveValue('Возите в Астану?');
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'Айгерим' } });

    scroll.mockClear();
    fireEvent.click(within(form).getByRole('button', { name: 'Свернуть' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(inline).toHaveAttribute('aria-expanded', 'false');
    expect(scroll).not.toHaveBeenCalled();
    await waitFor(() => expect(inline).toHaveFocus());

    // Снова раскрыли — имя на месте. Новый ответ с предложением не двигает открытую форму.
    fireEvent.click(inline);
    expect(within(await screen.findByRole('form')).getByLabelText('Имя')).toHaveValue('Айгерим');
    await ask('Можно оплатить картой?', 'Ответ 2.');
    expect(screen.getByText('Ответ 1.').closest('li')!.contains(screen.getByRole('form'))).toBe(
      true,
    );
    // Кнопка под вторым ответом раскрывает форму уже там, со своим вопросом.
    fireEvent.click(offerButton('Ответ 2.'));
    const second = screen.getByRole('form');
    expect(screen.getByText('Ответ 2.').closest('li')!.contains(second)).toBe(true);
    expect(within(second).getByLabelText('Вопрос')).toHaveValue('Можно оплатить картой?');
    expect(within(second).getByLabelText('Имя')).toHaveValue('Айгерим');
    expect(offerButton('Ответ 1.')).toHaveAttribute('aria-expanded', 'false');
  });

  it('кнопка в шапке есть всегда: форма в конце переписки с последним вопросом; повторное нажатие сворачивает', async () => {
    botReplies([]);
    renderRoute('/b/lisa-shop');
    await screen.findByRole('heading', { level: 1, name: 'Лиса' });
    expect(headerButton()).toHaveAttribute('aria-expanded', 'false');

    await ask('Есть доставка?', 'Ответ 1.');
    // Бот не предлагал форму — под ответом кнопки нет.
    expect(within(screen.getByText('Ответ 1.').closest('li')!).queryByRole('button')).toBeNull();
    fireEvent.click(headerButton());
    const form = await screen.findByRole('form', { name: 'Оставьте контакт — вам ответят' });
    expect(form.closest('li')).toBeNull();
    expect(within(form).getByLabelText('Вопрос')).toHaveValue('Есть доставка?');
    expect(headerButton()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(headerButton());
    expect(screen.queryByRole('form')).toBeNull();
    await ask('Сколько стоит?', 'Ответ 2.');
    fireEvent.click(headerButton());
    expect(within(await screen.findByRole('form')).getByLabelText('Вопрос')).toHaveValue(
      'Сколько стоит?',
    );
  });

  it('после заявки: «отправлено» на месте формы, кнопок под ответами нет, кнопка в шапке работает', async () => {
    const calls = botReplies([1, 2]);
    renderRoute('/b/lisa-shop');
    await screen.findByRole('heading', { level: 1, name: 'Лиса' });
    await ask('Нужен букет на завтра', 'Ответ 1.');
    fireEvent.click(offerButton('Ответ 1.'));
    const form = await screen.findByRole('form');
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'Анна' } });
    fireEvent.change(within(form).getByLabelText('Телефон, мессенджер или почта'), {
      target: { value: '+7 700 000 00 00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить заявку' }));
    const sent = await screen.findByText('Спасибо! Заявка отправлена — с вами свяжутся.');
    expect(screen.getByText('Ответ 1.').closest('li')!.contains(sent)).toBe(true);
    expect(calls.find((call) => call.path === '/api/b/lisa-shop/leads')?.body).toMatchObject({
      name: 'Анна',
      question: 'Нужен букет на завтра',
    });

    await ask('А ещё один?', 'Ответ 2.');
    for (const reply of ['Ответ 1.', 'Ответ 2.']) {
      expect(
        within(screen.getByText(reply).closest('li')!).queryByRole('button', {
          name: 'Оставить заявку',
        }),
      ).toBeNull();
    }
    fireEvent.click(headerButton());
    expect(within(await screen.findByRole('form')).getByLabelText('Имя')).toHaveValue('Анна');
  });

  it('виджет (embed=1) — то же: форма свёрнута, раскрывается под ответом', async () => {
    botReplies([1]);
    renderRoute('/b/lisa-shop?embed=1');
    await screen.findByRole('heading', { level: 1, name: 'Лиса' });
    expect(document.querySelector('[data-embed]')).not.toBeNull();
    // Узкое окно: пометка об ИИ — короткая и в одну строку, полная — на широком экране.
    const short = screen.getByText('Отвечает ИИ, может ошибаться');
    expect(short).toHaveClass('sm:hidden');
    expect(short.parentElement).toHaveClass('truncate');
    expect(
      screen.getByText('Отвечает ИИ — он может ошибаться. Важное уточняйте у сотрудника.'),
    ).toHaveClass('max-sm:hidden');
    await ask('Возите в Астану?', 'Ответ 1.');
    expect(screen.queryByRole('form')).toBeNull();
    expect(headerButton()).toBeVisible();
    fireEvent.click(offerButton('Ответ 1.'));
    const form = await screen.findByRole('form');
    expect(screen.getByText('Ответ 1.').closest('li')!.contains(form)).toBe(true);
  });

  it('бот на паузе: форма тоже свёрнута, кнопка под отметкой «не отвечает»', async () => {
    stubFetch((call) =>
      call.path === '/api/b/lisa-shop'
        ? json(200, { bot: { ...BOT, status: 'paused' } })
        : json(404, { error: { code: 'not_found' } }),
    );
    renderRoute('/b/lisa-shop');
    const note = await screen.findByText('Бот сейчас не отвечает. Оставьте контакт — вам ответят.');
    expect(screen.queryByRole('form')).toBeNull();
    const box = note.parentElement!;
    fireEvent.click(within(box).getByRole('button', { name: 'Оставить заявку' }));
    expect(box.contains(await screen.findByRole('form'))).toBe(true);
  });

  it('прокрутка: подписи сообщений для экранных чтецов внутри позиционированной области переписки', async () => {
    // jsdom не считает раскладку, поэтому сам перерасход высоты здесь не измерить (он проверен в
    // браузере, см. описание PR). Тест держит условие исправления: подписи sr-only (position:
    // absolute) лежат внутри области прокрутки, и она — их содержащий блок (relative), иначе они
    // отсчитываются от страницы и растягивают документ на длину переписки.
    botReplies([1]);
    renderRoute('/b/lisa-shop?embed=1');
    await screen.findByRole('heading', { level: 1, name: 'Лиса' });
    await ask('Возите в Астану?', 'Ответ 1.');
    fireEvent.click(offerButton('Ответ 1.'));
    await screen.findByRole('form', { name: 'Оставьте контакт — вам ответят' });

    const main = document.querySelector('main')!;
    expect(main).toHaveClass('relative', 'overflow-y-auto', 'overscroll-contain', 'min-h-0');
    const labels = [...document.querySelectorAll('ol .sr-only')];
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) expect(main.contains(label)).toBe(true);
    // Ничего между подписью и областью прокрутки не задаёт position (иначе проверка выше неполна).
    for (const label of labels) {
      for (let node = label.parentElement; node && node !== main; node = node.parentElement) {
        expect(node.className).not.toMatch(/\b(relative|absolute|fixed|sticky)\b/);
      }
    }
  });
});
