import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import type { SolutionView, TemplateCard } from '@/features/builder/api';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

function signIn(): void {
  useAuth.setState({
    status: 'authenticated',
    token: 'mock-token',
    user: { id: 'u1', email: 'student@example.com', name: 'Student', plan: 'credits' } as never,
  });
}

const STUDY: TemplateCard = {
  id: 'study_assistant',
  kind: 'tool',
  label: 'Учебный помощник',
  description: 'инструмент для учёбы: загрузите учебные материалы',
};

const base = {
  bot: null,
  currentVersion: 1,
  activeVersion: 1,
  source: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
};
const TOOL: SolutionView = {
  ...base,
  id: 's1',
  type: 'tool',
  kind: 'tool',
  template: 'study_assistant',
  status: 'active',
  name: 'Биология',
};
const ASSISTANT: SolutionView = {
  ...base,
  id: 's2',
  type: 'assistant',
  kind: 'assistant',
  template: 'personal_assistant',
  status: 'active',
  name: 'Черновики',
};

function installApi(options: { templates: TemplateCard[]; solutions?: SolutionView[] }) {
  const posts: Array<Record<string, unknown> | null> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    if (path === '/api/solutions' && method === 'GET') {
      return json(200, { solutions: options.solutions ?? [], runway: null });
    }
    if (path === '/api/solutions/templates') return json(200, { templates: options.templates });
    if (path === '/api/solutions' && method === 'POST') {
      posts.push(init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null);
      return json(201, { solution: { ...TOOL, id: 's7', name: 'Учебный помощник' } });
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return { posts };
}

describe('Мои автоматизации: галерея инструментов', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('карточка учебного помощника: что умеет, форматы, цена; «Создать» создаёт инструмент', async () => {
    signIn();
    const api = installApi({ templates: [STUDY] });
    renderRoute('/solutions');
    const card = (
      await screen.findByRole('heading', { level: 3, name: 'Учебный помощник' })
    ).closest('article')!;
    expect(screen.getByRole('heading', { level: 2, name: 'Готовые инструменты' })).toBeVisible();
    const features = within(card).getByRole('list', { name: 'Что умеет' });
    expect(within(features).getAllByRole('listitem')).toHaveLength(6);
    expect(within(card).getByText(/Проверка открытых ответов/)).toBeVisible();
    expect(within(card).getByText(/PDF, DOCX, PPTX, XLSX, TXT/)).toBeVisible();
    expect(within(card).getByText(/Создание бесплатно/)).toBeVisible();

    fireEvent.click(within(card).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toEqual({ template: 'study_assistant', language: 'ru' });
  });

  it('сервер не вернул шаблонов (выключен) — галереи нет, создание помощника с нуля на месте', async () => {
    signIn();
    installApi({ templates: [] });
    renderRoute('/solutions');
    expect(await screen.findByRole('button', { name: 'Создать с нуля' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Готовые инструменты')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Учебный помощник' })).toBeNull();
  });

  it('в списке инструмент назван своим шаблоном и не ведёт в чат; помощник — ведёт', async () => {
    signIn();
    installApi({ templates: [], solutions: [TOOL, ASSISTANT] });
    renderRoute('/solutions');
    const tool = (await screen.findByRole('link', { name: 'Биология' })).closest('li')!;
    expect(within(tool).getByText('Учебный помощник')).toBeVisible();
    expect(within(tool).queryByRole('link', { name: 'Открыть чат' })).toBeNull();
    const assistant = screen.getByRole('link', { name: 'Черновики' }).closest('li')!;
    expect(within(assistant).getByRole('link', { name: 'Открыть чат' })).toHaveAttribute(
      'href',
      '/solutions/s2/chat',
    );
  });
});
