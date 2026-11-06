import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { ToolSolutionDetails } from '@/features/builder/api';
import type {
  AttemptView,
  MaterialSummary,
  Progress,
  QuestionSetView,
  RunQuote,
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
      email: 's@example.com',
      name: 'S',
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
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
  },
  config: { tool: 'study_assistant', language: 'ru', subject: '' },
  versions: [{ number: 1, createdAt: '2026-11-06T10:00:00.000Z' }],
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
  createdAt: '2026-11-06T10:00:00.000Z',
};

const QUOTE: RunQuote = {
  model: 'MiMo-V2.6 Pro',
  typicalCredits: 4,
  maxCredits: 12,
  inputChars: 60,
  maxInputChars: 60_000,
  confirmationRequired: false,
};
const SOURCES = [
  { ref: 'S1', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's1', label: 'Стр. 1' },
  { ref: 'S2', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's2', label: 'Стр. 2' },
];

const SET: QuestionSetView = {
  title: 'Клетка',
  rejected: 2,
  questions: [
    {
      id: 'q1',
      type: 'choice',
      question: 'Что хранит ДНК?',
      options: ['Ядро', 'Мембрана'],
      topic: 'Ядро',
      sources: ['S2'],
    },
    { id: 'q2', type: 'open', question: 'Объясните роль ядра.', topic: 'Ядро', sources: ['S2'] },
  ],
};

