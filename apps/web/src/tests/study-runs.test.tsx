import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { ToolSolutionDetails } from '@/features/builder/api';
import type {
  MaterialSummary,
  NotesResult,
  RunQuote,
  TableResult,
  ToolRunView,
} from '@/features/study/api';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

function signIn(): void {
  useAuth.setState({
    status: 'authenticated',
    token: 'mock-token',
    user: {
      id: 'u1',
      email: 'student@example.com',
      name: 'Student',
      plan: 'credits',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never,
  });
}

const TOOL: ToolSolutionDetails = {
  solution: {
    id: 's1',
    type: 'tool',
    kind: 'tool',
    template: 'study_assistant',
    bot: null,
    status: 'active',
    name: 'Подготовка к ЕНТ',
    currentVersion: 1,
    activeVersion: 1,
    source: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  },
  config: { tool: 'study_assistant', language: 'ru', subject: '' },
  versions: [{ number: 1, createdAt: '2026-11-05T10:00:00.000Z' }],
};

const MATERIAL: MaterialSummary = {
  id: 'm1',
  solutionId: 's1',
  name: 'Биология.pdf',
  format: 'pdf',
  sizeBytes: 50_000,
  charCount: 60,
  sections: [
    { id: 's1', label: 'Стр. 1', chars: 30 },
    { id: 's2', label: 'Стр. 2', chars: 30 },
  ],
  createdAt: '2026-11-05T10:00:00.000Z',
};

const QUOTE: RunQuote = {
  model: 'MiMo-V2.6 Pro',
  typicalCredits: 3,
  maxCredits: 9,
  inputChars: 60,
  maxInputChars: 60_000,
  confirmationRequired: false,
};

const SOURCES = [
  { ref: 'S1', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's1', label: 'Стр. 1' },
  { ref: 'S2', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's2', label: 'Стр. 2' },
];

const NOTES: NotesResult = {
  title: 'Строение клетки',
  summary: 'Клетка — основная единица живого.',
  sections: [
    {
      heading: 'Ядро',
      points: ['Ядро хранит ДНК', 'Окружено мембраной'],
      keyTerms: [{ term: 'ДНК', definition: 'Носитель наследственной информации' }],
      sources: ['S2'],
    },
  ],
};

const TABLE: TableResult = {
  title: 'Органоиды',
  description: 'Повторяйте по строкам.',
  columns: ['Органоид', 'Функция'],
  rows: [
    { cells: ['Ядро', 'Хранит ДНК'], sources: ['S2'] },
    { cells: ['Митохондрия', '=Энергия'], sources: ['S1'] },
  ],
};

function runView(patch: Partial<ToolRunView> = {}): ToolRunView {
  return {
    id: 'r1',
    solutionId: 's1',
    operation: 'notes',
    status: 'done',
    input: { subject: 'Биология', focus: '', materials: [{ id: 'm1' }] },
    sources: SOURCES,
    quote: QUOTE,
    result: NOTES,
    resultSchema: 1,
    model: { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' },
    chargedCredits: 2.4,
    error: null,
    createdAt: '2026-11-05T10:05:00.000Z',
    startedAt: '2026-11-05T10:05:00.000Z',
    finishedAt: '2026-11-05T10:05:30.000Z',
    ...patch,
  };
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function installApi(options: {
  quotes?: RunQuote[];
  startError?: { status: number; code: string; details?: Record<string, unknown> };
  runs?: ToolRunView[];
  /** Ответы GET запуска по порядку (последний повторяется). */
  polls?: ToolRunView[];
}) {
  const calls: Call[] = [];
  const quotes = [...(options.quotes ?? [QUOTE])];
  const polls = [...(options.polls ?? [runView()])];
  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const path = url.pathname.replace(/^\/api\/solutions/, '');
    if (path === '/s1' && method === 'GET') return json(200, TOOL);
    if (path === '/s1/materials' && method === 'GET') {
      return json(200, {
        materials: [MATERIAL],
        usage: {
          count: 1,
          maxCount: 20,
          userChars: 60,
          maxUserChars: 3_000_000,
          maxMaterialChars: 200_000,
        },
      });
    }
    if (path === '/s1/progress') {
      return json(200, {
        progress: {
          totals: { attempts: 0, completed: 0, answered: 0, earned: 0, pending: 0, accuracy: null },
          topics: [],
          recommendations: [{ kind: 'start' }],
          history: [],
        },
      });
    }
    if (path === '/s1/runs/quote')
      return json(200, { quote: quotes.length > 1 ? quotes.shift() : quotes[0] });
    if (path === '/s1/runs' && method === 'POST') {
      if (options.startError) {
        const error = options.startError;
        options.startError = undefined;
        return json(error.status, {
          error: { code: error.code, message: 'x', details: error.details },
        });
      }
      return json(202, {
        run: runView({ status: 'queued', result: null, chargedCredits: 0 }),
        duplicate: false,
      });
    }
    if (path === '/s1/runs' && method === 'GET') {
      return json(200, {
        runs: (options.runs ?? []).map(({ result, input: runInput, sources: _s, ...rest }) => ({
          ...rest,
          title: result && 'title' in result ? result.title : null,
          subject: runInput.subject,
        })),
      });
    }
    if (/^\/s1\/runs\/r\d+$/.test(path) && method === 'GET') {
      return json(200, { run: polls.length > 1 ? polls.shift() : polls[0] });
    }
    if (/^\/s1\/runs\/r\d+$/.test(path) && method === 'DELETE') return json(204, null);
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { calls };
}

async function fillForm() {
  await screen.findByRole('heading', { level: 2, name: 'Создать' });
  const form = screen.getByRole('heading', { level: 2, name: 'Создать' }).closest('section')!;
  fireEvent.click(await within(form).findByRole('checkbox', { name: /Биология\.pdf/ }));
  fireEvent.change(within(form).getByRole('textbox', { name: 'Предмет или тема' }), {
    target: { value: 'Биология' },
  });
  return form;
}

describe('Учебный помощник: конспект и таблица — цена, запуск, результат', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('цена видна до запуска; запуск уходит с принятой ценой и ключом; открывается конспект с источниками', async () => {
    signIn();
    const api = installApi({
      polls: [runView({ status: 'running', result: null, chargedCredits: 0 }), runView()],
    });
    renderRoute('/solutions/s1');
    const form = await fillForm();
    const start = await within(form).findByRole('button', {
      name: 'Создать: Конспект — до 9 кредитов',
    });
    expect(
      within(form).getByText(/Стоимость: ≈ 3, не больше 9 кредитов · MiMo-V2\.6 Pro/),
    ).toBeVisible();
    fireEvent.click(start);

    // Страница результата: свой интерфейс конспекта.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Строение клетки' }, { timeout: 5000 }),
    ).toBeVisible();
    const post = api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/runs'))!;
    expect(post.body).toMatchObject({
      operation: 'notes',
      input: { subject: 'Биология', focus: '', materials: [{ id: 'm1' }] },
      acceptedMaxCredits: 9,
    });
    expect(String(post.body?.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(screen.getByRole('heading', { level: 2, name: 'Ядро' })).toBeVisible();
    expect(screen.getByText('Ядро хранит ДНК')).toBeVisible();
    expect(screen.getByText('ДНК')).toBeVisible();
    expect(screen.getByText('Биология.pdf · Стр. 2')).toBeVisible();
    expect(screen.getByText(/списано 2,4 кр\./)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Сообщение помощнику' })).toBeNull();
  });

  it('только выбранные части уходят в запуск', async () => {
    signIn();
    const api = installApi({});
    renderRoute('/solutions/s1');
    const form = await fillForm();
    fireEvent.click(within(form).getByText('Выбрать части'));
    fireEvent.click(within(form).getByRole('checkbox', { name: /Стр\. 1/ }));
    fireEvent.click(await within(form).findByRole('button', { name: /до 9 кредитов/ }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(
        true,
      ),
    );
    const post = api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/runs'))!;
    expect(post.body?.input).toMatchObject({ materials: [{ id: 'm1', sections: ['s2'] }] });
  });

  it('цена выросла к запуску — новая цена и подтверждение, повтор с тем же ключом', async () => {
    signIn();
    const api = installApi({
      startError: {
        status: 409,
        code: 'confirmation_required',
        details: { quote: { ...QUOTE, maxCredits: 12, typicalCredits: 4 } },
      },
    });
    renderRoute('/solutions/s1');
    const form = await fillForm();
    fireEvent.click(await within(form).findByRole('button', { name: /до 9 кредитов/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/не больше 12 кредитов/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Запустить — до 12 кредитов' }));
    await screen.findByRole('heading', { level: 1, name: 'Строение клетки' }, { timeout: 5000 });
    const posts = api.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/runs'));
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toMatchObject({ acceptedMaxCredits: 12, confirm: true });
    expect(posts[1]?.body?.idempotencyKey).toBe(posts[0]?.body?.idempotencyKey);
  });

  it('дорогой запуск — сначала подтверждение в окне', async () => {
    signIn();
    const api = installApi({ quotes: [{ ...QUOTE, maxCredits: 80, confirmationRequired: true }] });
    renderRoute('/solutions/s1');
    const form = await fillForm();
    fireEvent.click(await within(form).findByRole('button', { name: /до 80 кредитов/ }));
    const dialog = await screen.findByRole('dialog');
    expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(
      false,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Запустить — до 80 кредитов' }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/runs'))?.body,
      ).toMatchObject({ acceptedMaxCredits: 80, confirm: true }),
    );
  });

  it('нехватка кредитов — понятное сообщение с ценой и остатком', async () => {
    signIn();
    installApi({
      startError: {
        status: 402,
        code: 'insufficient_credits',
        details: { maxCredits: 9, balanceCredits: 2 },
      },
    });
    renderRoute('/solutions/s1');
    const form = await fillForm();
    fireEvent.click(await within(form).findByRole('button', { name: /до 9 кредитов/ }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/9/);
  });

  it('таблица — настоящая таблица с источниками и выгрузкой CSV', async () => {
    signIn();
    installApi({ polls: [runView({ operation: 'table', result: TABLE })] });
    renderRoute('/solutions/s1/runs/r1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Органоиды' })).toBeVisible();
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Органоид', 'Функция', 'Источник']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Биология.pdf · Стр. 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeVisible();
  });

  it('неудачный запуск — сообщение, сколько списано, и «Запустить ещё раз» с новой ценой', async () => {
    signIn();
    const api = installApi({
      polls: [
        runView({
          status: 'failed',
          result: null,
          chargedCredits: 1.5,
          error: {
            code: 'model_output_invalid',
            message: 'Модель дважды ответила не в том формате. Запустите ещё раз.',
          },
        }),
      ],
    });
    renderRoute('/solutions/s1/runs/r1');
    expect(
      await screen.findByText('Модель дважды ответила не в том формате. Запустите ещё раз.'),
    ).toBeVisible();
    expect(screen.getByText(/списано 1,5 кр\./)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Запустить ещё раз' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/не больше 9 кредитов/)).toBeVisible();
    expect(api.calls.some((call) => call.path.endsWith('/runs/quote'))).toBe(true);
    expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(
      false,
    );
  });

  it('история результатов на странице инструмента ведёт к каждому результату', async () => {
    signIn();
    installApi({ runs: [runView(), runView({ id: 'r2', operation: 'table', result: TABLE })] });
    renderRoute('/solutions/s1');
    const list = await screen.findByRole('list', { name: 'Результаты' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/solutions/s1/runs/r1',
      '/solutions/s1/runs/r2',
    ]);
    expect(within(list).getByText('Строение клетки')).toBeVisible();
    expect(within(list).getByText('Органоиды')).toBeVisible();
  });
});
