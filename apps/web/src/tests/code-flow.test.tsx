import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCode } from '@/features/code/code-store';
import type { AgentEvent, CodeCapabilities, CodeProject, ThreadItem } from '@/features/code/types';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const CAPABILITIES: CodeCapabilities = {
  plan: 'free',
  limits: {
    maxProjects: 3,
    maxFiles: 200,
    maxProjectBytes: 1024 * 1024,
    maxFileBytes: 200 * 1024,
    runsPerDay: 5,
    maxSteps: 8,
    maxRunCostUsd: 0.05,
    commands: false,
    commandTimeoutSec: 30,
    maxTaskChars: 4000,
  },
  usage: { projects: 1, runsToday: 0 },
  commands: { available: false, reason: 'plan', network: false },
  templates: ['empty', 'node'],
  models: [
    { id: 'ketner-mini', name: 'Ketner Mini', costClass: 'lite', locked: false },
    { id: 'ketner-pro', name: 'Ketner Pro', costClass: 'work', locked: true },
  ],
  defaultModelId: 'auto',
};

const PROJECT: CodeProject = {
  id: 'p1',
  name: 'Мой сайт',
  source: { type: 'template', ref: 'web' },
  fileCount: 2,
  totalBytes: 120,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sse(events: AgentEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

interface Calls {
  runBodies: Array<Record<string, unknown>>;
  writes: Array<{ path: string; content: string }>;
  deleted: string[];
}

function installCodeApi(options: { projects?: CodeProject[]; thread?: ThreadItem[]; run?: AgentEvent[] } = {}): Calls {
  const calls: Calls = { runBodies: [], writes: [], deleted: [] };
  let projects = options.projects ?? [PROJECT];
  // Сервер хранит ленту сам: после запуска клиент перечитывает её, поэтому фейк повторяет это поведение.
  const serverThread: ThreadItem[] = [...(options.thread ?? [])];
  const persist = (task: string, events: AgentEvent[]): void => {
    if (events.some((e) => e.type === 'error')) return; // отклонённые запуски в ленту не попадают
    const now = '2026-01-03T00:00:00Z';
    serverThread.push({ id: `u${serverThread.length}`, kind: 'user', text: task, createdAt: now });
    for (const e of events) {
      if (e.type === 'tool_result') {
        serverThread.push({ id: `t${e.callId}`, kind: 'tool', runId: 'r1', step: e.step, tool: e.tool, label: e.label, ok: e.ok, summary: e.summary, change: e.change, createdAt: now });
      } else if (e.type === 'done') {
        serverThread.push({ id: `r${serverThread.length}`, kind: 'run', runId: e.runId, status: e.status, steps: e.steps, costUsd: e.costUsd, modelId: e.modelId, message: e.message, ...(e.plan ? { plan: e.plan } : {}), createdAt: now });
      }
    }
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^.*\/code/, '');
      const method = init?.method ?? 'GET';
      if (!url.pathname.includes('/code')) return json({ error: { code: 'not_found', message: 'нет' } }, 404);

      if (path === '/capabilities') return json(CAPABILITIES);
      if (path === '/projects' && method === 'GET') return json({ projects });
      if (path === '/projects' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        const created = { ...PROJECT, id: 'p2', name: body.name };
        projects = [created, ...projects];
        return json({ project: created }, 201);
      }
      if (path === '/projects/p1' && method === 'GET') return json({ project: PROJECT, running: false });
      if (path === '/projects/p1' && method === 'DELETE') {
        calls.deleted.push('p1');
        projects = projects.filter((p) => p.id !== 'p1');
        return new Response(null, { status: 204 });
      }
      if (path === '/projects/p1/files') {
        return json({
          files: [
            { path: 'index.html', size: 40, language: 'html', modifiedAt: '' },
            { path: 'src/app.js', size: 80, language: 'javascript', modifiedAt: '' },
          ],
          fileCount: 2,
          totalBytes: 120,
        });
      }
      if (path === '/projects/p1/thread') return json({ items: serverThread, running: false });
      if (path === '/projects/p1/file' && method === 'GET') {
        const file = url.searchParams.get('path') ?? '';
        return json({ path: file, content: `// ${file}\n`, size: 10, language: 'javascript' });
      }
      if (path === '/projects/p1/file' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { path: string; content: string };
        calls.writes.push(body);
        return json({ file: { path: body.path, size: body.content.length, language: 'javascript', modifiedAt: '' }, created: false });
      }
      if (path === '/projects/p1/run' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.runBodies.push(body);
        persist(String(body.task), options.run ?? []);
        return sse(options.run ?? []);
      }
      return json({ error: { code: 'not_found', message: `неизвестный путь ${path}` } }, 404);
    }),
  );
  return calls;
}