const QUIZ_RUN: ToolRunView = {
  id: 'r1',
  solutionId: 's1',
  operation: 'quiz',
  status: 'done',
  input: { subject: 'Биология', focus: '', materials: [{ id: 'm1' }], count: 5, format: 'mixed' },
  sources: SOURCES,
  quote: QUOTE,
  result: SET,
  resultSchema: 1,
  model: { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' },
  chargedCredits: 3,
  error: null,
  createdAt: '2026-11-06T10:05:00.000Z',
  startedAt: '2026-11-06T10:05:00.000Z',
  finishedAt: '2026-11-06T10:05:30.000Z',
};

const inProgress: AttemptView = {
  id: 'a1',
  runId: 'r1',
  kind: 'quiz',
  status: 'in_progress',
  title: 'Клетка',
  questions: SET.questions,
  answers: {},
  results: null,
  score: null,
  maxScore: 2,
  retryOf: null,
  grade: null,
  sources: SOURCES,
  createdAt: '2026-11-06T10:06:00.000Z',
  submittedAt: null,
  gradedAt: null,
};

const revealed = [
  {
    ...SET.questions[0]!,
    correctIndex: 0,
    explanation: 'Ядро хранит ДНК.',
    evidence: 'Ядро хранит ДНК',
  },
  {
    ...SET.questions[1]!,
    modelAnswer: 'Ядро хранит ДНК.',
    keyPoints: ['хранит ДНК'],
    explanation: 'Роль ядра.',
    evidence: 'Ядро хранит ДНК',
  },
];

const submitted: AttemptView = {
  ...inProgress,
  status: 'submitted',
  questions: revealed,
  answers: { q1: { selected: 1 }, q2: { text: 'Там белки' } },
  results: [
    { questionId: 'q1', verdict: 'incorrect', score: 0, sources: ['S2'] },
    { questionId: 'q2', verdict: 'pending', score: 0 },
  ],
  score: 0,
  submittedAt: '2026-11-06T10:07:00.000Z',
};

const graded: AttemptView = {
  ...submitted,
  status: 'graded',
  results: [
    submitted.results![0]!,
    {
      questionId: 'q2',
      verdict: 'incorrect',
      score: 0,
      feedback: 'Ядро хранит ДНК, а не белки.',
      missing: ['хранит ДНК'],
      sources: ['S2'],
    },
  ],
  grade: { status: 'done', chargedCredits: 1.2, error: null, quote: QUOTE },
  gradedAt: '2026-11-06T10:08:00.000Z',
};

const PROGRESS: Progress = {
  totals: { attempts: 1, completed: 1, answered: 2, earned: 0, pending: 0, accuracy: 0 },
  topics: [
    {
      topic: 'Ядро',
      answered: 3,
      correct: 0,
      partial: 1,
      incorrect: 2,
      pending: 0,
      earned: 0.5,
      accuracy: 0.17,
      attempts: 1,
      level: 'weak',
      sources: [SOURCES[1]!],
      retryAttemptId: 'a1',
    },
    {
      topic: 'Клетка',
      answered: 1,
      correct: 1,
      partial: 0,
      incorrect: 0,
      pending: 0,
      earned: 1,
      accuracy: 1,
      attempts: 1,
      level: 'insufficient',
      sources: [],
      retryAttemptId: null,
    },
  ],
  recommendations: [
    {
      kind: 'retry_mistakes',
      topic: 'Ядро',
      attemptId: 'a1',
      wrong: 3,
      answered: 3,
      sources: [SOURCES[1]!],
    },
    { kind: 'more_practice', topic: 'Клетка', answered: 1 },
  ],
  history: [
    {
      id: 'a1',
      runId: 'r1',
      kind: 'quiz',
      title: 'Клетка',
      status: 'graded',
      score: 0,
      maxScore: 2,
      answered: 2,
      pending: 0,
      createdAt: '2026-11-06T10:06:00.000Z',
      submittedAt: '2026-11-06T10:07:00.000Z',
    },
  ],
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function installApi(options: { attempts?: AttemptView[]; progress?: Progress } = {}) {
  const calls: Call[] = [];
  const attempts = [...(options.attempts ?? [inProgress])];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const path = url.pathname.replace(/^\/api\/solutions/, '');
    const next = () => (attempts.length > 1 ? attempts.shift()! : attempts[0]!);
    if (path === '/s1' && method === 'GET') return json(200, TOOL);
    if (path === '/s1/materials') {
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
    if (path === '/s1/runs' && method === 'GET') return json(200, { runs: [] });
    if (path === '/s1/runs/quote') return json(200, { quote: QUOTE });
    if (path === '/s1/runs' && method === 'POST')
      return json(202, { run: { ...QUIZ_RUN, status: 'queued', result: null }, duplicate: false });
    if (path === '/s1/runs/r1') return json(200, { run: QUIZ_RUN });
    if (path === '/s1/progress') return json(200, { progress: options.progress ?? PROGRESS });
    if (path === '/s1/attempts' && method === 'GET') return json(200, { attempts: [] });
    if (path === '/s1/runs/r1/attempts' && method === 'POST')
      return json(201, { attempt: { ...inProgress, id: body?.retryOf ? 'a2' : 'a1' } });
    if (/^\/s1\/attempts\/a\d$/.test(path)) return json(200, { attempt: next() });
    if (path.endsWith('/answers')) return json(200, { attempt: inProgress });
    if (path.endsWith('/submit')) return json(200, { attempt: next() });
    if (path.endsWith('/grade/quote')) return json(200, { quote: QUOTE });
    if (path.endsWith('/grade'))
      return json(202, {
        attempt: {
          ...submitted,
          grade: { status: 'running', chargedCredits: 0, error: null, quote: QUOTE },
        },
      });
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { calls };
}

async function chooseMaterial() {
  const form = (await screen.findByRole('heading', { level: 2, name: 'Создать' })).closest(
    'section',
  )!;
  fireEvent.click(await within(form).findByRole('checkbox', { name: /Биология\.pdf/ }));
  fireEvent.change(within(form).getByRole('textbox', { name: 'Предмет или тема' }), {
    target: { value: 'Биология' },
  });
  return form;
}

describe('Учебный помощник: тест, самопроверка, попытки и прогресс', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('тест: число вопросов и формат уходят в запуск с принятой ценой', async () => {
    signIn();
    const api = installApi();
    renderRoute('/solutions/s1');
    const form = await chooseMaterial();
    fireEvent.click(within(form).getByRole('radio', { name: /Тест/ }));
    fireEvent.change(within(form).getByRole('combobox', { name: 'Вопросов' }), {
      target: { value: '10' },
    });
    fireEvent.click(within(form).getByRole('radio', { name: 'С вариантами' }));
    fireEvent.click(
      await within(form).findByRole('button', { name: 'Создать: Тест — до 12 кредитов' }),
    );
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(
        true,
      ),
    );
    const post = api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/runs'))!;
    expect(post.body).toMatchObject({
      operation: 'quiz',
      acceptedMaxCredits: 12,
      input: {
        subject: 'Биология',
        focus: '',
        materials: [{ id: 'm1' }],
        count: 10,
        format: 'choice',
      },
    });
  });

  it('самопроверка: без темы цены нет; вход — тема вместо пожеланий', async () => {
    signIn();
    const api = installApi();
    renderRoute('/solutions/s1');
    const form = await chooseMaterial();
    fireEvent.click(within(form).getByRole('radio', { name: /Самопроверка/ }));
    expect(within(form).getByRole('button', { name: 'Создать: Самопроверка' })).toBeDisabled();
    fireEvent.change(within(form).getByRole('textbox', { name: 'Тема для самопроверки' }), {
      target: { value: 'Ядро' },
    });
    fireEvent.click(
      await within(form).findByRole('button', { name: /Самопроверка — до 12 кредитов/ }),
    );
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/runs'))).toBe(
        true,
      ),
    );
    const post = api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/runs'))!;
    expect(post.body?.input).toEqual({
      subject: 'Биология',
      topic: 'Ядро',
      materials: [{ id: 'm1' }],
      count: 5,
    });
  });

  it('готовый тест: что в нём, сколько вопросов отброшено проверкой, начать попытку', async () => {
    signIn();
    const api = installApi();
    renderRoute('/solutions/s1/runs/r1');
    expect(await screen.findByText('Вопросов: 2. Темы: Ядро.')).toBeVisible();
    expect(screen.getByText(/Проверка отбросила вопросов: 2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Пройти тест' }));
    // Заголовок «Клетка» есть и на странице теста — ждём то, что есть только у попытки.
    expect(await screen.findByRole('button', { name: 'Сдать ответы' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Клетка' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Пройти тест' })).toBeNull();
    expect(
      api.calls.some(
        (call) => call.method === 'POST' && call.path === '/api/solutions/s1/runs/r1/attempts',
      ),
    ).toBe(true);
  });

  it('удаление теста предупреждает, что попытки и их вклад в прогресс тоже удалятся', async () => {
    signIn();
    installApi();
    renderRoute('/solutions/s1/runs/r1');
    await screen.findByText('Вопросов: 2. Темы: Ядро.');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить результат' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        /вместе со всеми попытками — они перестанут учитываться в прогрессе/,
      ),
    ).toBeVisible();
  });

  it('попытка: до сдачи ключей нет; ответы сохраняются сами; сдача — разбор с ключом, цитатой и страницей', async () => {
    signIn();
    const api = installApi({ attempts: [inProgress, submitted] });
    renderRoute('/solutions/s1/attempts/a1');
    expect(await screen.findByText('Что хранит ДНК?')).toBeVisible();
    expect(screen.queryByText(/верный ответ/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Мембрана' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ваш ответ на вопрос 2' }), {
      target: { value: 'Там белки' },
    });
    await waitFor(
      () =>
        expect(
          api.calls.some((call) => call.method === 'PUT' && call.path.endsWith('/answers')),
        ).toBe(true),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сдать ответы' }));

    const review = await screen.findByRole('list', { name: 'Разбор ответов' });
    expect(api.calls.find((call) => call.path.endsWith('/submit'))?.body).toEqual({
      answers: { q1: { selected: 1 }, q2: { text: 'Там белки' } },
    });
    expect(within(review).getByText('Неверно')).toBeVisible();
    expect(within(review).getByText('Ждёт проверки')).toBeVisible();
    expect(within(review).getByText('Ядро — верный ответ')).toBeVisible();
    expect(within(review).getByText('Мембрана — ваш ответ')).toBeVisible();
    expect(within(review).getAllByText('Из материала: «Ядро хранит ДНК»')).toHaveLength(2);
    expect(within(review).getAllByText('Биология.pdf · Стр. 2').length).toBeGreaterThan(0);
  });

  it('проверка открытых ответов: цена на кнопке, запуск с ценой и ключом, разбор ошибок', async () => {
    signIn();
    const api = installApi({
      attempts: [
        submitted,
        {
          ...submitted,
          grade: { status: 'running', chargedCredits: 0, error: null, quote: QUOTE },
        },
        graded,
      ],
    });
    renderRoute('/solutions/s1/attempts/a1');
    const panel = await screen.findByRole('region', { name: 'Проверка открытых ответов' });
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Проверить ответы — до 12 кредитов' }),
    );
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path.endsWith('/grade'))).toBe(
        true,
      ),
    );
    const post = api.calls.find((call) => call.method === 'POST' && call.path.endsWith('/grade'))!;
    expect(post.body?.acceptedMaxCredits).toBe(12);
    expect(String(post.body?.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(
      await screen.findByText('Ядро хранит ДНК, а не белки.', {}, { timeout: 8000 }),
    ).toBeVisible();
    expect(screen.getByText(/Не хватает: хранит ДНК/)).toBeVisible();
    expect(screen.getByText(/Ответы проверены, списано 1,2 кр\./)).toBeVisible();
  });

  it('повторить ошибки — новая попытка только по ним', async () => {
    signIn();
    const api = installApi({ attempts: [graded] });
    renderRoute('/solutions/s1/attempts/a1');
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить ошибки' }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.path === '/api/solutions/s1/runs/r1/attempts')?.body,
      ).toEqual({ retryOf: 'a1' }),
    );
  });

  it('прогресс: темы с честной оценкой, правило рядом, рекомендация повторить ошибки', async () => {
    signIn();
    const api = installApi();
    renderRoute('/solutions/s1');
    const section = (await screen.findByRole('heading', { level: 2, name: 'Прогресс' })).closest(
      'section',
    )!;
    const table = await within(section).findByRole('table');
    expect(within(table).getByText('Стоит повторить')).toBeVisible();
    expect(within(table).getByText('Мало данных')).toBeVisible();
    expect(within(table).queryByText(/освоен/i)).toBeNull();
    expect(within(section).getByText(/Меньше 3 ответов по теме — мало данных/)).toBeVisible();
    expect(
      within(section).getByText('Повторите тему «Ядро»: ошибки в 3 из 3 ответов.'),
    ).toBeVisible();
    expect(within(section).getByText(/По теме «Клетка» пока мало ответов \(1\)/)).toBeVisible();
    fireEvent.click(within(section).getByRole('button', { name: 'Повторить ошибки' }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.path === '/api/solutions/s1/runs/r1/attempts')?.body,
      ).toEqual({ retryOf: 'a1' }),
    );
  });

  it('прогресс без попыток — подсказка начать, без выводов', async () => {
    signIn();
    installApi({
      progress: {
        totals: { attempts: 0, completed: 0, answered: 0, earned: 0, pending: 0, accuracy: null },
        topics: [],
        recommendations: [{ kind: 'start' }],
        history: [],
      },
    });
    renderRoute('/solutions/s1');
    const section = (await screen.findByRole('heading', { level: 2, name: 'Прогресс' })).closest(
      'section',
    )!;
    expect(
      await within(section).findByText(
        'Пройдите тест или самопроверку — здесь появится прогресс по темам.',
      ),
    ).toBeVisible();
    expect(within(section).queryByRole('table')).toBeNull();
  });
});
