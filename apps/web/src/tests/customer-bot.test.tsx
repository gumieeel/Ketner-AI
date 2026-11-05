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
    const details: SolutionDetails = {
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
    let overview: BotOverview = {
      settings: details.solution.bot!,
      today: { replies: 3, credits: 7, newLeads: 1 },
      balance: { credits: 4200, dailyCredits: 600, daysLeft: 7 },
      publicUrl: 'https://ketner.org/b/lisa-shop',
    };
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
    // Этап C: остаток и «хватит на N дней» при среднем расходе ботов.
    expect(
      screen.getByText(
        /На балансе 4 ?200 кредитов\. Боты тратят в среднем 600 кредитов в день — хватит примерно на 7 дн\./,
      ),
    ).toBeVisible();
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
});