function resetCode(): void {
  useCode.getState().closeProject();
  useCode.setState({
    capabilities: null,
    projects: [],
    projectsStatus: 'idle',
    authRequired: false,
    modelId: 'auto',
    changed: {},
    notice: null,
    thread: [],
    running: false,
    live: null,
  });
}

describe('Ketner Code: проекты и агент', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    resetChat();
    resetCode();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('показывает список проектов и форму создания, без счётчиков лимитов', async () => {
    installCodeApi();
    renderRoute('/code');

    const link = await screen.findByRole('link', { name: /Мой сайт/ });
    expect(link).toHaveAttribute('href', '/code/p1');
    expect(screen.queryByText(/Проектов: \d+ из \d+/)).toBeNull();
    expect(screen.queryByText('Возможности вашего тарифа')).toBeNull();
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  });

  it('создаёт проект и открывает его рабочее пространство', async () => {
    installCodeApi();
    const user = userEvent.setup();
    renderRoute('/code');
    await screen.findByRole('link', { name: /Мой сайт/ });

    await user.type(screen.getByLabelText('Название'), 'Новый');
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(useCode.getState().projects[0]?.name).toBe('Новый'));
  });

  it('открывает проект: дерево файлов и пустая лента агента', async () => {
    installCodeApi();
    renderRoute('/code/p1');

    expect(await screen.findByText('index.html')).toBeInTheDocument();
    expect(screen.getByText('Опишите задачу — агент изучит проект, внесёт правки и проверит результат.')).toBeInTheDocument();
    expect(screen.getByText('Запуск команд (тесты, сборка) доступен на тарифах Pro и Ultra.')).toBeInTheDocument();
    // Модель, недоступная на тарифе, видна, но выбрать её нельзя.
    const locked = screen.getByRole('option', { name: /Ketner Pro/ });
    expect(locked).toBeDisabled();
  });

  it('запускает агента: показывает правку с diff, итог и обновляет файлы', async () => {
    const calls = installCodeApi({
      run: [
        { type: 'run_start', runId: 'r1', modelId: 'ketner-mini', modelName: 'Ketner Mini', maxSteps: 8, budgetUsd: 0.05, commands: false, routingReason: null },
        { type: 'delta', step: 1, content: 'Добавляю заголовок.' },
        { type: 'tool_call', step: 1, callId: 'c1', tool: 'edit_file', label: 'edit_file index.html' },
        {
          type: 'tool_result',
          step: 1,
          callId: 'c1',
          tool: 'edit_file',
          label: 'edit_file index.html',
          ok: true,
          summary: 'ok',
          change: { path: 'index.html', action: 'modify', additions: 2, deletions: 1, patch: '@@ -1,1 +1,2 @@\n-старое\n+новое\n+ещё' },
        },
        { type: 'step_done', step: 1, costUsd: 0.001, totalCostUsd: 0.001 },
        { type: 'done', runId: 'r1', status: 'completed', steps: 1, costUsd: 0.001, modelId: 'ketner-mini' },
      ],
    });
    const user = userEvent.setup();
    renderRoute('/code/p1');
    await screen.findByText('index.html');

    await user.type(screen.getByLabelText('Опишите задачу: что создать или изменить…'), 'Добавь заголовок');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    expect(await screen.findByText('Готово')).toBeInTheDocument();
    expect(calls.runBodies).toHaveLength(1);
    expect(calls.runBodies[0]).toMatchObject({ task: 'Добавь заголовок', modelId: 'auto' });
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Показать изменения' }));
    expect(await screen.findByText('+новое')).toHaveAttribute('data-diff', 'add');
    expect(screen.getByText('-старое')).toHaveAttribute('data-diff', 'del');
    expect(useCode.getState().running).toBe(false);
  });

  it('список задач сверху: агент делит задачу на подзадачи, прогресс виден и после завершения', async () => {
    const planStart = [
      { text: 'Создать компонент Button', status: 'in_progress' as const },
      { text: 'Подключить Button в Header', status: 'pending' as const },
    ];
    const planDone = planStart.map((item) => ({ ...item, status: 'done' as const }));
    installCodeApi({
      run: [
        { type: 'run_start', runId: 'r1', modelId: 'claude-opus-5.5', modelName: 'Claude Opus 5.5', maxSteps: 50, budgetUsd: 2, commands: false, routingReason: null },
        { type: 'tool_call', step: 1, callId: 'p1', tool: 'update_plan', label: 'update_plan' },
        { type: 'tool_result', step: 1, callId: 'p1', tool: 'update_plan', label: 'update_plan', ok: true, summary: '0/2' },
        { type: 'plan', items: planStart },
        { type: 'model_switch', modelId: 'ketner-pro', modelName: 'Ketner Pro', reason: 'Продолжаю на модели дешевле' },
        { type: 'plan', items: planDone },
        { type: 'step_done', step: 2, costUsd: 0.01, totalCostUsd: 2.01 },
        { type: 'done', runId: 'r1', status: 'completed', steps: 2, costUsd: 2.01, modelId: 'ketner-pro', plan: planDone },
      ],
    });
    const user = userEvent.setup();
    renderRoute('/code/p1');
    await screen.findByText('index.html');

    await user.type(screen.getByLabelText('Опишите задачу: что создать или изменить…'), 'Сделай кнопку');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    expect(await screen.findByText('Готово')).toBeInTheDocument();
    const tasks = await screen.findByRole('region', { name: 'Задачи' });
    expect(within(tasks).getByText('Создать компонент Button')).toBeInTheDocument();
    expect(within(tasks).getByText('2 из 2')).toBeInTheDocument();
    // Компактный прогресс в шапке проекта.
    expect(screen.getByRole('button', { name: 'Задачи агента: 2 из 2' })).toBeInTheDocument();
    // Переход на модель дешевле — без сообщения об ошибке.
    expect(screen.queryByRole('alert')).toBeNull();

    // Список сворачивается.
    await user.click(within(tasks).getByRole('button', { expanded: true }));
    expect(within(tasks).queryByText('Подключить Button в Header')).toBeNull();
  });

  it('ошибка лимита запуска предлагает улучшить план', async () => {
    installCodeApi({ run: [{ type: 'error', code: 'upgrade_required', message: 'Лимит запусков на сегодня исчерпан' }] });
    const user = userEvent.setup();
    renderRoute('/code/p1');
    await screen.findByText('index.html');

    await user.type(screen.getByLabelText('Опишите задачу: что создать или изменить…'), 'Сделай что-нибудь');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    const upgrade = await within(screen.getByRole('region', { name: 'Агент' })).findByRole('link', { name: 'Улучшить план' });
    expect(upgrade).toHaveAttribute('href', '/pricing');
    expect(screen.getByText('Лимит запусков на сегодня исчерпан')).toBeInTheDocument();
  });

  it('несохранённые правки в редакторе сохраняются перед запуском агента', async () => {
    const calls = installCodeApi({
      run: [{ type: 'done', runId: 'r1', status: 'completed', steps: 0, costUsd: 0, modelId: 'ketner-mini' }],
    });
    const user = userEvent.setup();
    renderRoute('/code/p1');
    await user.click(await screen.findByText('index.html'));
    const editor = await screen.findByRole('textbox', { name: /index\.html/ });
    await user.type(editor, 'x');
    expect(screen.getAllByText('Не сохранено').length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText('Опишите задачу: что создать или изменить…'), 'Проверь');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(calls.runBodies).toHaveLength(1));
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0].path).toBe('index.html');
    expect(calls.writes[0].content).toContain('x');
  });

  it('удаляет проект после подтверждения', async () => {
    const calls = installCodeApi();
    const user = userEvent.setup();
    renderRoute('/code');
    await screen.findByRole('link', { name: /Мой сайт/ });

    await user.click(screen.getByRole('button', { name: 'Удалить: Мой сайт' }));
    const row = screen.getByRole('button', { name: 'Удалить' }).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(calls.deleted).toEqual(['p1']));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Мой сайт/ })).toBeNull());
  });

  it('гостю вместо проектов предлагается войти', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'unauthorized', message: 'Войдите в аккаунт' } }, 401)),
    );
    renderRoute('/code');

    expect(await screen.findByRole('heading', { name: 'Войдите, чтобы работать с проектами' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    expect(main.getByRole('link', { name: 'Регистрация' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: 'Создать' })).toBeNull();
  });

  it('в боковом меню есть ссылка на Ketner Code', () => {
    installCodeApi();
    renderRoute('/code');
    expect(screen.getByRole('link', { name: 'Ketner Code' })).toHaveAttribute('href', '/code');
  });
});
