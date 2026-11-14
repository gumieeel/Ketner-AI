import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { useCompare } from '@/features/chat/compare-store';
import { buildFixTask, reviewableRuns } from '@/features/code/code-store';
import type { ThreadItem } from '@/features/code/types';
import { useReview } from '@/features/review/review-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';
import { setProductSwitchesForTests } from '@/lib/product-switches';

// Закрытые возможности (lib/product-switches.ts): здесь проверяется их спящий код.
setProductSwitchesForTests({ chat: true, answerReview: true });

const COMPOSER = 'Спросите что-нибудь…';

function loginAs(plan: 'free' | 'plus' | 'pro'): void {
  useAuth.setState({
    user: {
      id: 'demo-user',
      email: 'demo@ketner.ai',
      name: 'Демо',
      plan,
      createdAt: new Date().toISOString(),
    },
    token: 'fake.jwt.token',
    status: 'authenticated',
  });
}

function resetReview(): void {
  useReview.setState({ results: {}, live: {}, quota: null });
}

describe('проверка ответа другой моделью', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    resetReview();
  });

  it('кнопка «Проверить» показывает рецензента, замечание с цитатой и исправленный ответ', async () => {
    const api = installFakeApi({ reply: 'Столица Австралии — Сидней.', plan: 'plus' });
    loginAs('plus');
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.type(await screen.findByLabelText(COMPOSER), 'Какая столица Австралии?');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(useChat.getState().messages.at(-1)?.status).toBe('complete'));

    await user.click(await screen.findByRole('button', { name: /^Проверить$/ }));
    await waitFor(() => expect(api.reviewBodies.length).toBe(1));
    const answer = useChat.getState().messages.at(-1)!;
    expect(api.reviewBodies[0]).toMatchObject({
      conversationId: answer.conversationId,
      messageId: answer.id,
      language: 'ru',
    });

    const panel = await screen.findByTestId('answer-review');
    expect(within(panel).getByText('Есть серьёзные ошибки')).toBeInTheDocument();
    expect(within(panel).getByText(/Проверила Gemini 3\.7 Flash · Google/)).toBeInTheDocument();
    expect(within(panel).getByText('«Сидней»')).toBeInTheDocument();
    expect(
      within(panel).getByText('Столица Австралии — Канберра, а не Сидней.'),
    ).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Показать исправленный ответ' }));
    expect(await within(panel).findByText('Канберра')).toBeInTheDocument();
    // Повторная проверка доступна, кнопка меняет подпись.
    expect(screen.getByRole('button', { name: 'Проверить ещё раз' })).toBeInTheDocument();
  });

  it('сохранённая проверка видна сразу, а лимит проверок предлагает купить кредиты', async () => {
    const api = installFakeApi({
      plan: 'free',
      reviewReject: {
        status: 429,
        code: 'review_limit',
        message: 'Проверки на сегодня закончились (2 в сутки).',
      },
    });
    loginAs('free');
    const conversation = api.seed({
      title: 'Старый диалог',
      messages: [
        {
          id: 'u1',
          conversationId: 'conversation-1',
          role: 'user',
          content: 'Сколько будет 2+2?',
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
        {
          id: 'a1',
          conversationId: 'conversation-1',
          role: 'assistant',
          content: '4',
          createdAt: new Date().toISOString(),
          status: 'complete',
          modelId: 'ketner-mini',
          review: {
            id: 'r0',
            verdict: 'ok',
            summary: 'Ответ верный.',
            issues: [],
            reviewer: {
              modelId: 'nemotron-ultra',
              modelName: 'Nemotron 3 Ultra',
              developer: 'NVIDIA',
            },
            createdAt: new Date().toISOString(),
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderRoute(`/chat/${conversation.id}`);

    const panel = await screen.findByTestId('answer-review');
    expect(within(panel).getByText('Ошибок не найдено')).toBeInTheDocument();
    expect(within(panel).getByText('Ответ верный.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Проверки на сегодня закончились');
    expect(
      within(alert).getByRole('link', { name: /После покупки кредитов проверок больше/ }),
    ).toHaveAttribute('href', '/pricing');
  });
});

describe('консилиум в сравнении', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    resetReview();
  });

  it('судья собирает итог, показывает расхождения, итог можно оставить в диалоге', async () => {
    const api = installFakeApi({
      plan: 'plus',
      compareReplies: { 'ketner-pro': 'Ответ Ketner Pro', 'claude-haiku-5.5': 'Ответ Haiku' },
    });
    loginAs('plus');
    useCompare.setState({ enabled: true, modelIds: ['ketner-pro', 'claude-haiku-5.5'] });
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.type(await screen.findByLabelText(COMPOSER), 'Что такое рекурсия?');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    const columns = await screen.findByTestId('compare-columns');

    const run = await within(columns).findByRole(
      'button',
      { name: /Собрать итог/ },
      { timeout: 10000 },
    );
    await user.click(run);
    await waitFor(() => expect(api.judgeBodies[0]).toEqual({ runId: 'run-1', language: 'ru' }));

    const panel = await screen.findByTestId('consilium');
    expect(
      await within(panel).findByText(
        'Итог консилиума: рекурсия — это вызов функции из самой себя.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Частично расходятся')).toBeInTheDocument();
    expect(within(panel).getByText('Нужен ли базовый случай')).toBeInTheDocument();
    expect(within(panel).getByText(/Судья: Gemini 3\.7 Flash · Google/)).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Оставить итог в диалоге' }));
    await waitFor(() => expect(api.judgeBodies[1]).toEqual({ runId: 'run-1' }));
    await waitFor(() =>
      expect(useChat.getState().messages.at(-1)?.content).toBe(
        'Итог консилиума: рекурсия — это вызов функции из самой себя.',
      ),
    );
    expect(useChat.getState().messages.at(-1)?.id).toBe('judge-message');
    expect(await within(panel).findByText('Итог в диалоге')).toBeInTheDocument();
  });
});

describe('ревью правок в Ketner Code', () => {
  const at = '2026-10-21T10:00:00.000Z';
  const tool = (runId: string, change: boolean): ThreadItem => ({
    id: `t-${runId}`,
    kind: 'tool',
    runId,
    step: 1,
    tool: change ? 'edit_file' : 'read_file',
    label: 'edit_file a.ts',
    ok: true,
    summary: '',
    ...(change
      ? { change: { path: 'a.ts', action: 'modify' as const, additions: 1, deletions: 0 } }
      : {}),
    createdAt: at,
  });
  const runItem = (runId: string): ThreadItem => ({
    id: `r-${runId}`,
    kind: 'run',
    runId,
    status: 'completed',
    steps: 1,
    costUsd: 0,
    modelId: 'gpt-6.1-sol',
    createdAt: at,
  });

  it('кнопку ревью получают запуски с правками, ещё не проверенные', () => {
    const review: ThreadItem = {
      id: 'rv',
      kind: 'review',
      runId: 'c',
      verdict: 'approve',
      summary: '',
      issues: [],
      reviewer: { modelId: 'x', modelName: 'X', developer: 'Y' },
      filesReviewed: 1,
      createdAt: at,
    };
    const thread = [
      tool('a', true),
      runItem('a'),
      tool('b', false),
      runItem('b'),
      tool('c', true),
      runItem('c'),
      review,
    ];
    expect([...reviewableRuns(thread)]).toEqual(['a']);
  });

  it('задача «исправить замечания» перечисляет файлы, строки и советы рецензента', () => {
    const task = buildFixTask(
      {
        id: 'rv',
        kind: 'review',
        runId: 'a',
        verdict: 'changes',
        summary: '',
        issues: [
          {
            severity: 'high',
            file: 'src/db.ts',
            line: 12,
            problem: 'SQL-инъекция',
            fix: 'параметры',
          },
          { severity: 'low', problem: 'нет теста' },
        ],
        reviewer: {
          modelId: 'claude-sonnet-5.5',
          modelName: 'Claude Sonnet 5.5',
          developer: 'Anthropic',
        },
        filesReviewed: 1,
        createdAt: at,
      },
      'ru',
    );
    expect(task).toContain('Ревью Claude Sonnet 5.5');
    expect(task).toContain('1. src/db.ts:12 — SQL-инъекция Как исправить: параметры');
    expect(task).toContain('2. нет теста');
  });
});
