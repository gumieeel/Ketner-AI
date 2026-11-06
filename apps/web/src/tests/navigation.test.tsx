import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { setSiteFeatures } from '@/lib/features';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const ANALYSIS = {
  id: 'a1',
  status: 'ready',
  mode: 'free',
  language: 'ru',
  guest: true,
  inputText: 'Веду интернет-магазин.',
  context: { domain: 'Интернет-магазин', summary: 'Много однотипных вопросов покупателей' },
  questions: [],
  answers: {},
  summary: 'Больше всего поможет ИИ в ответах покупателям.',
  saved: false,
  stages: { context: null, discovery: null },
  opportunities: [
    {
      id: 'o1',
      position: 0,
      title: 'Черновики ответов',
      problem: 'Однотипные вопросы',
      solution: 'ИИ пишет черновик, вы проверяете',
      requires: ['text_generation'],
      otherRequirement: null,
      dataNeeded: [],
      integrationsNeeded: [],
      effort: 'low',
      effortReason: '',
      risks: [],
      limitations: [],
      successCriteria: [],
      firstStep: '',
      feasibilityStatus: 'ready',
      feasibility: { status: 'ready', blockers: [], available: [] },
      impact: { kind: 'qualitative', benefit: 'Быстрее', missing: '', note: '' },
      priority: 0,
    },
  ],
  cost: { chargedCredits: 0, sponsored: true },
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

/** Чат — фейковый mock-API, анализ — свой ответ поверх него. */
function installWithAnalysis(): void {
  installFakeApi();
  const chatFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/analyses/a1') {
      return new Response(
        JSON.stringify({ analysis: ANALYSIS, rerun: null, retry: null, plans: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return chatFetch(input, init);
  });
}

describe('навигация платформы решений', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    resetChat();
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('текущий раздел подсвечен в шапке (после входа)', () => {
    setSiteFeatures({ discovery: true });
    installFakeApi();
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: { id: 'u1', email: 'owner@example.com', name: 'Owner', plan: 'credits' } as never,
    });
    renderRoute('/solutions');
    const nav = screen.getAllByRole('navigation', { name: 'Навигация' })[0];
    expect(within(nav).getByRole('link', { name: 'Мои автоматизации' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Анализы' })).not.toHaveAttribute('aria-current');
  });

  it('из чата открываются анализы и помощники; без платформы — как раньше', async () => {
    setSiteFeatures({ discovery: true });
    installFakeApi();
    const view = renderRoute('/chat');
    const sidebar = await screen.findAllByRole('navigation', { name: 'Навигация' });
    const links = sidebar.flatMap((nav) => within(nav).queryAllByRole('link'));
    expect(links.find((link) => link.textContent === 'Анализы')).toHaveAttribute(
      'href',
      '/analyses',
    );
    expect(links.find((link) => link.textContent === 'Мои автоматизации')).toHaveAttribute(
      'href',
      '/solutions',
    );
    view.unmount();

    setSiteFeatures(null);
    renderRoute('/chat');
    const plain = await screen.findAllByRole('navigation', { name: 'Навигация' });
    expect(
      plain
        .flatMap((nav) => within(nav).queryAllByRole('link'))
        .some((link) => /Анализы|Помощники/.test(link.textContent ?? '')),
    ).toBe(false);
  });

  it('«Обсудить в чате» открывает новый чат с готовым вопросом; отправляет его пользователь', async () => {
    setSiteFeatures({ discovery: true });
    installWithAnalysis();
    renderRoute('/analyses/a1');
    fireEvent.click(await screen.findByRole('link', { name: 'Обсудить в чате' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Спросите что-нибудь…') as HTMLTextAreaElement).value).toMatch(
        /«Черновики ответов»/,
      ),
    );
    expect((screen.getByLabelText('Спросите что-нибудь…') as HTMLTextAreaElement).value).toMatch(
      /Моя ситуация: Много однотипных вопросов покупателей/,
    );
  });
});
