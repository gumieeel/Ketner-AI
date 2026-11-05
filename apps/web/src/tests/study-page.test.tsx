import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { ToolSolutionDetails } from '@/features/builder/api';
import type { MaterialSummary } from '@/features/study/api';
import { MATERIAL_LIMITS } from '@/features/study/extract';
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

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function installStudyApi(options: { uploadError?: { status: number; code: string } } = {}) {
  const calls: Call[] = [];
  let materials: Array<MaterialSummary & { text: string }> = [];
  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const usage = () => ({
    count: materials.length,
    maxCount: MATERIAL_LIMITS.materialsPerSolution,
    userChars: materials.reduce((sum, item) => sum + item.charCount, 0),
    maxUserChars: MATERIAL_LIMITS.materialCharsPerUser,
    maxMaterialChars: MATERIAL_LIMITS.materialChars,
  });
  const summary = ({ text: _text, ...item }: MaterialSummary & { text: string }) => item;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const path = url.pathname.replace(/^\/api\/solutions/, '');
    if (path === '/s1' && method === 'GET') return json(200, TOOL);
    if (path === '/s1/runs' && method === 'GET') return json(200, { runs: [] });
    if (path === '/s1/materials' && method === 'GET') {
      return json(200, { materials: materials.map(summary), usage: usage() });
    }
    if (path === '/s1/materials' && method === 'POST') {
      if (options.uploadError) {
        return json(options.uploadError.status, {
          error: { code: options.uploadError.code, message: 'server text' },
        });
      }
      const sections = (body?.sections ?? []) as Array<{ label: string; text: string }>;
      const text = sections.map((section) => section.text).join('\n');
      const existing = materials.find((item) => item.text === text);
      if (existing) return json(200, { material: summary(existing), duplicate: true });
      const created = {
        id: `m${materials.length + 1}`,
        solutionId: 's1',
        name: String(body?.name),
        format: body?.format as MaterialSummary['format'],
        sizeBytes: Number(body?.sizeBytes),
        charCount: text.length,
        sections: sections.map((section, i) => ({
          id: `s${i + 1}`,
          label: section.label,
          chars: section.text.length,
        })),
        createdAt: '2026-11-05T11:00:00.000Z',
        text,
      };
      materials = [created, ...materials];
      return json(201, { material: summary(created), duplicate: false });
    }
    const one = /^\/s1\/materials\/([^/]+)$/.exec(path);
    if (one && method === 'GET') {
      const item = materials.find((material) => material.id === one[1]);
      return item
        ? json(200, {
            material: {
              ...summary(item),
              sections: [
                {
                  id: 's1',
                  label: item.sections[0]?.label,
                  text: item.text,
                  chars: item.charCount,
                },
              ],
            },
          })
        : json(404, { error: { code: 'material_not_found', message: '' } });
    }
    if (one && method === 'DELETE') {
      materials = materials.filter((material) => material.id !== one[1]);
      return json(204, null);
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { calls };
}

function chooseFile(name: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const picked = {
    name,
    size: bytes.length,
    type: 'text/plain',
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [picked] } });
}

describe('Учебный помощник: страница инструмента и материалы', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('инструмент открывается своей страницей, а не настройками или чатом помощника', async () => {
    signIn();
    installStudyApi();
    renderRoute('/solutions/s1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Подготовка к ЕНТ' }),
    ).toBeVisible();
    expect(screen.getByText('Учебный помощник')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Материалы' })).toBeVisible();
    expect(await screen.findByText('Документов пока нет.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Сохранить как новую версию' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Сообщение помощнику' })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.pdf,.docx,.pptx,.xlsx,.txt',
    );
  });

  it('загрузка: на сервер уходит только текст по частям; повтор — «уже загружен»', async () => {
    signIn();
    const api = installStudyApi();
    renderRoute('/solutions/s1');
    await screen.findByText('Документов пока нет.');

    chooseFile('Биология.txt', 'Клетка — единица живого.\n\nЯдро хранит ДНК.');
    expect(await screen.findByText('Загружено: «Биология.txt».')).toBeVisible();
    const post = api.calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/solutions/s1/materials');
    expect(post?.body).toEqual({
      name: 'Биология.txt',
      format: 'txt',
      sizeBytes: expect.any(Number),
      sections: [{ label: 'Часть 1', text: 'Клетка — единица живого.\n\nЯдро хранит ДНК.' }],
    });
    const list = screen.getByRole('list', { name: 'Материалы' });
    expect(within(list).getByText('Биология.txt')).toBeVisible();
    expect(screen.getByText(/Документов: 1 из 20/)).toBeVisible();

    chooseFile('Копия.txt', 'Клетка — единица живого.\n\nЯдро хранит ДНК.');
    expect(
      await screen.findByText('«Биология.txt» уже загружен — повторно не добавлен.'),
    ).toBeVisible();
  });

  it('документ без текста — честное сообщение про OCR, запрос не отправляется', async () => {
    signIn();
    const api = installStudyApi();
    renderRoute('/solutions/s1');
    await screen.findByText('Документов пока нет.');
    chooseFile('скан.txt', '   \n\n  ');
    expect(
      await screen.findByText(/распознавание текста \(OCR\) пока не поддерживается/),
    ).toBeVisible();
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('ошибка лимита с сервера объясняется своими словами', async () => {
    signIn();
    installStudyApi({ uploadError: { status: 409, code: 'materials_limit' } });
    renderRoute('/solutions/s1');
    await screen.findByText('Документов пока нет.');
    chooseFile('ещё.txt', 'текст');
    expect(
      await screen.findByText('В инструменте уже максимум документов. Удалите ненужные.'),
    ).toBeVisible();
  });

  it('документ больше лимита: выбрать части и загрузить только их', async () => {
    signIn();
    const api = installStudyApi();
    renderRoute('/solutions/s1');
    await screen.findByText('Документов пока нет.');
    const paragraph = `${'Глава. '.repeat(500)}\n`;
    const big = paragraph.repeat(
      Math.ceil((MATERIAL_LIMITS.materialChars * 1.5) / paragraph.length),
    );
    chooseFile('учебник.txt', big);
    expect(await screen.findByText(/Выберите части, которые загрузить/)).toBeVisible();
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить выбранное' }));
    expect(await screen.findByText('Загружено: «учебник.txt».')).toBeVisible();
    const post = api.calls.find((call) => call.method === 'POST')!;
    const sent = (post.body?.sections as Array<{ text: string }>).reduce(
      (sum, section) => sum + section.text.trim().length,
      0,
    );
    expect(sent).toBeLessThanOrEqual(MATERIAL_LIMITS.materialChars);
    expect(sent).toBeGreaterThan(0);
  });

  it('просмотр текста и удаление с подтверждением', async () => {
    signIn();
    const api = installStudyApi();
    renderRoute('/solutions/s1');
    await screen.findByText('Документов пока нет.');
    chooseFile('Химия.txt', 'Периодическая таблица Менделеева');
    await screen.findByText('Загружено: «Химия.txt».');

    fireEvent.click(screen.getByRole('button', { name: 'Текст' }));
    const viewer = await screen.findByRole('dialog');
    expect(await within(viewer).findByText('Периодическая таблица Менделеева')).toBeVisible();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(/будет удалён с сервера/)).toBeVisible();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Документов пока нет.')).toBeVisible();
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/m1'))).toBe(
        true,
      ),
    );
  });
});
