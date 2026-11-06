import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGuestId } from '@/features/chat/api';
import { DISCOVERY_TEXT_MAX, readDraft } from '@/features/discovery/draft';
import { INDUSTRIES } from '@/features/discovery/industries';
import { setSiteFeatures, siteFeatures } from '@/lib/features';
import { seoTitleFor } from '@/lib/seo-pages';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const HOME_TITLE = 'Расскажите о своём бизнесе';
const SUBMIT = 'Проанализировать бизнес';
const FIELD = 'Опишите свой бизнес';
const DESCRIPTION =
  'У меня интернет-магазин одежды. Клиенты пишут в WhatsApp, менеджеры отвечают вручную.';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** API анализа: создание анализа и его страница. `createError` — отказ при создании. */
function installAnalysesApi(createError?: { status: number; code: string; message: string }) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const view = {
    id: 'a-home',
    status: 'analyzing',
    mode: 'free',
    language: 'ru',
    guest: true,
    inputText: DESCRIPTION,
    context: null,
    questions: [],
    answers: {},
    summary: null,
    coverage: null,
    source: null,
    saved: false,
    stages: { context: null, discovery: null },
    opportunities: [],
    cost: { chargedCredits: 0, sponsored: true },
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({
      method,
      path: url.pathname,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    if (url.pathname === '/api/analyses' && method === 'POST') {
      if (createError) {
        const { status, ...error } = createError;
        return json(status, { error });
      }
      return json(202, { analysis: view });
    }
    if (url.pathname === '/api/analyses/a-home') {
      return json(200, { analysis: view, rerun: null, retry: null, plans: null });
    }
    if (url.pathname === '/api/analyses/offer') {
      return json(200, {
        free: { available: false, reason: 'daily_limit', resetsAt: '2026-11-07T00:00:00.000Z' },
        paid: { model: 'M', typicalCredits: 9, maxCredits: 27, loginRequired: true },
        deep: {
          model: 'D',
          typicalCredits: 79,
          maxCredits: 322,
          loginRequired: true,
          confirmationRequired: true,
        },
      });
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return calls;
}

describe('главная — Business Discovery (DISCOVERY_ENABLED)', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('первый экран: заголовок, описание, большое поле, кнопка, отрасли и успокаивающая строка', () => {
    renderRoute('/');

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName(HOME_TITLE);
    expect(
      screen.getByText(/Мы проанализируем ваши процессы, найдём возможности для автоматизации/),
    ).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: FIELD });
    expect(field.getAttribute('placeholder')).toMatch(
      /^Например: у меня небольшой интернет-магазин одежды\. Клиенты пишут в WhatsApp и Instagram/,
    );
    expect(screen.getByRole('button', { name: SUBMIT })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Не нужно разбираться в технологиях. Просто расскажите, как работает ваш бизнес.',
      ),
    ).toBeInTheDocument();

    const industries = within(screen.getByRole('group', { name: 'Отрасль' })).getAllByRole(
      'button',
    );
    expect(industries.map((button) => button.textContent)).toEqual([
      'Интернет-магазин',
      'Образование',
      'Сфера услуг',
      'Автобизнес',
      'Агробизнес',
      'Производство',
    ]);

    // Поле — до любых разделов: разделы о работе, решениях и ценах идут ниже, как h2.
    const sections = screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent);
    expect(sections).toEqual([
      'Как это работает',
      'Решения по отраслям',
      'Внедрение',
      'Цены',
      'Вопросы',
      'Контакты',
    ]);
    expect(
      field.compareDocumentPosition(screen.getByRole('heading', { name: 'Как это работает' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Все сильные модели без подписки' })).toBeNull();
  });

  it('отрасль подсказывает, о чём рассказать, и не выдумывает бизнес за человека', () => {
    renderRoute('/');
    const field = screen.getByRole('textbox', { name: FIELD });

    fireEvent.click(screen.getByRole('button', { name: 'Интернет-магазин' }));
    expect(field).toHaveValue('У меня интернет-магазин. ');
    expect(screen.getByRole('button', { name: 'Интернет-магазин' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Расскажите, например:')).toBeInTheDocument();
    expect(screen.getByText('Где пишут клиенты: WhatsApp, Instagram, сайт?')).toBeInTheDocument();
    // Ничего не отправлено, а одна первая фраза — ещё не описание бизнеса.
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(HOME_TITLE);
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent('Расскажите хотя бы парой предложений');

    // Другая отрасль заменяет только первую фразу, пока человек ничего не дописал.
    fireEvent.click(screen.getByRole('button', { name: 'Производство' }));
    expect(field).toHaveValue('У нас производственная компания. ');

    // Написанное человеком отрасль не трогает — только показывает подсказки.
    fireEvent.change(field, { target: { value: DESCRIPTION } });
    fireEvent.click(screen.getByRole('button', { name: 'Образование' }));
    expect(field).toHaveValue(DESCRIPTION);
    const education = INDUSTRIES.find((item) => item.id === 'education')!;
    expect(screen.getByText(education.prompts.ru[0])).toBeInTheDocument();
  });

  it('слишком короткое описание не отправляется и объясняет, что написать', () => {
    const calls = installAnalysesApi();
    renderRoute('/');
    fireEvent.change(screen.getByRole('textbox', { name: FIELD }), {
      target: { value: 'Магазин' },
    });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Расскажите хотя бы парой предложений: чем занимаетесь и что отнимает больше всего времени.',
    );
    expect(calls).toHaveLength(0);
  });

  it('слишком длинное описание не отправляется, лимит назван', () => {
    const calls = installAnalysesApi();
    renderRoute('/');
    const field = screen.getByRole('textbox', { name: FIELD });
    fireEvent.change(field, { target: { value: 'а'.repeat(DISCOVERY_TEXT_MAX + 12) } });

    expect(screen.getByRole('alert')).toHaveTextContent(/на 12/);
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(calls).toHaveLength(0);
  });

  it('отправка сразу запускает анализ без регистрации и открывает его страницу', async () => {
    const calls = installAnalysesApi();
    const first = renderRoute('/');
    fireEvent.change(screen.getByRole('textbox', { name: FIELD }), {
      target: { value: DESCRIPTION },
    });
    // Черновик переживает перезагрузку страницы.
    expect(readDraft()?.text).toBe(DESCRIPTION);
    first.unmount();
    renderRoute('/');
    expect(screen.getByRole('textbox', { name: FIELD })).toHaveValue(DESCRIPTION);

    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/analyses/a-home')).toBe(true),
    );
    const create = calls.find((call) => call.method === 'POST')!;
    expect(create.body).toEqual({ text: DESCRIPTION, language: 'ru' });
    expect(create.headers['Idempotency-Key']).toMatch(/^an_[A-Za-z0-9]{8,}/);
    expect(create.headers['X-Guest-Id']).toMatch(/^guest_[a-z0-9]{24}$/);
    expect(readDraft()).toBeNull();
  });

  it('бесплатный анализ на сегодня использован — страница выбора с причиной, описание сохранено', async () => {
    installAnalysesApi({
      status: 409,
      code: 'free_unavailable',
      message: 'Бесплатный анализ на сегодня уже использован.',
    });
    renderRoute('/');
    fireEvent.change(screen.getByRole('textbox', { name: FIELD }), {
      target: { value: DESCRIPTION },
    });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));

    expect(
      await screen.findByText('Бесплатный анализ на сегодня уже использован.'),
    ).toBeInTheDocument();
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
  });

  it('отказ сервера показывается под полем, описание остаётся', async () => {
    installAnalysesApi({
      status: 429,
      code: 'too_many_requests',
      message: 'Слишком много анализов подряд. Подождите минуту.',
    });
    renderRoute('/');
    fireEvent.change(screen.getByRole('textbox', { name: FIELD }), {
      target: { value: DESCRIPTION },
    });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Слишком много анализов подряд. Подождите минуту.',
    );
    expect(screen.getByRole('textbox', { name: FIELD })).toHaveValue(DESCRIPTION);
  });

  it('шапка гостя: «Как это работает», «Решения» и «Войти» — без регистрации и чата', () => {
    renderRoute('/');
    const nav = screen.getAllByRole('navigation', { name: 'Навигация' })[0];
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Как это работает', '/#how-it-works'],
      ['Решения', '/#solutions'],
    ]);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    expect(within(header).queryByRole('link', { name: 'Регистрация' })).toBeNull();
  });

  it('гостевой id — длинный и случайный', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newGuestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^guest_[a-z0-9]{24}$/);
  });

  it('прежний посыл, разделы и калькулятор — на /models', async () => {
    installFakeApi();
    renderRoute('/models');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Все сильные модели без подписки' }),
    ).toBeInTheDocument();
    expect(document.getElementById('spaces')).not.toBeNull();
    expect(document.getElementById('savings')).not.toBeNull();
  });

  it('вопросы о кредитах — на /pricing', () => {
    renderRoute('/pricing');
    expect(screen.getByText('Как работают кредиты?')).toBeInTheDocument();
    expect(document.getElementById('faq')).not.toBeNull();
  });

  it('заголовок вкладки главной — Business Discovery, у /models — прежний посыл', () => {
    expect(seoTitleFor('/')).toMatch(/расскажите о своём бизнесе/);
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
